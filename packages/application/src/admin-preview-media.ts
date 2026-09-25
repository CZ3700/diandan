import {
  adminPreviewMediaRequestSchema,
  adminPreviewMediaContextResponseSchema,
  adminPreviewMediaResponseSchema,
  mediaPortResponseSchema,
  type AdminPreviewMediaResponse,
  type AdminPreviewMediaContext,
} from "@fan-support/contracts";
import {
  sameBaseContentTarget,
  canonicalTranslationValue,
} from "@fan-support/content";
import type {
  AdminPreviewMediaTransactionManager,
  JsonValue,
} from "@fan-support/persistence-port";
import type { MediaStoragePort } from "@fan-support/media-port";
import {
  digestAdminContentToken,
  validateAdminContentTokenPepper,
} from "./admin-content-tokens.js";
import {
  adminContentFailure,
  rejectAdminContent,
  requireAdminSuccess,
} from "./admin-content-results.js";
import {
  compareBaseContentTime,
  addBaseContentSeconds,
} from "./base-content-time.js";
export type AdminPreviewMediaUseCases = Readonly<{
  execute(input: unknown): Promise<AdminPreviewMediaResponse>;
}>;
export function createAdminPreviewMediaUseCases(dependencies: {
  transactions: AdminPreviewMediaTransactionManager;
  storage: Pick<MediaStoragePort, "createDownloadGrant">;
  tokenPepper: string;
}): AdminPreviewMediaUseCases {
  if (
    !dependencies ||
    typeof dependencies.transactions?.runInAdminPreviewMediaTransaction !==
      "function" ||
    typeof dependencies.storage?.createDownloadGrant !== "function"
  )
    throw new TypeError("Invalid preview media configuration");
  validateAdminContentTokenPepper(dependencies.tokenPepper);
  return {
    async execute(input) {
      const parsed = adminPreviewMediaRequestSchema.safeParse(input);
      if (!parsed.success) return adminContentFailure("INVALID_COMMAND");
      try {
        const request = parsed.data,
          tokenDigest = digestAdminContentToken({
            tokenPepper: dependencies.tokenPepper,
            purpose: "base-content-preview",
            token: request.token,
          });
        const read = async (): Promise<AdminPreviewMediaContext> => {
          const result =
            await dependencies.transactions.runInAdminPreviewMediaTransaction(
              async (repositories) =>
                JSON.parse(
                  JSON.stringify(
                    await repositories.adminPreviewMedia.read({
                      schemaVersion: 1,
                      target: request.target,
                      tokenDigest,
                    }),
                  ),
                ) as JsonValue,
            );
          const { context } = requireAdminSuccess(
            adminPreviewMediaContextResponseSchema.parse(result),
          );
          if (
            !sameBaseContentTarget(context.target, request.target) ||
            compareBaseContentTime(context.expiresAt, context.evaluatedAt) <= 0
          )
            rejectAdminContent("PREVIEW_UNAVAILABLE");
          return context;
        };
        const context = await read();
        const images = [];
        for (const entry of context.images) {
          if (entry.status === "UNAVAILABLE") {
            images.push(entry);
            continue;
          }
          // The provider retains its 60-second minimum. A short grant is never rounded upward.
          if (
            compareBaseContentTime(
              context.expiresAt,
              addBaseContentSeconds(context.evaluatedAt, 60),
            ) < 0
          )
            rejectAdminContent("PREVIEW_UNAVAILABLE");
          const grant = mediaPortResponseSchema.parse(
            await dependencies.storage.createDownloadGrant({
              schemaVersion: 1,
              operation: "CREATE_DOWNLOAD_GRANT",
              storageClass: "DERIVATIVE",
              objectKey: entry.objectKey,
              expiresAt: context.expiresAt,
            }),
          );
          if (
            grant.outcome !== "SUCCESS" ||
            grant.operation !== "CREATE_DOWNLOAD_GRANT"
          )
            rejectAdminContent("PREVIEW_UNAVAILABLE");
          if (
            grant.value.storageClass !== "DERIVATIVE" ||
            grant.value.objectKey !== entry.objectKey ||
            compareBaseContentTime(grant.value.expiresAt, context.expiresAt) >
              0 ||
            compareBaseContentTime(
              grant.value.expiresAt,
              context.evaluatedAt,
            ) <= 0
          )
            rejectAdminContent("PREVIEW_UNAVAILABLE");
          const image = {
            assetId: entry.assetId,
            metadataRevisionId: entry.metadataRevisionId,
            status: entry.status,
            alt: entry.alt,
            presentationKind: entry.presentationKind,
            focalPoint: entry.focalPoint,
            width: entry.width,
            height: entry.height,
            mimeType: entry.mimeType,
          };
          images.push({
            ...image,
            download: {
              method: grant.value.method,
              url: grant.value.url,
              headers: grant.value.headers,
              expiresAt: grant.value.expiresAt,
            },
          });
        }
        const current = await read();
        const stable = (value: AdminPreviewMediaContext) => ({
          ...value,
          evaluatedAt: undefined,
        });
        if (
          canonicalTranslationValue(stable(current)) !==
          canonicalTranslationValue(stable(context))
        )
          rejectAdminContent("PREVIEW_UNAVAILABLE");
        if (
          images.some(
            (entry) =>
              entry.status === "AVAILABLE" &&
              compareBaseContentTime(
                entry.download.expiresAt,
                current.evaluatedAt,
              ) <= 0,
          )
        )
          rejectAdminContent("PREVIEW_UNAVAILABLE");
        return adminPreviewMediaResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "PREVIEW_MEDIA",
          target: request.target,
          expiresAt: context.expiresAt,
          images,
        });
      } catch {
        return adminContentFailure("PREVIEW_UNAVAILABLE");
      }
    },
  };
}
