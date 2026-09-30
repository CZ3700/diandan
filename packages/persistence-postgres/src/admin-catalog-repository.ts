import {
  adminCatalogReceiptReadCommandSchema,
  adminCatalogReadCommandSchema,
  adminCatalogWriteCommandSchema,
  idolHandleResolutionCommandSchema,
  idolHandleResolutionSchema,
} from "@fan-support/contracts";
import type { AdminCatalogRepository } from "@fan-support/persistence-port";
import { createResourceRun } from "./resource-management-data.js";
import { draftRows } from "./content-draft-data.js";
import { catalogFailure, readIdentityReceipt } from "./admin-catalog-data.js";
import { readAdminCatalog } from "./admin-catalog-read.js";
import { writeAdminCatalog } from "./admin-catalog-write.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";
export function createAdminCatalogRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl?: string,
): AdminCatalogRepository {
  const run = createResourceRun(client, scope);
  return {
    read(input) {
      const parsed = adminCatalogReadCommandSchema.safeParse(input);
      return parsed.success
        ? run(() => readAdminCatalog(client, parsed.data, publicMediaBaseUrl))
        : Promise.resolve(catalogFailure("INVALID_COMMAND"));
    },
    write(input) {
      const parsed = adminCatalogWriteCommandSchema.safeParse(input);
      return parsed.success
        ? run(() =>
            writeAdminCatalog(client, scope, parsed.data, publicMediaBaseUrl),
          )
        : Promise.resolve(catalogFailure("INVALID_COMMAND"));
    },
    readReceipt(input) {
      const parsed = adminCatalogReceiptReadCommandSchema.safeParse(input);
      return parsed.success
        ? run(() =>
            readIdentityReceipt(
              client,
              parsed.data.resultId,
              parsed.data.actorId,
            ),
          )
        : Promise.resolve(catalogFailure("INVALID_COMMAND"));
    },
    resolveHandle(input) {
      const parsed = idolHandleResolutionCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(catalogFailure("INVALID_COMMAND"));
      return run(async () => {
        const [row] = await draftRows(
          client,
          `SELECT i.id,i.handle FROM public.idols i JOIN public.idol_publication_heads h ON h.idol_id=i.id AND h.idol_revision_id=i.published_revision_id WHERE i.status IN('active','paused') AND (i.handle=$1 OR EXISTS(SELECT 1 FROM public.slug_redirects s WHERE s.entity_type='IDOL' AND s.old_handle=$1 AND s.idol_id=i.id))`,
          [parsed.data.handle],
        );
        return row
          ? idolHandleResolutionSchema.parse({
              schemaVersion: 1,
              outcome: "SUCCESS",
              kind: "IDOL_HANDLE",
              idolId: row["id"],
              requestedHandle: parsed.data.handle,
              currentHandle: row["handle"],
              redirectStatus: row["handle"] === parsed.data.handle ? null : 301,
            })
          : catalogFailure("NOT_FOUND");
      });
    },
  };
}
