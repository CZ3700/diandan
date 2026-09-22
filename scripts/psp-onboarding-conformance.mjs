import assert from "node:assert/strict";
import { createFakePaymentProvider } from "../packages/payment-fake/dist/index.js";
import { runPaymentProviderConformance } from "../packages/testing/dist/index.js";

// Formal seven-operation provider suite only. Endpoint-scoped webhook verification
// is exercised separately by adapter-tests; the legacy parser is not a live port.
const report = await runPaymentProviderConformance(createFakePaymentProvider());
console.log(
  JSON.stringify(
    { schemaVersion: 1, environment: "TEST", commercialSandbox: false, report },
    null,
    2,
  ),
);
assert.equal(report.passed, true, "Shared fake provider conformance must pass");
assert.equal(report.cases.length, 15, "Run the entire shared suite");
