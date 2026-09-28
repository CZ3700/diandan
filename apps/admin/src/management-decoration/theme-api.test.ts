import { expect, test } from "vitest";
import {
  createDefaultStorefrontTheme,
  createDefaultStorefrontPresentation,
} from "@fan-support/contracts";
import { createAdminClient } from "../workspace/client";
const subject = await import("./theme-api").catch(() => undefined);
test("theme mutations reject unrelated receipts and keep the retry key until success", async () => {
  expect(subject?.createStorefrontThemeApi).toBeTypeOf("function");
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
  const api = subject!.createStorefrontThemeApi(client);
  await expect(api.save(createDefaultStorefrontTheme(), 0)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
  await expect(api.save(createDefaultStorefrontTheme(), 0)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
  expect(new Headers(requests[0]?.headers).get("idempotency-key")).toBe(
    new Headers(requests[1]?.headers).get("idempotency-key"),
  );
});

test("an idempotent replay rereads the current theme instead of replacing a newer draft with its historical receipt", async () => {
  const theme = createDefaultStorefrontTheme();
  const revisionId = "a0000000-0000-4000-8000-000000000001";
  const saved = {
    schemaVersion: 1,
    version: 1,
    draft: { revisionId, theme, createdAt: "2026-09-28T00:00:00Z" },
    published: null,
  };
  const current = {
    ...saved,
    version: 3,
    draft: {
      ...saved.draft,
      revisionId: "b0000000-0000-4000-8000-000000000001",
      theme: { ...theme, palette: "MIDNIGHT_BLUE" },
    },
  };
  const paths: string[] = [];
  const api = subject!.createStorefrontThemeApi(
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
  expect(await api.save(theme, 0)).toEqual(current);
  expect(paths).toEqual([
    "/api/admin/storefront-theme-draft",
    "/api/admin/storefront-theme-read",
  ]);
});

test("theme save rejects a receipt for different settings even when its version matches", async () => {
  const theme = createDefaultStorefrontTheme();
  const api = subject!.createStorefrontThemeApi(
    createAdminClient(
      () => "csrf",
      () => {},
      async () =>
        Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STATE",
          replayed: false,
          state: {
            schemaVersion: 1,
            version: 1,
            published: null,
            draft: {
              revisionId: "a0000000-0000-4000-8000-000000000001",
              createdAt: "2026-09-28T00:00:00Z",
              theme: { ...theme, typography: "LARGE" },
            },
          },
        }),
    ),
  );
  await expect(api.save(theme, 0)).rejects.toThrow("INVALID_RESPONSE");
});

test.each([
  { heroLayout: "SPLIT" as const },
  { giftLayout: "SHOWCASE" as const },
  { motion: "SUBTLE" as const },
  { motionSpeed: "QUICK" as const },
])(
  "theme save rejects a different presentation-only receipt: %j",
  async (change) => {
    const theme = {
      ...createDefaultStorefrontTheme(),
      presentation: createDefaultStorefrontPresentation(),
    };
    const receiptTheme = {
      ...theme,
      presentation: { ...theme.presentation, ...change },
    };
    const api = subject!.createStorefrontThemeApi(
      createAdminClient(
        () => "csrf",
        () => {},
        async () =>
          Response.json({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "STATE",
            replayed: false,
            state: {
              schemaVersion: 1,
              version: 1,
              published: null,
              draft: {
                revisionId: "a0000000-0000-4000-8000-000000000001",
                createdAt: "2026-09-28T00:00:00Z",
                theme: receiptTheme,
              },
            },
          }),
      ),
    );
    await expect(api.save(theme, 0)).rejects.toThrow("INVALID_RESPONSE");
  },
);

test("theme save sends and accepts the complete presentation without changing the envelope", async () => {
  const theme = {
    ...createDefaultStorefrontTheme(),
    presentation: {
      heroLayout: "SPLIT" as const,
      giftLayout: "SHOWCASE" as const,
      motion: "SUBTLE" as const,
      motionSpeed: "QUICK" as const,
    },
  };
  const requests: RequestInit[] = [];
  const state = {
    schemaVersion: 1,
    version: 1,
    published: null,
    draft: {
      revisionId: "a0000000-0000-4000-8000-000000000001",
      createdAt: "2026-09-28T00:00:00Z",
      theme,
    },
  };
  const api = subject!.createStorefrontThemeApi(
    createAdminClient(
      () => "csrf",
      () => {},
      async (_path, init) => {
        requests.push(init!);
        return Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STATE",
          replayed: false,
          state,
        });
      },
    ),
  );
  expect(await api.save(theme, 0)).toEqual(state);
  expect(JSON.parse(String(requests[0]?.body))).toEqual({
    schemaVersion: 1,
    expectedVersion: 0,
    theme,
  });
});

test("theme publication and restoration reject another revision's receipt", async () => {
  const requested = "a0000000-0000-4000-8000-000000000001";
  const different = "b0000000-0000-4000-8000-000000000001";
  for (const action of ["PUBLISH", "RESTORE"] as const) {
    const api = subject!.createStorefrontThemeApi(
      createAdminClient(
        () => "csrf",
        () => {},
        async () =>
          Response.json({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "STATE",
            replayed: false,
            state: {
              schemaVersion: 1,
              version: 2,
              draft: null,
              published: {
                publicationId: different,
                revisionId: different,
                version: 2,
                theme: createDefaultStorefrontTheme(),
                publishedAt: "2026-09-28T00:00:00Z",
                action,
                restoredFromPublicationId:
                  action === "RESTORE" ? different : null,
              },
            },
          }),
      ),
    );
    await expect(
      action === "PUBLISH"
        ? api.publish(requested, 1)
        : api.restore(requested, 1),
    ).rejects.toThrow("INVALID_RESPONSE");
  }
});

test("theme history rejects a different page and stale writes stay explicit failures", async () => {
  const api = subject!.createStorefrontThemeApi(
    createAdminClient(
      () => "csrf",
      () => {},
      async (path) =>
        Response.json(
          String(path).endsWith("history")
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
    ),
  );
  await expect(api.history(1)).rejects.toThrow("INVALID_RESPONSE");
  await expect(api.save(createDefaultStorefrontTheme(), 0)).rejects.toThrow(
    "STALE_VERSION",
  );
});

test.each([
  { artist: "SPLIT" as const, gift: "IMAGE_LEFT" as const },
  { artist: "IMMERSIVE" as const, gift: "IMAGE_RIGHT" as const },
])(
  "theme save rejects a different detail-template-only receipt: %j",
  async (detailTemplates) => {
    const theme = createDefaultStorefrontTheme();
    const api = subject!.createStorefrontThemeApi(
      createAdminClient(
        () => "csrf",
        () => {},
        async () =>
          Response.json({
            schemaVersion: 1,
            outcome: "SUCCESS",
            kind: "STATE",
            replayed: false,
            state: {
              schemaVersion: 1,
              version: 1,
              published: null,
              draft: {
                revisionId: "a0000000-0000-4000-8000-000000000001",
                createdAt: "2026-09-28T00:00:00Z",
                theme: { ...theme, detailTemplates },
              },
            },
          }),
      ),
    );
    await expect(api.save(theme, 0)).rejects.toThrow("INVALID_RESPONSE");
  },
);

test("theme save sends both new detail settings alongside presentation in the unchanged envelope", async () => {
  const theme = {
    ...createDefaultStorefrontTheme(),
    presentation: createDefaultStorefrontPresentation(),
    detailTemplates: { artist: "SPLIT" as const, gift: "IMAGE_RIGHT" as const },
  };
  const state = {
    schemaVersion: 1,
    version: 1,
    published: null,
    draft: {
      revisionId: "a0000000-0000-4000-8000-000000000001",
      createdAt: "2026-09-28T00:00:00Z",
      theme,
    },
  };
  const requests: RequestInit[] = [];
  const api = subject!.createStorefrontThemeApi(
    createAdminClient(
      () => "csrf",
      () => {},
      async (_path, init) => {
        requests.push(init!);
        return Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STATE",
          replayed: false,
          state,
        });
      },
    ),
  );
  expect(await api.save(theme, 0)).toEqual(state);
  expect(JSON.parse(String(requests[0]?.body))).toEqual({
    schemaVersion: 1,
    expectedVersion: 0,
    theme,
  });
});
