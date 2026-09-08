import {
  cartEditPrivateSnapshotSchema,
  type CartEditLoadPrivateCommand,
  type CartEditConfirmPrivateCommand,
} from "@fan-support/contracts";
import { draftRows } from "./content-draft-data.js";
import {
  loadEditableCartItem,
  privateContentFromRow,
  rejectCartEdit,
} from "./cart-edit-data.js";
import type { TransactionClient } from "./transaction-runner.js";
export async function loadCartPrivateForEdit(
  client: TransactionClient,
  command: CartEditLoadPrivateCommand,
) {
  const snapshot = await loadEditableCartItem(client, command);
  if (!snapshot) return null;
  const rows = await draftRows(
    client,
    `WITH audit AS (
 INSERT INTO public.audit_logs(id,actor_type,task_name,action,subject_type,subject_id,request_id,correlation_id,outcome,field_category,created_at)
 VALUES(gen_random_uuid(),'SYSTEM','cart-private-editor','AUTHORIZE_PRIVATE_EDIT_READ','SUPPORT_INTENT',$1::uuid,$2::uuid,$3::uuid,'SUCCEEDED','SUPPORT_INTENT_PRIVATE',clock_timestamp()) RETURNING id),
 access AS (INSERT INTO public.cart_private_access_receipts(access_audit_id,cart_id,cart_item_id,support_intent_id,cart_version,item_version,intent_version,request_id,correlation_id)
 SELECT id,$4::uuid,$5::uuid,$1::uuid,$6::bigint,$7::bigint,$8::bigint,$2::uuid,$3::uuid FROM audit RETURNING access_audit_id)
 SELECT access.access_audit_id,intent.fan_message_ciphertext,intent.display_name_ciphertext,intent.encrypted_data_key,intent.encryption_key_version
 FROM access CROSS JOIN public.support_intents intent WHERE intent.id=$1::uuid`,
    [
      snapshot.supportIntentId,
      command.requestId,
      command.correlationId,
      snapshot.cart.id,
      snapshot.item.id,
      snapshot.cart.version,
      snapshot.item.version,
      snapshot.intentVersion,
    ],
  );
  if (rows.length !== 1) return rejectCartEdit("CONTENT_UNAVAILABLE");
  return cartEditPrivateSnapshotSchema.parse({
    schemaVersion: 1,
    snapshot,
    accessAuditId: rows[0]!["access_audit_id"],
    privateContent: privateContentFromRow(rows[0]!),
  });
}
export async function confirmCartPrivateRead(
  client: TransactionClient,
  command: CartEditConfirmPrivateCommand,
) {
  const snapshot = await loadEditableCartItem(client, command);
  if (!snapshot) return rejectCartEdit("ITEM_NOT_FOUND");
  if (snapshot.intentVersion !== command.expectedIntentVersion)
    return rejectCartEdit("VERSION_CONFLICT");
  const rows = await draftRows(
    client,
    `SELECT access.access_audit_id FROM public.cart_private_access_receipts access
 JOIN public.audit_logs audit ON audit.id=access.access_audit_id
 WHERE access.access_audit_id=$1::uuid AND access.cart_id=$2::uuid AND access.cart_item_id=$3::uuid
 AND access.support_intent_id=$4::uuid AND access.cart_version=$5::bigint AND access.item_version=$6::bigint AND access.intent_version=$7::bigint
 AND access.request_id=$8::uuid AND access.correlation_id=$9::uuid
 AND audit.action='AUTHORIZE_PRIVATE_EDIT_READ' AND audit.outcome='SUCCEEDED'`,
    [
      command.accessAuditId,
      command.cartId,
      command.itemId,
      snapshot.supportIntentId,
      command.expectedCartVersion,
      command.expectedItemVersion,
      command.expectedIntentVersion,
      command.requestId,
      command.correlationId,
    ],
  );
  if (rows.length !== 1) return rejectCartEdit("VERSION_CONFLICT");
  return snapshot;
}
