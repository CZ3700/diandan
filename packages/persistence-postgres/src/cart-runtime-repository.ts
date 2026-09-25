import { Buffer } from "node:buffer";
import {
  cartRuntimeInitializeRecordCommandSchema,
  cartRuntimeCredentialCommandSchema,
  cartRuntimeListItemsCommandSchema,
  cartRuntimeResolveGiftCommandSchema,
  cartRuntimeResolvedGiftSchema,
  cartRuntimeAppendItemCommandSchema,
  cartRuntimeFindReceiptCommandSchema,
  cartRuntimeReceiptSchema,
  type CartRuntimeAccesses,
  type CartRuntimeHeader,
} from "@fan-support/contracts";
import {
  CartRuntimeRepositoryError,
  type CartRuntimeRepository,
} from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import { hasStorefrontMarket } from "./storefront-commerce-data.js";
import {
  cartHeader,
  cartHeaderColumns,
  cartItemRecord,
  cartReceipt,
  cartTimestamp,
  findCartForUpdate,
} from "./cart-runtime-data.js";
import {
  persistenceTransactionFailureFromPostgres,
  type TransactionClient,
  type TransactionScopeControl,
} from "./transaction-runner.js";

const sameId = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();
const encryptedBytes = (value: string | null) =>
  value === null
    ? null
    : Buffer.from(value.slice("enc:v1:".length), "base64url");
const reject = (
  code: ConstructorParameters<typeof CartRuntimeRepositoryError>[0],
): never => {
  throw new CartRuntimeRepositoryError(code);
};

/** Only a transaction that has proved the credential can enumerate its cart. */
export function createCartRuntimeRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
): CartRuntimeRepository {
  const authorized = new Map<string, CartRuntimeAccesses>();
  const run = <Result>(work: () => Promise<Result>): Promise<Result> =>
    scope.trackOperation(async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof CartRuntimeRepositoryError) throw error;
        throw persistenceTransactionFailureFromPostgres(error);
      }
    });
  const remember = (
    header: CartRuntimeHeader,
    accesses: CartRuntimeAccesses,
  ) => {
    authorized.set(header.id.toLowerCase(), accesses);
    return header;
  };
  const authorizedCart = async (cartId: string) => {
    const accesses = authorized.get(cartId.toLowerCase());
    if (!accesses) return reject("INVALID_ACCESS");
    const header = await findCartForUpdate(client, accesses);
    if (!header || !sameId(header.id, cartId)) return reject("INVALID_ACCESS");
    if (header.expired || header.status === "EXPIRED")
      return reject("CART_EXPIRED");
    return header;
  };
  return {
    initialize(input) {
      return run(async () => {
        const parsed =
          cartRuntimeInitializeRecordCommandSchema.safeParse(input);
        if (!parsed.success) return reject("INVALID_COMMAND");
        const command = parsed.data;
        const existing = await findCartForUpdate(client, command.accesses);
        if (existing) {
          if (existing.expired || existing.status === "EXPIRED")
            return reject("CART_EXPIRED");
          if (
            existing.market !== command.market ||
            existing.currency !== command.currency
          )
            return reject("SCOPE_MISMATCH");
          return remember(existing, command.accesses);
        }
        if (
          !(await hasStorefrontMarket(client, command.market, command.currency))
        )
          return reject("COMMERCE_UNAVAILABLE");
        const active = command.accesses[0]!;
        const rows = await draftRows(
          client,
          `WITH instant AS MATERIALIZED (SELECT clock_timestamp() now)
         INSERT INTO public.carts AS c(id,token_digest,token_pepper_version,presentation_locale,market,currency,status,version,expires_at,created_at,updated_at)
         SELECT $1,decode($2,'hex'),$3,$4,$5,$6,'ACTIVE',1,$7::timestamptz,instant.now,instant.now FROM instant WHERE $7::timestamptz>instant.now
         ON CONFLICT(token_pepper_version,token_digest) DO NOTHING RETURNING ${cartHeaderColumns}`,
          [
            command.cartId,
            active.tokenDigest,
            active.pepperVersion,
            command.presentationLocale,
            command.market,
            command.currency,
            command.expiresAt,
          ],
        );
        if (rows.length > 1) return reject("INVALID_ACCESS");
        const header = rows[0]
          ? cartHeader(rows[0])
          : await findCartForUpdate(client, command.accesses);
        if (!header) return reject("CART_EXPIRED");
        if (
          header.market !== command.market ||
          header.currency !== command.currency
        )
          return reject("SCOPE_MISMATCH");
        if (header.expired || header.status === "EXPIRED")
          return reject("CART_EXPIRED");
        return remember(header, command.accesses);
      });
    },
    findByCredentialForUpdate(input) {
      return run(async () => {
        const parsed = cartRuntimeCredentialCommandSchema.safeParse(input);
        if (!parsed.success) return reject("INVALID_ACCESS");
        const header = await findCartForUpdate(client, parsed.data.accesses);
        return header ? remember(header, parsed.data.accesses) : null;
      });
    },
    listItems(input) {
      return run(async () => {
        const parsed = cartRuntimeListItemsCommandSchema.safeParse(input);
        if (!parsed.success) return reject("INVALID_COMMAND");
        const { cartId } = parsed.data;
        await authorizedCart(cartId);
        const rows = await draftRows(
          client,
          `SELECT item.id,item.cart_id,variant.gift_id,item.gift_variant_id,intent.idol_id,
         item.version::text,item.quantity,item.observed_price_id,item.display_mode,item.has_fan_message
         FROM public.cart_items item LEFT JOIN public.support_intents intent ON intent.cart_item_id=item.id
         LEFT JOIN public.gift_variants variant ON variant.id=item.gift_variant_id
         WHERE item.cart_id=$1 AND intent.status IS DISTINCT FROM 'CANCELED' ORDER BY item.created_at,item.id`,
          [cartId],
        );
        return rows.map(cartItemRecord);
      });
    },
    resolveGiftHandle(input) {
      return run(async () => {
        const parsed = cartRuntimeResolveGiftCommandSchema.safeParse(input);
        if (!parsed.success) return reject("INVALID_COMMAND");
        const rows = await draftRows(
          client,
          `SELECT gift.id,gift.handle FROM public.gifts gift JOIN public.gift_variants variant ON variant.gift_id=gift.id
         WHERE gift.id=$1 AND variant.id=$2 FOR SHARE OF gift,variant`,
          [parsed.data.giftId, parsed.data.giftVariantId],
        );
        if (rows.length > 1) return reject("CONTENT_UNAVAILABLE");
        return rows[0]
          ? cartRuntimeResolvedGiftSchema.parse({
              schemaVersion: 1,
              giftId: rows[0]["id"],
              handle: rows[0]["handle"],
            })
          : null;
      });
    },
    appendItem(input) {
      return run(async () => {
        const parsed = cartRuntimeAppendItemCommandSchema.safeParse(input);
        if (!parsed.success) return reject("INVALID_COMMAND");
        const command = parsed.data;
        const cart = await findCartForUpdate(client, command.accesses);
        if (!cart || !sameId(cart.id, command.cartId))
          return reject("INVALID_ACCESS");
        if (cart.expired || cart.status === "EXPIRED")
          return reject("CART_EXPIRED");
        if (cart.status !== "ACTIVE") return reject("CART_LOCKED");
        if (cart.version !== command.expectedCartVersion)
          return reject("IN_PROGRESS");
        remember(cart, command.accesses);
        const [item] = await draftRows(
          client,
          `INSERT INTO public.cart_items(id,cart_id,gift_variant_id,observed_price_id,quantity,display_mode,has_fan_message,request_id,correlation_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,version::text,${cartTimestamp("created_at")} occurred_at`,
          [
            command.cartItemId,
            cart.id,
            command.giftVariantId,
            command.observedPriceId,
            command.quantity,
            command.displayMode,
            command.privateContent.fanMessageCiphertext !== null,
            command.requestId,
            command.correlationId,
          ],
        );
        if (!item) return reject("TEMPORARY_UNAVAILABLE");
        await client.query(
          `INSERT INTO public.support_intents(id,cart_item_id,idol_id,fan_message_ciphertext,display_mode,display_name_ciphertext,encrypted_data_key,encryption_key_version,
         moderation_status,created_presentation_locale,fan_message_locale,status,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDING',$9,$10,'ACTIVE',$11)`,
          [
            command.supportIntentId,
            command.cartItemId,
            command.idolId,
            encryptedBytes(command.privateContent.fanMessageCiphertext),
            command.displayMode,
            encryptedBytes(command.privateContent.displayNameCiphertext),
            encryptedBytes(command.privateContent.encryptedDataKey),
            command.privateContent.encryptionKeyVersion,
            command.createdPresentationLocale,
            command.fanMessageLocale,
            cart.expiresAt,
          ],
        );
        const updated = await draftRows(
          client,
          `UPDATE public.carts AS c SET version=c.version+1,presentation_locale=$3,
         updated_at=GREATEST(clock_timestamp(),c.created_at,c.updated_at)
         WHERE c.id=$1 AND c.version=$2 AND c.status='ACTIVE' AND c.expires_at>clock_timestamp()
         RETURNING ${cartHeaderColumns}`,
          [cart.id, cart.version, command.createdPresentationLocale],
        );
        if (updated.length !== 1) return reject("CART_EXPIRED");
        const header = cartHeader(updated[0]!);
        return cartRuntimeReceiptSchema.parse({
          schemaVersion: 1,
          cartId: cart.id,
          cartItemId: command.cartItemId,
          supportIntentId: command.supportIntentId,
          cartVersion: header.version,
          itemVersion: Number(item["version"]),
          occurredAt: item["occurred_at"],
        });
      });
    },
    findReceipt(input) {
      return run(async () => {
        const parsed = cartRuntimeFindReceiptCommandSchema.safeParse(input);
        if (!parsed.success) return reject("INVALID_COMMAND");
        const { cartId, cartItemId } = parsed.data;
        await authorizedCart(cartId);
        const rows = await draftRows(
          client,
          `SELECT item.cart_id,item.id cart_item_id,intent.id support_intent_id,event.aggregate_version::text cart_version,
         item.version::text item_version,${cartTimestamp("item.created_at")} occurred_at
         FROM public.cart_items item JOIN public.support_intents intent ON intent.cart_item_id=item.id
         JOIN public.outbox_events event ON event.event_type='CART_ITEM_ADDED' AND event.aggregate_type='CART'
          AND event.aggregate_id=item.cart_id AND event.primary_subject_id=item.cart_id AND event.secondary_subject_id=item.id
          AND event.request_id=item.request_id AND event.correlation_id=item.correlation_id AND event.occurred_at=item.created_at
         WHERE item.cart_id=$1 AND item.id=$2`,
          [cartId, cartItemId],
        );
        if (rows.length > 1) return reject("CONTENT_UNAVAILABLE");
        return rows[0] ? cartReceipt(rows[0]) : null;
      });
    },
  };
}
