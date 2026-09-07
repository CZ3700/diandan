import Fastify from "fastify";
import { expect, test } from "vitest";
import { sendRevalidatedPublicJson } from "./public-revalidation-response.js";
test("conditional requests validate the fresh complete representation and isolate locale and version", async () => {
  const app = Fastify();
  let revision = 1,
    reads = 0;
  app.get("/:locale", (request, reply) => {
    reads++;
    const locale = (request.params as { locale: string }).locale;
    return sendRevalidatedPublicJson(
      request,
      reply,
      {
        schemaVersion: 1,
        revision,
        locale,
      },
      { resource: "test", query: { locale } },
    );
  });
  try {
    const initial = await app.inject("/en"),
      tag = String(initial.headers.etag);
    expect(initial.headers["cache-control"]).toBe(
      "public, max-age=0, s-maxage=0, must-revalidate",
    );
    expect(tag).toMatch(/^W\/"[a-f0-9]{64}"$/u);
    const cached = await app.inject({
      url: "/en",
      headers: { "if-none-match": `"other", ${tag.replace("W/", "")}` },
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe("");
    expect(reads).toBe(2);
    expect(
      (await app.inject({ url: "/th", headers: { "if-none-match": tag } }))
        .statusCode,
    ).toBe(200);
    revision++;
    expect(
      (await app.inject({ url: "/en", headers: { "if-none-match": tag } }))
        .statusCode,
    ).toBe(200);
    for (const header of [
      `invalid ${tag}`,
      `"prefix,${tag}`,
      "W/bad",
      "x".repeat(4097),
    ])
      expect(
        (await app.inject({ url: "/en", headers: { "if-none-match": header } }))
          .statusCode,
      ).toBe(200);
  } finally {
    await app.close();
  }
});
test("credentials bypass public storage and 304, without reflecting their values", async () => {
  const app = Fastify();
  app.get("/", (request, reply) =>
    sendRevalidatedPublicJson(
      request,
      reply,
      {
        schemaVersion: 1,
        value: "public",
      },
      { resource: "test", query: {} },
    ),
  );
  try {
    for (const headers of [
      { cookie: "session=PRIVATE" },
      { authorization: "Bearer PRIVATE" },
    ]) {
      const response = await app.inject({
        url: "/",
        headers: { ...headers, "if-none-match": "*" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers.etag).toBeUndefined();
      expect(response.body).not.toContain("PRIVATE");
    }
  } finally {
    await app.close();
  }
});
test("identical empty bodies still isolate the canonical resource and locale, market and currency scope", async () => {
  const app = Fastify();
  app.get("/:resource/:locale/:market/:currency", (request, reply) => {
    const { resource, ...query } = request.params as {
      resource: string;
      locale: string;
      market: string;
      currency: string;
    };
    return sendRevalidatedPublicJson(
      request,
      reply,
      { schemaVersion: 1, items: [] },
      { resource, query },
    );
  });
  try {
    const first = await app.inject("/gifts/en/GLOBAL/USD");
    const tag = String(first.headers.etag);
    for (const url of [
      "/gifts/th/GLOBAL/USD",
      "/gifts/en/SECOND/USD",
      "/gifts/en/GLOBAL/THB",
      "/artists/en/GLOBAL/USD",
    ]) {
      const response = await app.inject({
        url,
        headers: { "if-none-match": tag },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(first.body);
      expect(response.headers.etag).not.toBe(tag);
    }
  } finally {
    await app.close();
  }
});
