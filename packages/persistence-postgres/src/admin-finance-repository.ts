import {
  adminFinanceStoreRequestSchema,
  adminFinanceClaimRequestSchema,
  adminFinanceSettleCommandSchema,
  adminFinanceApplyCommandSchema,
  adminFinanceListPendingCommandSchema,
  adminFinancePendingEventsSchema,
} from "@fan-support/contracts";
import type {
  AdminFinanceRepository,
  OutboxRepository,
  InventoryRepository,
  OrderPaymentApplicationRepository,
} from "@fan-support/persistence-port";
import { executeAdminFinance } from "./admin-finance-command.js";
import {
  claimAdminFinance,
  settleAdminFinance,
} from "./admin-finance-recovery.js";
import { applyAdminFinance } from "./admin-finance-apply.js";
import {
  draftRows,
  financeFailure,
  type TransactionClient,
} from "./admin-finance-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionScopeControl,
} from "./transaction-runner.js";
export function createAdminFinanceRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  outbox: OutboxRepository,
  inventory: InventoryRepository,
  payments: OrderPaymentApplicationRepository,
): AdminFinanceRepository {
  const run = <T>(work: () => Promise<T>) =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    execute: (input) =>
      run(async () => {
        const p = adminFinanceStoreRequestSchema.safeParse(input);
        return p.success
          ? executeAdminFinance(client, outbox, inventory, p.data)
          : financeFailure("INVALID_COMMAND");
      }),
    claim: (input) =>
      run(() =>
        claimAdminFinance(
          client,
          outbox,
          adminFinanceClaimRequestSchema.parse(input),
        ),
      ),
    settle: (input) =>
      run(() =>
        settleAdminFinance(
          client,
          outbox,
          adminFinanceSettleCommandSchema.parse(input),
        ),
      ),
    apply: (input) =>
      run(() =>
        applyAdminFinance(
          client,
          outbox,
          inventory,
          payments,
          adminFinanceApplyCommandSchema.parse(input),
        ),
      ),
    listPending: (input) =>
      run(async () => {
        const c = adminFinanceListPendingCommandSchema.parse(input);
        const rows = await draftRows(
          client,
          `WITH due AS(SELECT e.id FROM provider_events e LEFT JOIN admin_finance_application_schedule s ON s.provider_event_id=e.id WHERE (e.event_type IN('REFUND_STATUS','DISPUTE_STATUS') OR EXISTS(SELECT 1 FROM admin_finance_operations x JOIN payment_attempts a ON a.id=x.attempt_id WHERE a.provider_account_id=e.provider_account_id AND a.environment=e.environment AND a.external_reference=e.external_payment_reference AND x.refund_id IS NULL)) AND NOT EXISTS(SELECT 1 FROM admin_finance_application_receipts r WHERE r.provider_event_id=e.id) AND coalesce(s.next_attempt_at,e.normalized_at)<=clock_timestamp() ORDER BY coalesce(s.next_attempt_at,e.normalized_at),e.id LIMIT $1 FOR UPDATE OF e SKIP LOCKED) INSERT INTO admin_finance_application_schedule(provider_event_id,next_attempt_at,attempt_count) SELECT id,clock_timestamp()+interval '30 seconds',1 FROM due ON CONFLICT(provider_event_id) DO UPDATE SET next_attempt_at=EXCLUDED.next_attempt_at,attempt_count=admin_finance_application_schedule.attempt_count+1 RETURNING provider_event_id`,
          [c.limit],
        );
        return adminFinancePendingEventsSchema.parse({
          schemaVersion: 1,
          providerEventIds: rows.map((r) => r["provider_event_id"]),
        });
      }),
  };
}
