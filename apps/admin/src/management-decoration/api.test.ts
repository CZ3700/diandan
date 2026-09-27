import { expect, test } from "vitest";
import { createDefaultHomeLayout } from "@fan-support/contracts";
import { createAdminClient } from "../workspace/client";
const subject = await import("./api").catch(() => undefined);
test("layout mutations reject unrelated receipts and keep the retry key until success", async () => {
  expect(subject?.createHomeLayoutApi).toBeTypeOf("function");
  const requests: RequestInit[] = [];
  const client = createAdminClient(
    () => "csrf",
    () => {},
    (async (_url, init) => {
      requests.push(init!);
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "STATE",
        replayed: false,
        state: { schemaVersion: 1, version: 3, draft: null, published: null },
      });
    }) as typeof fetch,
  );
  const api = subject!.createHomeLayoutApi(client);
  await expect(api.save(createDefaultHomeLayout(), 0)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
  await expect(api.save(createDefaultHomeLayout(), 0)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
  expect(new Headers(requests[0]?.headers).get("idempotency-key")).toBe(
    new Headers(requests[1]?.headers).get("idempotency-key"),
  );
});

test("an idempotent replay rereads the current layout instead of replacing a newer draft with its historical receipt", async () => {
  const layout = createDefaultHomeLayout();
  const revisionId = "a0000000-0000-4000-8000-000000000001";
  const saved = {
    schemaVersion: 1,
    version: 1,
    draft: { revisionId, layout, createdAt: "2026-09-28T00:00:00Z" },
    published: null,
  };
  const current = {
    ...saved,
    version: 3,
    draft: {
      ...saved.draft,
      revisionId: "b0000000-0000-4000-8000-000000000001",
      layout: { ...layout, sections: [...layout.sections].reverse() },
    },
  };
  const paths: string[] = [];
  const api = subject!.createHomeLayoutApi(
    createAdminClient(
      () => "csrf",
      () => {},
      async (path) => {
        paths.push(String(path));
        return Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STATE",
          replayed: paths.length === 1,
          state: paths.length === 1 ? saved : current,
        });
      },
    ),
  );
  expect(await api.save(layout, 0)).toEqual(current);
  expect(paths).toEqual([
    "/api/admin/home-layout-draft",
    "/api/admin/home-layout-read",
  ]);
});
