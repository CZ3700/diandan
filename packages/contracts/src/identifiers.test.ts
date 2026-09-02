import { expect, test } from "vitest";

import {
  cartAccessTokenSchema,
  externalPaymentReferenceSchema,
  giftIdSchema,
  idolIdSchema,
  merchantReferenceSchema,
  orderAccessTokenSchema,
  paymentReturnStateSchema,
  providerClientTokenSchema,
  providerEventReferenceSchema,
  type CartAccessToken,
  type ExternalPaymentReference,
  type GiftId,
  type IdolId,
  type MerchantReference,
  type OrderAccessToken,
  type PaymentReturnState,
  type ProviderClientToken,
  type ProviderEventReference,
} from "./identifiers.js";

test("defines bounded opaque tokens and provider references", async () => {
  const identifiers = await import("./identifiers.js");
  expect(identifiers.cartAccessTokenSchema).toBeDefined();
  expect(identifiers.orderAccessTokenSchema).toBeDefined();
  expect(identifiers.providerReferenceSchema).toBeDefined();

  const token = "A".repeat(43);
  expect(identifiers.cartAccessTokenSchema?.safeParse(token).success).toBe(
    true,
  );
  expect(identifiers.orderAccessTokenSchema?.safeParse(token).success).toBe(
    true,
  );
  expect(
    identifiers.cartAccessTokenSchema?.safeParse("short-token").success,
  ).toBe(false);
  expect(
    identifiers.providerReferenceSchema?.safeParse("evt_123").success,
  ).toBe(true);
  expect(identifiers.supportIntentIdSchema.safeParse("evt_123").success).toBe(
    false,
  );
});

test("does not allow platform IDs or access-token brands to be interchanged", () => {
  const idolId = idolIdSchema.parse("c24a7022-5ab1-4fe6-bc3e-c69f4fa7af7a");
  const giftId = giftIdSchema.parse("7fd728b5-4304-4de8-bd09-f62f315b4a0c");
  const cartToken = cartAccessTokenSchema.parse("A".repeat(43));
  const orderToken = orderAccessTokenSchema.parse("B".repeat(43));
  const acceptIdolId = (value: IdolId) => value;
  const acceptGiftId = (value: GiftId) => value;
  const acceptCartToken = (value: CartAccessToken) => value;
  const acceptOrderToken = (value: OrderAccessToken) => value;

  expect(acceptIdolId(idolId)).toBe(idolId);
  expect(acceptGiftId(giftId)).toBe(giftId);
  expect(acceptCartToken(cartToken)).toBe(cartToken);
  expect(acceptOrderToken(orderToken)).toBe(orderToken);
  // @ts-expect-error GiftId must never be accepted as IdolId.
  acceptIdolId(giftId);
  // @ts-expect-error IdolId must never be accepted as GiftId.
  acceptGiftId(idolId);
  // @ts-expect-error Cart tokens must never authorize order access.
  acceptOrderToken(cartToken);
  // @ts-expect-error Order tokens must never authorize cart access.
  acceptCartToken(orderToken);
});

test("does not interchange browser state, client tokens, and provider references", () => {
  const attemptId = "0be91762-1464-45bc-b0c5-d87f03e81d7e";
  const merchantReference = merchantReferenceSchema.parse(attemptId);
  const returnState = paymentReturnStateSchema.parse("R".repeat(43));
  const clientToken = providerClientTokenSchema.parse("C".repeat(43));
  const externalReference = externalPaymentReferenceSchema.parse("pay_123");
  const eventReference = providerEventReferenceSchema.parse("evt_123");
  const acceptMerchantReference = (value: MerchantReference) => value;
  const acceptReturnState = (value: PaymentReturnState) => value;
  const acceptClientToken = (value: ProviderClientToken) => value;
  const acceptExternalReference = (value: ExternalPaymentReference) => value;
  const acceptEventReference = (value: ProviderEventReference) => value;

  expect(acceptMerchantReference(merchantReference)).toBe(attemptId);
  expect(acceptReturnState(returnState)).toBe(returnState);
  expect(acceptClientToken(clientToken)).toBe(clientToken);
  expect(acceptExternalReference(externalReference)).toBe(externalReference);
  expect(acceptEventReference(eventReference)).toBe(eventReference);
  // @ts-expect-error Browser return state must never be a provider client token.
  acceptClientToken(returnState);
  // @ts-expect-error Provider client tokens must never be merchant references.
  acceptMerchantReference(clientToken);
  // @ts-expect-error External payment references are not provider event IDs.
  acceptEventReference(externalReference);
  // @ts-expect-error Provider event IDs are not external payment references.
  acceptExternalReference(eventReference);
});
