import Fastify from "fastify";
import { expect, test } from "vitest";

import {
  apiAdapterOptions,
  resolveTrustedProxyCidrs,
} from "./trusted-proxy-config.js";

const key = "FAN_SUPPORT_TRUSTED_PROXY_CIDRS";

test("absent configuration trusts no proxy, so request.ip stays the TCP peer", () => {
  expect(resolveTrustedProxyCidrs({})).toBeUndefined();
  expect(apiAdapterOptions({})).toEqual({ logger: false });
});

test("exact IPv4/IPv6 addresses and networks are accepted in order", () => {
  expect(
    resolveTrustedProxyCidrs({
      [key]: " 127.0.0.0/8, ::1/128 ,10.20.0.0/16,192.0.2.10,2600:9000::/28",
    }),
  ).toEqual([
    "127.0.0.0/8",
    "::1/128",
    "10.20.0.0/16",
    "192.0.2.10",
    "2600:9000::/28",
  ]);
  expect(apiAdapterOptions({ [key]: "127.0.0.0/8,::1/128" })).toEqual({
    logger: false,
    trustProxy: ["127.0.0.0/8", "::1/128"],
  });
});

test("hop counts, wildcards, overly broad networks and malformed entries refuse to start", () => {
  for (const value of [
    "",
    " ",
    "true",
    "1",
    "*",
    "0.0.0.0/0",
    "::/0",
    "10.0.0.0/7",
    "2600::/15",
    "10.0.0.0/33",
    "::1/129",
    "10.0.0.0/",
    "10.0.0/8",
    "127.0.0.1,,::1",
    "loopback",
    "127.0.0.1/8/8",
    Array.from({ length: 257 }, (_, i) => `10.0.${i % 256}.1`).join(","),
  ])
    expect(() => resolveTrustedProxyCidrs({ [key]: value }), value).toThrow(
      "Invalid trusted proxy configuration",
    );
});

test("behind trusted proxies Fastify resolves the nearest untrusted forwarded address", async () => {
  const app = Fastify(apiAdapterOptions({ [key]: "127.0.0.0/8,10.0.0.0/8" }));
  app.get("/ip", async (request) => ({ ip: request.ip }));
  const ip = async (remoteAddress: string, forwarded?: string) =>
    (
      await app.inject({
        method: "GET",
        url: "/ip",
        remoteAddress,
        ...(forwarded === undefined
          ? {}
          : { headers: { "x-forwarded-for": forwarded } }),
      })
    ).json().ip;
  try {
    expect(await ip("127.0.0.1", "203.0.113.7")).toBe("203.0.113.7");
    expect(await ip("127.0.0.1", "192.0.2.1, 203.0.113.7, 10.1.2.3")).toBe(
      "203.0.113.7",
    );
    expect(await ip("198.51.100.20", "203.0.113.7")).toBe("198.51.100.20");
    expect(await ip("127.0.0.1")).toBe("127.0.0.1");
  } finally {
    await app.close();
  }
});
