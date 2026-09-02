import { createConnection } from "node:net";

import Fastify from "fastify";
import { expect, test } from "vitest";

import { registerFastifyObservability } from "./fastify.js";
import { createStructuredLogger } from "./logging.js";
import { startNodeTelemetry } from "./node.js";

test("records the final Fastify 4xx and 5xx status without reflecting errors", async () => {
  const telemetry = startNodeTelemetry({ service: "api" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "api",
    write: (line) => lines.push(line),
  });
  const application = Fastify({ logger: false });
  registerFastifyObservability(application, { logger, service: "api" });
  application.get("/bad-request", () => {
    throw Object.assign(new Error("PRIVATE_4XX_ERROR_31824"), {
      statusCode: 400,
    });
  });
  application.get("/server-error", () => {
    throw new Error("PRIVATE_5XX_ERROR_74129");
  });

  try {
    const badRequest = await application.inject({
      method: "GET",
      url: "/bad-request",
    });
    const serverError = await application.inject({
      method: "GET",
      url: "/server-error",
    });

    expect(badRequest.statusCode).toBe(400);
    expect(serverError.statusCode).toBe(500);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      event: "http.request.completed",
      httpRoute: "/bad-request",
      httpStatusCode: 400,
      outcome: "success",
    });
    expect(JSON.parse(lines[1] ?? "null")).toMatchObject({
      event: "http.request.failed",
      httpRoute: "/server-error",
      httpStatusCode: 500,
      errorCode: "INTERNAL_ERROR",
      outcome: "failure",
    });
    expect(lines.join("\n")).not.toContain("PRIVATE_4XX_ERROR_31824");
    expect(lines.join("\n")).not.toContain("PRIVATE_5XX_ERROR_74129");
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("finishes the correlated request when the client aborts before sending its body", async () => {
  const telemetry = startNodeTelemetry({ service: "api" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "api",
    write: (line) => lines.push(line),
  });
  const application = Fastify({ logger: false });
  registerFastifyObservability(application, { logger, service: "api" });
  application.post("/aborted", () => ({ status: "unexpected" }));
  application.get("/healthy", () => ({ status: "ok" }));
  const privateCanary = "PRIVATE_ABORT_BODY_98427";

  try {
    await application.listen({ host: "127.0.0.1", port: 0 });
    const address = application.server.address();
    expect(address).not.toBeNull();
    expect(typeof address).toBe("object");
    if (address === null || typeof address !== "object") {
      throw new Error("Fastify did not expose a TCP address");
    }

    await new Promise<void>((resolve, reject) => {
      const socket = createConnection(address.port, "127.0.0.1");
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.write(
          [
            "POST /aborted HTTP/1.1",
            "Host: 127.0.0.1",
            "Content-Type: application/json",
            "Content-Length: 1000000",
            "x-request-id: c938b936-8a3d-4810-a05a-7a8a5e323497",
            "",
            `{"partial":"${privateCanary}`,
          ].join("\r\n"),
          () => {
            globalThis.setTimeout(() => socket.destroy(), 25);
          },
        );
      });
      socket.once("close", () => resolve());
    });

    await expect.poll(() => lines.length, { timeout: 2_000 }).toBe(1);
    const healthyResponse = await application.inject({
      method: "GET",
      url: "/healthy",
      headers: {
        "x-request-id": "e9a38dfd-2a82-4fb7-84fe-51d72af406bc",
      },
    });
    expect(healthyResponse.statusCode).toBe(200);
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 25);
    });

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      event: "http.request.failed",
      requestId: "c938b936-8a3d-4810-a05a-7a8a5e323497",
      httpRoute: "/aborted",
      httpStatusCode: 499,
      errorCode: "REQUEST_ABORTED",
      outcome: "failure",
    });
    expect(JSON.parse(lines[1] ?? "null")).toMatchObject({
      event: "http.request.completed",
      requestId: "e9a38dfd-2a82-4fb7-84fe-51d72af406bc",
      httpRoute: "/healthy",
      httpStatusCode: 200,
      outcome: "success",
    });
    expect(lines.join("\n")).not.toContain(privateCanary);
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});

test("finishes the correlated request when Fastify times out the connection", async () => {
  const telemetry = startNodeTelemetry({ service: "api" });
  const lines: string[] = [];
  const logger = createStructuredLogger({
    service: "api",
    write: (line) => lines.push(line),
  });
  const application = Fastify({ connectionTimeout: 50, logger: false });
  registerFastifyObservability(application, { logger, service: "api" });
  application.get("/timeout", async (_request, reply) => reply);

  try {
    const origin = await application.listen({ host: "127.0.0.1", port: 0 });
    await expect(fetch(`${origin}/timeout`)).rejects.toThrow();

    await expect.poll(() => lines.length, { timeout: 2_000 }).toBe(1);
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, 25);
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toMatchObject({
      event: "http.request.failed",
      httpRoute: "/timeout",
      httpStatusCode: 408,
      errorCode: "REQUEST_TIMEOUT",
      outcome: "failure",
    });
  } finally {
    await application.close();
    await telemetry.shutdown();
  }
});
