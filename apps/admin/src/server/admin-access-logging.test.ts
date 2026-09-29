import { expect, test } from "vitest";
import config from "../../next.config";

test("native Next request logging excludes authentication URLs including rejected callback queries", () => {
  const logging = config.logging;
  const incoming = logging && logging.incomingRequests;
  const ignored =
    incoming && typeof incoming === "object" ? (incoming.ignore ?? []) : [];
  for (const url of [
    "/api/admin/auth/callback?code=private&state=private",
    "/api/admin/auth/callback/unknown?code=private",
    "/api/admin/auth/begin?private=invalid",
    "/api/admin/auth/logout?private=invalid",
    "/api/admin/local-auth/login",
    "/api/admin/local-auth/step?private=invalid",
  ])
    expect(ignored.some((pattern) => pattern.test(url))).toBe(true);
  expect(
    ignored.some((pattern) => pattern.test("/api/admin/catalog-list")),
  ).toBe(false);
  expect(
    ignored.some((pattern) => pattern.test("/api/admin/local-authority")),
  ).toBe(false);
});
