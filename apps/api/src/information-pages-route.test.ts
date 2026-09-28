import Fastify from "fastify";
import { expect, test, vi } from "vitest";
const subject = await import("./information-pages-route.js").catch(
  () => undefined,
);
const headers = {
  origin: "https://admin.example.test",
  "content-type": "application/json",
  cookie: `__Host-fan-admin-session=${"s".repeat(43)}`,
  "x-csrf-token": "c".repeat(43),
};
test("info administration requires same-origin session and strips no caller identity into trusted envelopes", async () => {
  expect(subject?.registerInformationPagesRoute).toBeTypeOf("function");
  const app = Fastify(),
    execute = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LIST",
      entries: ["ABOUT", "FAQ", "SUPPORT"].map((pageKey) => ({
        pageKey,
        version: 0,
        draftRevisionId: null,
        publishedPublicationId: null,
      })),
    }));
  subject!.registerInformationPagesRoute(app, {
    allowedOrigin: headers.origin,
    useCases: { execute },
  });
  try {
    for (const [h, payload, code] of [
      [headers, { schemaVersion: 1, locale: "en" }, 200],
      [
        { ...headers, origin: "https://other.test" },
        { schemaVersion: 1, locale: "en" },
        403,
      ],
      [headers, { schemaVersion: 1, locale: "en", actorId: "injected" }, 400],
      [headers, { schemaVersion: 1, locale: "en", action: "PUBLISH" }, 400],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/admin/information-pages/list",
        headers: h,
        payload,
      });
      expect(response.statusCode).toBe(code);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
  }
});
test("public info API distinguishes absence and outage, rejects extra/duplicate parameters and never exposes draft identity", async () => {
  expect(subject?.registerPublicInformationPagesRoute).toBeTypeOf("function");
  const app = Fastify(),
    read = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "FAILURE",
      code: "NOT_FOUND",
    })),
    index = vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "INFORMATION_PAGE_INDEX",
      locale: "en",
      entries: [],
    }));
  subject!.registerPublicInformationPagesRoute(app, {
    useCases: { read, index },
  });
  try {
    expect(
      (await app.inject("/api/v1/storefront/information-pages?locale=en"))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject("/api/v1/storefront/information-pages/ABOUT?locale=en"))
        .statusCode,
    ).toBe(404);
    for (const suffix of [
      "?locale=en&locale=ja",
      "?locale=en&revisionId=private",
      "?locale=unknown",
      "",
    ])
      expect(
        (
          await app.inject(
            `/api/v1/storefront/information-pages/ABOUT${suffix}`,
          )
        ).statusCode,
      ).toBe(400);
    read.mockRejectedValueOnce(new Error("private PG details"));
    const response = await app.inject(
      "/api/v1/storefront/information-pages/ABOUT?locale=en",
    );
    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).not.toContain("private PG");
  } finally {
    await app.close();
  }
});
