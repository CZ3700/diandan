import {
  storefrontBrandResponseSchema,
  type StorefrontBrand,
  type StorefrontBrandState,
  type StorefrontBrandResponse,
} from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { createMutationKeys } from "../workspace/state";
import { createMediaUploadAttempt } from "../workspace/media-upload-attempt";
import { logoSelectionIssue, sameBrand } from "./brand-model";
export type BrandHistory = Extract<
  StorefrontBrandResponse,
  { kind: "HISTORY" }
>;

export function createStorefrontBrandApi(
  client: AdminClient,
  transport: typeof fetch = fetch,
) {
  const keys = createMutationKeys();
  const uploads = createMediaUploadAttempt(transport);
  async function read(): Promise<StorefrontBrandState> {
    const result = await client.call(
      "storefront-brand-read",
      { schemaVersion: 1 },
      storefrontBrandResponseSchema,
    );
    if (result.kind !== "STATE") throw new AdminClientError("INVALID_RESPONSE");
    return result.state;
  }
  async function mutate(
    operation: string,
    command: Record<string, unknown>,
    matches: (state: StorefrontBrandState) => boolean,
  ): Promise<StorefrontBrandState> {
    const body = { schemaVersion: 1, ...command };
    const result = await client.call(
      operation,
      body,
      storefrontBrandResponseSchema,
      true,
      keys.forCommand(operation, body),
    );
    if (
      result.kind !== "STATE" ||
      result.state.version !== Number(command["expectedVersion"]) + 1 ||
      !matches(result.state)
    )
      throw new AdminClientError("INVALID_RESPONSE");
    const current = result.replayed ? await read() : result.state;
    keys.succeeded(operation, body);
    return current;
  }
  return {
    read,
    async history(page = 1): Promise<BrandHistory> {
      const result = await client.call(
        "storefront-brand-history",
        { schemaVersion: 1, page, pageSize: 10 },
        storefrontBrandResponseSchema,
      );
      if (
        result.kind !== "HISTORY" ||
        result.page !== page ||
        result.pageSize !== 10
      )
        throw new AdminClientError("INVALID_RESPONSE");
      return result;
    },
    save(brand: StorefrontBrand, expectedVersion: number) {
      return mutate(
        "storefront-brand-draft",
        { brand, expectedVersion },
        (state) => Boolean(state.draft && sameBrand(state.draft.brand, brand)),
      );
    },
    publish(draftRevisionId: string, expectedVersion: number) {
      return mutate(
        "storefront-brand-publish",
        { draftRevisionId, expectedVersion },
        (state) =>
          state.draft === null &&
          state.published?.revisionId === draftRevisionId &&
          state.published.action === "PUBLISH",
      );
    },
    restore(publicationId: string, expectedVersion: number) {
      return mutate(
        "storefront-brand-restore",
        { publicationId, expectedVersion },
        (state) =>
          state.draft === null &&
          state.published?.restoredFromPublicationId === publicationId &&
          state.published.action === "RESTORE",
      );
    },
    async upload(file: File) {
      const issue = logoSelectionIssue(file);
      if (issue) throw new AdminClientError(issue);
      const bytes = await file.arrayBuffer();
      const checksumSha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      const { uploadId } = await uploads.transfer(
        client,
        {
          checksumSha256,
          byteSize: file.size,
          mimeType: file.type,
          rightsReference: "STOREFRONT_BRAND",
        },
        bytes,
      );
      const operation = "storefront-brand-prepare";
      const body = { schemaVersion: 1, uploadId };
      const result = await client.call(
        operation,
        body,
        storefrontBrandResponseSchema,
        true,
        keys.forCommand(operation, body),
      );
      if (result.kind !== "LOGO")
        throw new AdminClientError("INVALID_RESPONSE");
      keys.succeeded(operation, body);
      return result.logo;
    },
  };
}
export type StorefrontBrandApi = ReturnType<typeof createStorefrontBrandApi>;
