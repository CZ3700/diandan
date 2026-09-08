import {
  cartEditLoadItemCommandSchema,
  cartEditLoadPrivateCommandSchema,
  cartEditConfirmPrivateCommandSchema,
  cartEditWriteMutationCommandSchema,
  cartEditFindMutationReceiptCommandSchema,
} from "@fan-support/contracts";
import {
  CartEditRepositoryError,
  CartRuntimeRepositoryError,
  type CartEditRepository,
} from "@fan-support/persistence-port";
import {
  authorizedEditCart,
  cartMutationReceipt,
  loadEditableCartItem,
  rejectCartEdit,
} from "./cart-edit-data.js";
import {
  loadCartPrivateForEdit,
  confirmCartPrivateRead,
} from "./cart-edit-private-read.js";
import { writeCartMutation } from "./cart-edit-write.js";
import { cartTimestamp } from "./cart-runtime-data.js";
import { draftRows } from "./content-draft-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";
export function createCartEditRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): CartEditRepository {
  const run = <Result>(work: () => Promise<Result>): Promise<Result> =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof CartEditRepositoryError) throw error;
        if (error instanceof CartRuntimeRepositoryError)
          throw new CartEditRepositoryError(error.code);
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  return {
    loadItemForUpdate(input) {
      return run(async () => {
        const parsed = cartEditLoadItemCommandSchema.safeParse(input);
        if (!parsed.success) return rejectCartEdit("INVALID_COMMAND");
        return loadEditableCartItem(client, parsed.data);
      });
    },
    loadPrivateForEdit(input) {
      return run(async () => {
        const parsed = cartEditLoadPrivateCommandSchema.safeParse(input);
        if (!parsed.success) return rejectCartEdit("INVALID_COMMAND");
        return loadCartPrivateForEdit(client, parsed.data);
      });
    },
    confirmPrivateRead(input) {
      return run(async () => {
        const parsed = cartEditConfirmPrivateCommandSchema.safeParse(input);
        if (!parsed.success) return rejectCartEdit("INVALID_COMMAND");
        return confirmCartPrivateRead(client, parsed.data);
      });
    },
    writeMutation(input) {
      return run(async () => {
        const parsed = cartEditWriteMutationCommandSchema.safeParse(input);
        if (!parsed.success) return rejectCartEdit("INVALID_COMMAND");
        return writeCartMutation(client, parsed.data);
      });
    },
    findMutationReceipt(input) {
      return run(async () => {
        const parsed =
          cartEditFindMutationReceiptCommandSchema.safeParse(input);
        if (!parsed.success) return rejectCartEdit("INVALID_COMMAND");
        const command = parsed.data;
        await authorizedEditCart(
          client,
          command.accesses,
          command.cartId,
          false,
        );
        const rows = await draftRows(
          client,
          `SELECT receipt_id,cart_id,cart_item_id,support_intent_id,mutation_kind,cart_version::text,item_version::text,intent_version::text,${cartTimestamp("occurred_at")} occurred_at FROM public.cart_item_mutation_receipts WHERE receipt_id=$1::uuid AND cart_id=$2::uuid`,
          [command.receiptId, command.cartId],
        );
        if (rows.length > 1) return rejectCartEdit("CONTENT_UNAVAILABLE");
        return rows[0] ? cartMutationReceipt(rows[0]) : null;
      });
    },
  };
}
