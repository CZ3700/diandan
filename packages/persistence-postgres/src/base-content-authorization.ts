import {
  adminAuthorizationCommandSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { createAdminAuthorizationRepository } from "./admin-authorization-repository.js";
import { draftRows } from "./content-draft-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

/** Preview recipients retain only the issuing session's current scoped capability. */
export async function authorizeBasePreviewIssuer(
  client: TransactionClient,
  scope: TransactionScopeControl,
  sessionId: string,
  actorId: string,
  locales: SupportedLocale[],
): Promise<boolean> {
  const [session] = await draftRows(
    client,
    "SELECT encode(session_token_digest,'hex') AS session_digest,encode(csrf_token_digest,'hex') AS csrf_digest FROM public.admin_sessions WHERE id=$1 AND admin_identity_id=$2",
    [sessionId, actorId],
  );
  if (!session) return false;
  const result = await createAdminAuthorizationRepository(
    client,
    scope,
  ).authorize(
    adminAuthorizationCommandSchema.parse({
      schemaVersion: 1,
      sessionTokenDigest: session["session_digest"],
      csrfTokenDigest: session["csrf_digest"],
      permission: "content.preview",
      locales,
    }),
  );
  return (
    result.outcome === "SUCCESS" &&
    result.principal.sessionId.toLowerCase() === sessionId.toLowerCase() &&
    result.principal.actorId.toLowerCase() === actorId.toLowerCase()
  );
}
