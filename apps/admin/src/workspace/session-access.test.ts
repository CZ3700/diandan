import { expect, test, vi } from "vitest";
import * as client from "./client";
const csrf = "c".repeat(42) + "A";
const success = { schemaVersion: 1, outcome: "SUCCESS", kind: "LOGGED_OUT" };

test("login fetch preserves exact same-origin submission and returns only a validated HTTPS authorization target", async () => {
  expect(client.requestAdminLogin).toBeTypeOf("function");
  const authorizationUrl =
    "https://identity.example.invalid/authorize?state=public-state";
  const transport = vi.fn<typeof fetch>(async () =>
    Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "LOGIN_REDIRECT",
      authorizationUrl,
    }),
  );
  expect(await client.requestAdminLogin("zh-CN", transport)).toBe(
    authorizationUrl,
  );
  const [url, init] = transport.mock.calls[0]!;
  expect(url).toBe("/api/admin/auth/begin");
  expect(init).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    body: "locale=zh-CN",
  });
  expect(new Headers(init!.headers).get("content-type")).toBe(
    "application/x-www-form-urlencoded",
  );
});
test("login never navigates on unsafe, credential-bearing, uncertain or failed responses", async () => {
  expect(client.requestAdminLogin).toBeTypeOf("function");
  const login = {
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "LOGIN_REDIRECT",
    authorizationUrl: "https://identity.example.invalid/authorize",
  };
  for (const transport of [
    async () =>
      Response.json({ ...login, authorizationUrl: "javascript:alert(1)" }),
    async () => Response.json({ ...login, browserToken: csrf }),
    async () => Response.json(login, { status: 503 }),
    async () =>
      Response.json(
        { schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_UNAVAILABLE" },
        { status: 503 },
      ),
    async () => {
      throw new Error("private-detail");
    },
  ])
    await expect(client.requestAdminLogin("en", transport)).rejects.toThrow(
      "ACCESS_UNAVAILABLE",
    );
});

test("logout sends only the same-origin CSRF-bound command and waits for confirmed revocation", async () => {
  expect(client.requestAdminLogout).toBeTypeOf("function");
  const transport = vi.fn(async () => Response.json(success));
  await client.requestAdminLogout(csrf, transport);
  expect(transport).toHaveBeenCalledOnce();
  const [url, init] = transport.mock.calls[0]! as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("/api/admin/auth/logout");
  expect(init).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
  });
  expect(new Headers(init.headers).get("x-csrf-token")).toBe(csrf);
  expect(JSON.parse(String(init.body))).toEqual({ schemaVersion: 1 });
});
test("logout network and malformed responses remain errors so the caller cannot clear the active session", async () => {
  expect(client.requestAdminLogout).toBeTypeOf("function");
  for (const transport of [
    async () => {
      throw new Error("private-upstream-detail");
    },
    async () => Response.json(success, { status: 503 }),
    async () => Response.json({ ...success, token: "must-not-accept" }),
    async () =>
      Response.json(
        { schemaVersion: 1, outcome: "FAILURE", code: "ACCESS_UNAVAILABLE" },
        { status: 503 },
      ),
  ])
    await expect(client.requestAdminLogout(csrf, transport)).rejects.toThrow(
      "ACCESS_UNAVAILABLE",
    );
});
test("session bootstrap distinguishes confirmed unauthenticated from an unavailable service", async () => {
  expect(client.readAdminSession).toBeTypeOf("function");
  expect(
    await client.readAdminSession(new AbortController().signal, async () =>
      Response.json(
        { schemaVersion: 1, outcome: "FAILURE", code: "UNAUTHENTICATED" },
        { status: 401 },
      ),
    ),
  ).toBeNull();
  await expect(
    client.readAdminSession(new AbortController().signal, async () =>
      Response.json(
        { schemaVersion: 1, outcome: "FAILURE", code: "CONTENT_UNAVAILABLE" },
        { status: 503 },
      ),
    ),
  ).rejects.toThrow("ACCESS_UNAVAILABLE");
});
