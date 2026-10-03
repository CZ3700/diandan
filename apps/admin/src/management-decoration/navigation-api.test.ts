import { expect, test } from "vitest";
import { createAdminClient } from "../workspace/client";
import { navigationFixture } from "./navigation-fixture";
const subject = await import("./navigation-api").catch(() => undefined);
const revisionId = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000001";
const state = (navigation = navigationFixture(), version = 1) => ({
  schemaVersion: 1,
  version,
  draft: { revisionId, createdAt: "2026-09-28T00:00:00Z", navigation },
  published: null,
});
function api(fetcher: typeof fetch) {
  expect(subject?.createStorefrontNavigationApi).toBeTypeOf("function");
  return subject!.createStorefrontNavigationApi(
    createAdminClient(
      () => "csrf",
      () => {},
      fetcher,
    ),
  );
}
const success = (value: unknown, replayed = false) =>
  Response.json({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "STATE",
    replayed,
    state: value,
  });
test("different navigation order/visibility and wrong versions are rejected without losing the retry key", async () => {
  for (const response of [
    state({ ...navigationFixture(), header: ["GIFTS", "ARTISTS", "HOME"] }),
    state({
      ...navigationFixture(),
      footer: navigationFixture().footer.map((item) =>
        item.id === "GIFTS" ? { ...item, visible: true } : item,
      ),
    }),
    state(navigationFixture(), 2),
  ]) {
    const headers: Headers[] = [];
    const subject = api(async (_url, init) => {
      headers.push(new Headers(init?.headers));
      return success(response);
    });
    await expect(subject.save(navigationFixture(), 0)).rejects.toThrow(
      "INVALID_RESPONSE",
    );
    await expect(subject.save(navigationFixture(), 0)).rejects.toThrow(
      "INVALID_RESPONSE",
    );
    expect(headers[0]?.get("idempotency-key")).toBe(
      headers[1]?.get("idempotency-key"),
    );
  }
});
test("save uses an independent navigation payload and a replay rereads current authority", async () => {
  const requests: { path: string; body: unknown }[] = [];
  const current = state(
    { ...navigationFixture(), header: ["ARTISTS", "HOME", "GIFTS"] },
    3,
  );
  const subject = api(async (url, init) => {
    requests.push({ path: String(url), body: JSON.parse(String(init?.body)) });
    return success(
      requests.length === 1 ? state() : current,
      requests.length === 1,
    );
  });
  expect(await subject.save(navigationFixture(), 0)).toEqual(current);
  expect(requests).toEqual([
    {
      path: "/api/admin/storefront-navigation-draft",
      body: {
        schemaVersion: 1,
        expectedVersion: 0,
        navigation: navigationFixture(),
      },
    },
    {
      path: "/api/admin/storefront-navigation-read",
      body: { schemaVersion: 1 },
    },
  ]);
});
test("publication and restoration reject another revision's receipt", async () => {
  for (const action of ["PUBLISH", "RESTORE"] as const) {
    const subject = api(async () =>
      success({
        schemaVersion: 1,
        version: 2,
        draft: null,
        published: {
          publicationId: other,
          revisionId: other,
          version: 2,
          navigation: navigationFixture(),
          publishedAt: "2026-09-28T00:00:00Z",
          action,
          restoredFromPublicationId: action === "RESTORE" ? other : null,
        },
      }),
    );
    await expect(
      action === "PUBLISH"
        ? subject.publish(revisionId, 1)
        : subject.restore(revisionId, 1),
    ).rejects.toThrow("INVALID_RESPONSE");
  }
});
test("history mismatches and stale writes remain explicit failures", async () => {
  const subject = api(async (url) =>
    Response.json(
      String(url).endsWith("history")
        ? {
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "HISTORY",
            entries: [],
            page: 2,
            pageSize: 10,
            hasMore: false,
          }
        : { schemaVersion: 1, outcome: "FAILURE", code: "STALE_VERSION" },
    ),
  );
  await expect(subject.history(1)).rejects.toThrow("INVALID_RESPONSE");
  await expect(subject.save(navigationFixture(), 0)).rejects.toThrow(
    "STALE_VERSION",
  );
});
