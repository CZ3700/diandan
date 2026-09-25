import { expect, test } from "vitest";

import * as contracts from "./index.js";

test("exposes the contracts workspace boundary", () => {
  expect(contracts.workspacePackageName).toBe("@fan-support/contracts");
  expect(contracts.CONTRACT_SCHEMA_VERSION).toBe(1);
  expect(contracts.schemaVersionSchema).toBeDefined();
  expect(contracts.supportedLocaleSchema).toBeDefined();
  expect(contracts.cartGiftContextSchema).toBeDefined();
  expect(contracts.checkoutQuoteSchema).toBeDefined();
  expect(contracts.orderSchema).toBeDefined();
  expect(contracts.paymentAttemptSchema).toBeDefined();
  expect(contracts.providerEventSchema).toBeDefined();
  expect(contracts.eventEnvelopeSchema).toBeDefined();
  expect(contracts.publicErrorEnvelopeSchema).toBeDefined();
  expect("contractArtifactRegistry" in contracts).toBe(false);
  expect("renderContractArtifactDocuments" in contracts).toBe(false);
});
