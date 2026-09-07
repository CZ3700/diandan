import { expect, test, vi } from "vitest";
import type { AdminCatalogWriteCommand } from "@fan-support/contracts";
import { identityEventTime } from "./admin-catalog-data.js";

test("identity event time preserves database microseconds and exact prior history without reusing a prior wall-clock observation", async () => {
  const at = "2026-09-07T01:02:03.123456Z";
  const prior = "2026-09-07T01:02:03.123455Z";
  const query = vi.fn(async (...arguments_: unknown[]) => {
    void arguments_;
    return {
      rows: [
        {
          id: "receipt",
          audit_id: "audit",
          idol_id: "idol",
          redirect_id: "redirect",
          at,
        },
      ],
    };
  });
  const input = {
    principal: {
      sessionId: "session",
      authorizedAt: "2026-09-07T01:02:05.123456Z",
    },
  } as AdminCatalogWriteCommand;
  const result = await identityEventTime({ query, release: vi.fn() }, input, {
    updated_at: prior,
  });
  expect(result.at).toBe(at);
  expect(query.mock.calls[0]?.[1]).toEqual(["session", prior]);
});

test("missing canonical session cannot manufacture an identity event timestamp", async () => {
  const query = vi.fn(async () => ({ rows: [] }));
  await expect(
    identityEventTime(
      { query, release: vi.fn() },
      { principal: { sessionId: "missing" } } as AdminCatalogWriteCommand,
      undefined,
    ),
  ).rejects.toThrow("Missing canonical session");
});
