import { expect, test, vi } from "vitest";
import { publicationRuntimeRetryWriteCommandSchema } from "@fan-support/contracts";
import { retryPublicationPurge } from "./publication-runtime-retry.js";

vi.mock("./publication-runtime-data.js", () => ({
  writePublicationAudit: vi.fn(),
  readPublicationReceipt: vi.fn().mockResolvedValue({
    schemaVersion: 1,
    outcome: "FAILURE",
    code: "NOT_FOUND",
  }),
}));
const id = "a0000000-0000-4000-8000-000000000001";
const now = "2026-09-07T10:00:00.000000Z";
const legacy = ["/en", "/en/sitemap.xml"];
const expanded = [
  ...legacy,
  "/sitemap.xml*",
  "/en/sitemap.xml*",
  "/api/v1/storefront-seo/*",
].sort();

test.each([
  { format: "legacy", paths: legacy },
  { format: "expanded", paths: expanded },
])(
  "$format retry keeps the predecessor's exact persisted paths",
  async ({ paths }) => {
    const prior = {
      publication_id: id,
      outbox_event_id: id,
      locale: "en",
      version: 3,
      generation: 1,
      status: "FAILED",
      updated_at: now,
      paths,
    };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("SELECT to_jsonb(j.*)")) {
        expect(values).toEqual([id]);
        return { rows: [{ job: prior }] };
      }
      if (sql.startsWith("SELECT gen_random_uuid()"))
        return { rows: [{ result_id: id, job_id: id, audit_id: id, now }] };
      return { rows: [] };
    });
    const command = publicationRuntimeRetryWriteCommandSchema.parse({
      schemaVersion: 1,
      requestId: id,
      principal: {
        schemaVersion: 1,
        actorId: id,
        sessionId: id,
        authorizedAt: now,
        expiresAt: "2026-09-07T11:00:00.000000Z",
      },
      command: {
        schemaVersion: 1,
        action: "RETRY_PURGE",
        publicationId: id,
        purgeJobId: id,
        expectedVersion: 3,
        reasonCode: "RETRY_REQUESTED",
        idempotencyKey: "fixture-seo-purge-retry",
      },
    });
    await retryPublicationPurge({ query, release: vi.fn() }, command);
    const insert = query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO public.content_purge_jobs"),
    );
    expect(insert).toBeDefined();
    expect(insert?.[1]?.[6]).toBe(paths);
    expect(insert?.[1]?.[4]).toBe(2);
  },
);
