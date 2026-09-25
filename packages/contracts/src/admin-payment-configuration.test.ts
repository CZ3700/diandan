import { describe, expect, it } from "vitest";
const contracts = await import("./admin-payment-configuration.js").catch(
  () => undefined,
);
const id = "10000000-0000-4000-8000-000000000001";
const key = "configuration-command-001";
const validationContracts =
  await import("./payment-configuration-validation.js");
const publish = {
  schemaVersion: 1,
  action: "PUBLISH",
  revisionId: id,
  expectedPublicationId: null,
  validationHash: "a".repeat(64),
  reasonCode: "OPERATOR_CHANGE",
  confirmed: true,
  idempotencyKey: key,
};
describe("payment configuration management boundary", () => {
  it("canonicalizes UUID casing before hashing or persisting configuration commands", () => {
    const uppercase = "A0000000-B000-4000-8000-000000000001";
    const parsed = contracts!.adminPaymentConfigurationCommandSchema.parse({
      ...publish,
      revisionId: uppercase,
      expectedPublicationId: uppercase,
    });
    expect(parsed).toMatchObject({
      revisionId: uppercase.toLowerCase(),
      expectedPublicationId: uppercase.toLowerCase(),
    });
    const document = contracts!.paymentConfigurationDocumentSchema.parse({
      schemaVersion: 1,
      channels: [
        {
          providerAccountId: uppercase,
          enabled: false,
          displayOrder: 0,
          rolloutBasisPoints: 0,
          healthPolicy: {
            failureThreshold: 3,
            failureWindowMs: 1000,
            openDurationMs: 1000,
            probeLeaseMs: 1000,
            probeRetryMs: 1000,
          },
          translations: [],
        },
      ],
      routes: [],
    });
    expect(document.channels[0]!.providerAccountId).toBe(
      uppercase.toLowerCase(),
    );
  });
  it("can describe replacement of every channel and route without truncating differences", () => {
    const diff = Array.from({ length: 600 }, (_, index) => ({
      kind: "ROUTE",
      key: `difference-${index}`,
      change: "ADDED",
      fields: [],
    }));
    expect(
      validationContracts.paymentConfigurationDiffResultSchema.safeParse({
        schemaVersion: 1,
        diff,
      }).success,
    ).toBe(true);
    expect(
      contracts!.adminPaymentConfigurationResponseSchema.safeParse({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "VALIDATION",
        revisionId: id,
        expectedPublicationId: null,
        mode: "PUBLISH",
        valid: true,
        validationHash: "a".repeat(64),
        issues: [],
        diff,
      }).success,
    ).toBe(true);
    expect(
      validationContracts.paymentConfigurationDiffResultSchema.safeParse({
        schemaVersion: 1,
        diff: [...diff, diff[0]],
      }).success,
    ).toBe(false);
  });
  it("requires an exact reviewed candidate and confirmation for publication", () => {
    expect(contracts?.adminPaymentConfigurationCommandSchema).toBeDefined();
    const schema = contracts!.adminPaymentConfigurationCommandSchema;
    expect(schema.safeParse(publish).success).toBe(true);
    for (const patch of [
      { confirmed: false },
      { validationHash: "" },
      { reasonCode: "" },
      { idempotencyKey: "" },
      { revisionId: "" },
      { code: "eval()" },
      { credentialRef: "secret-ref:v1:test:foo" },
    ])
      expect(schema.safeParse({ ...publish, ...patch }).success).toBe(false);
  });
  it("keeps draft authoring separate from seven-language approval", () => {
    expect(contracts?.adminPaymentConfigurationCommandSchema).toBeDefined();
    const schema = contracts!.adminPaymentConfigurationCommandSchema;
    const save = {
      schemaVersion: 1,
      action: "SAVE",
      sourceRevisionId: null,
      expectedPublicationId: null,
      idempotencyKey: key,
      configuration: { schemaVersion: 1, channels: [], routes: [] },
    };
    expect(schema.safeParse(save).success).toBe(true);
    expect(schema.safeParse({ ...save, approved: true }).success).toBe(false);
    expect(
      schema.safeParse({
        schemaVersion: 1,
        action: "APPROVE",
        revisionId: id,
        providerAccountId: id,
        locale: "zh-CN",
        idempotencyKey: key,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        schemaVersion: 1,
        action: "APPROVE",
        revisionId: id,
        providerAccountId: id,
        locale: "fr",
        idempotencyKey: key,
      }).success,
    ).toBe(false);
  });
  it("validates rollback explicitly and never accepts arbitrary executable adapters", () => {
    expect(contracts?.adminPaymentConfigurationCommandSchema).toBeDefined();
    const schema = contracts!.adminPaymentConfigurationCommandSchema;
    expect(schema.safeParse({ ...publish, action: "ROLLBACK" }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({
        schemaVersion: 1,
        action: "VALIDATE",
        revisionId: id,
        expectedPublicationId: null,
        mode: "ROLLBACK",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        schemaVersion: 1,
        action: "UPLOAD_ADAPTER",
        code: "run",
      }).success,
    ).toBe(false);
  });
});
