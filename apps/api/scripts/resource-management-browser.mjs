import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "@playwright/test";

async function startPageServer(storageOrigin) {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; connect-src ${storageOrigin}; frame-ancestors 'none'; base-uri 'none'`,
    });
    response.end(
      "<!doctype html><title>Synthetic upload verification</title><p>Private resource upload test</p>",
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

/** Real Chromium CORS. Capabilities remain in memory; no trace, HAR, URL logs or global certificate bypass. */
export async function createResourceUploadBrowser({ configPath, endpoint }) {
  const certificate = new X509Certificate(
    await readFile(path.join(path.dirname(configPath), "server.crt")),
  );
  const spki = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  let browser, allowed, denied;
  try {
    allowed = await startPageServer(new globalThis.URL(endpoint).origin);
    denied = await startPageServer(new globalThis.URL(endpoint).origin);
    // Only this isolated ephemeral leaf is pinned. Node separately verifies its CA chain.
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [`--ignore-certificate-errors-spki-list=${spki}`],
    });
  } catch {
    await Promise.allSettled([
      browser?.close(),
      allowed?.close(),
      denied?.close(),
    ]);
    throw new Error("RESOURCE_BROWSER_SETUP_FAILED");
  }
  return {
    allowedOrigin: allowed.origin,
    deniedOrigin: denied.origin,
    async upload(grant, bytes, permitted) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        const requests = new Map();
        const statuses = [];
        await session.send("Network.enable");
        session.on("Network.requestWillBeSent", (event) => {
          if (
            event.request.url === grant.url &&
            ["OPTIONS", "PUT"].includes(event.request.method)
          )
            requests.set(event.requestId, event.request.method);
        });
        session.on("Network.responseReceived", (event) => {
          const method = requests.get(event.requestId);
          if (method) statuses.push({ method, status: event.response.status });
        });
        await page.goto(permitted ? allowed.origin : denied.origin);
        const result = await page.evaluate(
          async ({ grant, bytes }) => {
            try {
              const response = await globalThis.fetch(grant.url, {
                method: grant.method,
                headers: grant.headers,
                body: new Uint8Array(bytes),
                credentials: "omit",
                redirect: "error",
                signal: globalThis.AbortSignal.timeout(15_000),
              });
              await response.arrayBuffer();
              return { outcome: "RESPONSE", status: response.status };
            } catch {
              return { outcome: "REJECTED" };
            }
          },
          { grant, bytes: Array.from(bytes) },
        );
        // A CDP round trip flushes events without waiting for an arbitrary delay.
        await session.send("Runtime.evaluate", { expression: "true" });
        return { ...result, methods: [...requests.values()], statuses };
      } catch {
        throw new Error("RESOURCE_BROWSER_UPLOAD_FAILED");
      } finally {
        await context.close();
      }
    },
    async close() {
      await browser.close();
      await Promise.all([allowed.close(), denied.close()]);
    },
  };
}
