import { expect, it, vi } from "vitest";
import Fastify from "fastify";
import { registerPublishedGiftCommerceRoute } from "./published-gift-commerce-route.js";
it("rejects duplicate, missing and unrelated public query fields before reading", async () => {
  const app = Fastify();
  const execute = vi.fn(async () => ({
    schemaVersion: 1 as const,
    outcome: "FAILURE" as const,
    code: "NOT_FOUND" as const,
  }));
  registerPublishedGiftCommerceRoute(app, { useCases: { execute } });
  try {
    for (const query of [
      "",
      "?locale=en&locale=ja",
      "?locale=en&currency=USD",
      "?locale=en-XA",
    ]) {
      const response = await app.inject(
        `/api/v1/gift-content/studio-gift${query}`,
      );
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(execute).not.toHaveBeenCalled();
    const response = await app.inject(
      "/api/v1/gift-content/studio-gift?locale=th",
    );
    expect(response.statusCode).toBe(404);
    expect(execute).toHaveBeenCalledWith({
      schemaVersion: 1,
      locator: { kind: "GIFT", handle: "studio-gift" },
      locale: "th",
    });
    execute.mockRejectedValueOnce(new Error("private connection"));
    const failure = await app.inject(
      "/api/v1/gift-content/studio-gift?locale=th",
    );
    expect(failure.statusCode).toBe(503);
    expect(failure.body).not.toContain("private connection");
  } finally {
    await app.close();
  }
});
