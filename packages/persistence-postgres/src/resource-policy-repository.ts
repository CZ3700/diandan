import {
  resourcePolicyReadCommandSchema,
  resourcePolicyRegisterCommandSchema,
  resourcePolicyResponseSchema,
} from "@fan-support/contracts";
import type { ResourceManagementRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import {
  resourceEventTime,
  resourceFailure,
  resourceMutation,
  utcTimestampSql,
  writeResourceAudit,
  type ResourceRun,
} from "./resource-management-data.js";
import type { TransactionClient } from "./transaction-runner.js";

export function createResourcePolicyMethods(
  client: TransactionClient,
  run: ResourceRun,
): Pick<ResourceManagementRepository, "readPolicy" | "registerPolicy"> {
  return {
    readPolicy(input) {
      const parsed = resourcePolicyReadCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const [row] = await draftRows(
          client,
          `SELECT policy_key,kind,${utcTimestampSql("created_at")} AS created_at FROM public.policies WHERE policy_key=$1`,
          [parsed.data.policyKey],
        );
        if (!row) return resourceFailure("NOT_FOUND");
        return resourcePolicyResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "POLICY",
          policy: {
            schemaVersion: 1,
            policyKey: row["policy_key"],
            kind: row["kind"],
            createdAt: row["created_at"],
          },
        });
      });
    },
    registerPolicy(input) {
      const parsed = resourcePolicyRegisterCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(resourceFailure("INVALID_COMMAND"));
      return run(async () => {
        const command = parsed.data;
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('fan-support:policy-registration:'||$1,0))",
          [command.policyKey],
        );
        const [existing] = await draftRows(
          client,
          "SELECT policy_key FROM public.policies WHERE policy_key=$1 FOR UPDATE",
          [command.policyKey],
        );
        if (existing) return resourceFailure("ALREADY_EXISTS");
        const time = await resourceEventTime(client, {
          sessionId: command.sessionId,
          permission: "content.policy.manage",
        });
        await client.query(
          "INSERT INTO public.policies(policy_key,kind,created_at) VALUES($1,$2,$3)",
          [command.policyKey, command.kind, time.at],
        );
        await writeResourceAudit(client, {
          ...time,
          ...command,
          action: "POLICY_REGISTER",
          subjectType: "POLICY_REGISTRATION",
          subjectId: command.receiptId,
        });
        await client.query(
          `INSERT INTO public.policy_registration_receipts(id,policy_key,kind,actor_id,session_id,audit_log_id,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            command.receiptId,
            command.policyKey,
            command.kind,
            command.actorId,
            command.sessionId,
            time.auditId,
            time.at,
          ],
        );
        return resourceMutation(command.receiptId);
      });
    },
  };
}
