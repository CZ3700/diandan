import {
  publicationRuntimeResponseSchema,
  type PublicationPreflightResponse,
  type PublicationRuntimeResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "./client";
type Proof = Extract<PublicationPreflightResponse, { outcome: "SUCCESS" }>;
/** Validation is a persisted transition. A transport retry must resume after that transition. */
export function createPublicationAttempt() {
  let checkpoint: { input: Proof; validated: Proof } | null = null;
  let completed: {
    input: Proof;
    validated: Proof;
    result: Extract<PublicationRuntimeResponse, { outcome: "SUCCESS" }>;
  } | null = null;
  const matches = (left: Proof, right: Proof) =>
    JSON.stringify(left.target) === JSON.stringify(right.target) &&
    left.headVersion === right.headVersion &&
    left.contentHash === right.contentHash &&
    left.action === right.action;
  return {
    async publish(
      client: AdminClient,
      input: Proof,
      lifecycle: string,
      reason: string,
      onValidated: (proof: Proof) => void,
    ) {
      if (
        completed &&
        (matches(input, completed.input) || matches(input, completed.validated))
      )
        return completed.result;
      const prior =
        checkpoint &&
        (matches(input, checkpoint.input) ||
          matches(input, checkpoint.validated))
          ? checkpoint
          : null;
      let proof = prior?.validated ?? input;
      if (proof.action === "PUBLISH" && lifecycle === "DRAFT" && !prior) {
        const result = await client.call(
          "publication-validate",
          {
            schemaVersion: 1,
            target: proof.target,
            expectedVersion: proof.headVersion,
            expectedContentHash: proof.contentHash,
            reasonCode: reason,
          },
          publicationRuntimeResponseSchema,
          true,
        );
        if (result.kind !== "PUBLICATION_MUTATION")
          throw new AdminClientError("INVALID_RESPONSE");
        proof = {
          ...proof,
          headVersion: result.headVersion,
          contentHash: result.contentHash,
        };
        checkpoint = { input, validated: proof };
        onValidated(proof);
      }
      const result = await client.call(
        proof.action === "ROLLBACK"
          ? "publication-rollback"
          : "publication-publish",
        {
          schemaVersion: 1,
          target: proof.target,
          expectedVersion: proof.headVersion,
          expectedContentHash: proof.contentHash,
          reasonCode: reason,
        },
        publicationRuntimeResponseSchema,
        true,
      );
      completed = { input, validated: proof, result };
      return result;
    },
  };
}
