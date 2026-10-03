import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

// Only normalized, verified adapter candidates enter this bounded in-memory store.
// No raw body, credential, URL or arbitrary provider error is retained in reports.
export function createWebhookEvidence() {
  const candidates = [];
  let failed = false;
  function accept(result) {
    if (result.outcome !== "SUCCESS") {
      if (result.error?.code !== "UNSUPPORTED_EVENT") failed = true;
      return;
    }
    const candidate = result.value.candidate;
    if (candidates.length >= 256) {
      failed = true;
      return;
    }
    candidates.push({
      eventType: candidate.eventType,
      status: candidate.status,
      externalReference: candidate.externalReference,
      refundReference: candidate.refundReference,
      amountMinor: candidate.amountMinor,
      currency: candidate.currency,
      transactionType: candidate.transaction?.type,
      transactionReference: candidate.transaction?.providerReference,
    });
  }
  function matches(expected, eventType, amountMinor, transactionReference) {
    return candidates.some(
      (candidate) =>
        candidate.eventType === eventType &&
        candidate.status === "SUCCEEDED" &&
        candidate.externalReference === expected.externalReference &&
        candidate.amountMinor === amountMinor &&
        candidate.currency === expected.currency &&
        candidate.transactionReference === transactionReference &&
        candidate.transactionType ===
          (eventType === "PAYMENT_STATUS" ? "CAPTURE" : "REFUND") &&
        (eventType !== "REFUND_STATUS" ||
          candidate.refundReference === expected.refundReference),
    );
  }
  return {
    accept,
    fail: () => {
      failed = true;
    },
    hasFailures: () => failed,
    async waitFor(expected, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (!failed) {
        const payment = matches(
          expected,
          "PAYMENT_STATUS",
          expected.paymentAmountMinor,
          expected.captureReference,
        );
        const refund = matches(
          expected,
          "REFUND_STATUS",
          expected.refundAmountMinor,
          expected.refundTransactionReference,
        );
        if (payment && refund) return true;
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        await delay(Math.min(25, remaining));
      }
      return false;
    },
  };
}

export async function startWebhookServer({
  port,
  verifier,
  verificationCommand,
  evidence,
}) {
  const pending = new Set();
  async function receive(request, response) {
    if (request.method !== "POST" || request.url !== "/webhook") {
      response.writeHead(404).end();
      return;
    }
    try {
      request.setTimeout(15_000, () => request.destroy());
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 65_536) {
          evidence.fail();
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      const result = await verifier.verifyPaymentWebhook({
        ...verificationCommand,
        rawBodyBase64: Buffer.concat(chunks).toString("base64url"),
        headers: {
          "stripe-signature": String(request.headers["stripe-signature"] ?? ""),
        },
        receivedAt: new Date().toISOString(),
      });
      evidence.accept(result);
      response
        .writeHead(
          result.outcome === "SUCCESS" ||
            result.error?.code === "UNSUPPORTED_EVENT"
            ? 202
            : 400,
        )
        .end();
    } catch {
      evidence.fail();
      response.writeHead(400).end();
    }
  }
  const server = createServer((request, response) => {
    const task = receive(request, response).catch(() => {
      evidence.fail();
      response.destroy();
    });
    pending.add(task);
    void task.then(() => pending.delete(task));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", () => evidence.fail());
  return {
    evidence,
    port: server.address().port,
    async close() {
      const closed = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closed;
      await Promise.all(pending);
    },
  };
}
