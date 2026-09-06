import { describe, expect, it } from "vitest";
import { publicationPreflightResponseSchema } from "@fan-support/contracts";
import { createPublicationAttempt } from "./publication-attempt";
import type { AdminClient } from "./client";
const proof = publicationPreflightResponseSchema.options[0].parse({
  schemaVersion: 1,
  outcome: "SUCCESS",
  kind: "PUBLICATION_PREFLIGHT",
  target: {
    owner: { kind: "HOMEPAGE" },
    revisionId: "10000000-0000-4000-8000-000000000001",
  },
  action: "PUBLISH",
  headVersion: 2,
  contentHash: "a".repeat(64),
  evaluatedAt: "2026-09-06T18:00:00Z",
  ready: true,
  issues: [],
});
describe("publication attempt recovery", () => {
  it("retries publication with the validated proof without trying to validate an already validated revision", async () => {
    const operations: string[] = [];
    const writes: unknown[] = [];
    const client = {
      call: async (operation: string, body: unknown) => {
        operations.push(operation);
        if (operation === "publication-validate")
          return {
            kind: "PUBLICATION_MUTATION",
            headVersion: 2,
            contentHash: "b".repeat(64),
          };
        writes.push(body);
        if (writes.length === 1) throw new Error("connection lost");
        return {
          kind: "PUBLICATION_MUTATION",
          publicationId: proof.target.revisionId,
        };
      },
    } as unknown as AdminClient;
    const attempt = createPublicationAttempt();
    await expect(
      attempt.publish(client, proof, "DRAFT", "CONTENT_UPDATE", () => {}),
    ).rejects.toThrow("connection lost");
    await attempt.publish(client, proof, "DRAFT", "CONTENT_UPDATE", () => {});
    expect(operations).toEqual([
      "publication-validate",
      "publication-publish",
      "publication-publish",
    ]);
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[1]).toMatchObject({ expectedContentHash: "b".repeat(64) });
  });
  it("can publish a canonical validated revision opened in a new editor", async () => {
    const operations: string[] = [];
    const client = {
      call: async (operation: string) => {
        operations.push(operation);
        return { kind: "PUBLICATION_MUTATION" };
      },
    } as unknown as AdminClient;
    await createPublicationAttempt().publish(
      client,
      proof,
      "VALIDATED",
      "CONTENT_UPDATE",
      () => {},
    );
    expect(operations).toEqual(["publication-publish"]);
  });
});

it("reuses a confirmed publication result when only the following status read failed", async () => {
  const operations: string[] = [];
  const client = {
    call: async (operation: string) => {
      operations.push(operation);
      return {
        kind: "PUBLICATION_MUTATION",
        publicationId: proof.target.revisionId,
      };
    },
  } as unknown as AdminClient;
  const attempt = createPublicationAttempt();
  const confirmed = await attempt.publish(
    client,
    proof,
    "VALIDATED",
    "CONTENT_UPDATE",
    () => {},
  );
  // The component still owns the same preflight after its separate STATUS request failed.
  const resumed = await attempt.publish(
    client,
    proof,
    "VALIDATED",
    "CONTENT_UPDATE",
    () => {},
  );
  expect(resumed).toEqual(confirmed);
  expect(operations).toEqual(["publication-publish"]);
});
