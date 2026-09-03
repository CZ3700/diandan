import { expect, test } from "vitest";

import {
  giftRevisionIdSchema,
  giftRevisionTranslationSchema,
  giftTranslationFieldsSchema,
  giftVariantIdSchema,
  idolRevisionIdSchema,
  idolRevisionTranslationSchema,
  policyRevisionTranslationSchema,
  publishedPolicyViewSchema,
  sourceHashSchema,
  translationImportPackageSchema,
} from "@fan-support/contracts";

import {
  computeGiftTranslationContentHash,
  computeIdolTranslationContentHash,
  computePolicyTranslationContentHash,
} from "./hashing.js";
import { validateTranslationImportPackage } from "./translation-validation.js";

const EDITOR_ID = "34d657b6-93b2-470f-a777-4ce1f98914e0";
const REVIEWER_ID = "c64367a8-350a-4fa5-b866-17ceeea511e0";
const GIFT_REVISION_ID = "1045cb31-735a-4c90-81bf-7af2b2dc8ee7";
const OTHER_GIFT_REVISION_ID = "9c8c5c5a-82db-4f0c-9d1a-4446200924ec";
const IDOL_REVISION_ID = "ea191a79-df54-410d-a32e-f966451976fb";
const POLICY_REVISION_ID = "a8cdbe6d-6bc5-4191-9ecb-ef31dfcf39a4";
const IMPORT_BATCH_ID = "efec393d-d18a-4f3b-9fc1-58909a749aaf";
const TRANSLATION_ID = "9c0b2754-92ce-49c2-b909-27a0dd0af735";
const VARIANT_ID = giftVariantIdSchema.parse(
  "3f15ce90-171b-4c76-8238-118212242295",
);

const englishGiftFields = {
  title: "Aurora Keepsake",
  subtitle: "A bright fictional celebration",
  shortDescription: "A fictional keepsake for deterministic tests.",
  description: "A fictional gift prepared by the test platform.",
  fulfillmentDescription: "The platform prepares and delivers this gift.",
  variantLabels: [
    {
      giftVariantId: VARIANT_ID,
      label: "Standard",
    },
  ],
  seoTitle: "Aurora Keepsake gift",
  seoDescription: "A fictional gift page used for contract tests.",
} as const;

const spanishGiftFields = {
  title: "Recuerdo Aurora",
  subtitle: "Una celebración ficticia y luminosa",
  shortDescription: "Un recuerdo ficticio para pruebas deterministas.",
  description: "Un regalo ficticio preparado por la plataforma de prueba.",
  fulfillmentDescription: "La plataforma prepara y entrega este regalo.",
  variantLabels: [
    {
      giftVariantId: VARIANT_ID,
      label: "Estándar",
    },
  ],
  seoTitle: "Regalo Recuerdo Aurora",
  seoDescription: "Una página ficticia usada para pruebas de contrato.",
} as const;

const englishGiftHash = sourceHashSchema.parse(
  computeGiftTranslationContentHash(englishGiftFields),
);
const spanishGiftHash = sourceHashSchema.parse(
  computeGiftTranslationContentHash(spanishGiftFields),
);

function trustedGiftTarget(
  currentEnglishSourceHash = englishGiftHash,
  parentRevisionId = GIFT_REVISION_ID,
) {
  return {
    objectKind: "GIFT" as const,
    parentRevisionId: giftRevisionIdSchema.parse(parentRevisionId),
    currentEnglishSourceHash,
  };
}

function giftImportPackageWithFields(
  englishSourceInput: unknown,
  fieldsInput: unknown,
): Record<string, unknown> {
  const englishSource = giftTranslationFieldsSchema.parse(englishSourceInput);
  const fields = giftTranslationFieldsSchema.parse(fieldsInput);
  return {
    ...validGiftImportPackage(),
    expectedEnglishSourceHash: sourceHashSchema.parse(
      computeGiftTranslationContentHash(englishSource),
    ),
    contentHash: sourceHashSchema.parse(
      computeGiftTranslationContentHash(fields),
    ),
    context: { englishSource },
    fields,
  };
}

function validGiftImportPackage(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    objectKind: "GIFT",
    parentRevisionId: GIFT_REVISION_ID,
    locale: "es",
    expectedEnglishSourceHash: englishGiftHash,
    contentHash: spanishGiftHash,
    origin: "IMPORT",
    importBatchId: IMPORT_BATCH_ID,
    review: { status: "DRAFT" },
    context: { englishSource: englishGiftFields },
    fields: spanishGiftFields,
  };
}

function approvedAudit(contentHash: string, englishSourceHash: string) {
  return {
    locale: "es",
    sourceHash: contentHash,
    translatedFromSourceHash: englishSourceHash,
    origin: "MACHINE",
    editorId: EDITOR_ID,
    editedAt: "2026-09-03T01:00:00Z",
    review: {
      status: "APPROVED",
      reviewerId: REVIEWER_ID,
      reviewedAt: "2026-09-03T02:00:00Z",
      reviewedSourceHash: englishSourceHash,
      reviewedContentHash: contentHash,
    },
  } as const;
}

test("translation create/import packages are strict, versioned, typed drafts", () => {
  const valid = validGiftImportPackage();

  expect(translationImportPackageSchema.safeParse(valid).success).toBe(true);
  expect(
    translationImportPackageSchema.safeParse({
      ...valid,
      review: {
        status: "APPROVED",
        reviewerId: REVIEWER_ID,
        reviewedAt: "2026-09-03T02:00:00Z",
        reviewedSourceHash: englishGiftHash,
        reviewedContentHash: spanishGiftHash,
      },
    }).success,
  ).toBe(false);

  const approvedMachineCommand: Record<string, unknown> = {
    ...valid,
    origin: "MACHINE",
    review: {
      status: "APPROVED",
      reviewerId: REVIEWER_ID,
      reviewedAt: "2026-09-03T02:00:00Z",
      reviewedSourceHash: englishGiftHash,
      reviewedContentHash: spanishGiftHash,
    },
  };
  delete approvedMachineCommand["importBatchId"];
  expect(
    translationImportPackageSchema.safeParse(approvedMachineCommand).success,
  ).toBe(false);
  expect(
    translationImportPackageSchema.safeParse({
      ...valid,
      importBatchId: undefined,
    }).success,
  ).toBe(false);
  expect(
    translationImportPackageSchema.safeParse({
      ...valid,
      fields: {
        ...spanishGiftFields,
        payload: { arbitrary: "generic JSON bags are forbidden" },
      },
    }).success,
  ).toBe(false);
  expect(
    translationImportPackageSchema.safeParse({
      ...valid,
      schemaVersion: 2,
    }).success,
  ).toBe(false);

  const machineDraft: Record<string, unknown> = {
    ...valid,
    origin: "MACHINE",
  };
  delete machineDraft["importBatchId"];
  expect(translationImportPackageSchema.safeParse(machineDraft).success).toBe(
    true,
  );
  expect(
    translationImportPackageSchema.safeParse({
      ...machineDraft,
      importBatchId: IMPORT_BATCH_ID,
    }).success,
  ).toBe(false);
});

test("validates current English provenance and recomputes typed content hashes", () => {
  expect(
    validateTranslationImportPackage(
      validGiftImportPackage(),
      trustedGiftTarget(),
    ),
  ).toEqual({
    schemaVersion: 1,
    valid: true,
    contentHash: spanishGiftHash,
    issues: [],
  });

  const stale = validateTranslationImportPackage(
    validGiftImportPackage(),
    trustedGiftTarget(sourceHashSchema.parse("f".repeat(64))),
  );
  expect(stale.valid).toBe(false);
  expect(stale.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "STALE_ENGLISH_SOURCE" }),
    ]),
  );

  const changedEnglishContext = validGiftImportPackage();
  changedEnglishContext["context"] = {
    englishSource: {
      ...englishGiftFields,
      title: "Changed after export",
    },
  };
  expect(
    validateTranslationImportPackage(changedEnglishContext, trustedGiftTarget())
      .issues,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "ENGLISH_CONTEXT_HASH_MISMATCH" }),
    ]),
  );

  const tamperedTranslation = validGiftImportPackage();
  tamperedTranslation["fields"] = {
    ...spanishGiftFields,
    title: "Contenido modificado",
  };
  expect(
    validateTranslationImportPackage(tamperedTranslation, trustedGiftTarget())
      .issues,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "CONTENT_HASH_MISMATCH" }),
    ]),
  );
});

test("binds an import package to the trusted object kind and parent revision", () => {
  const sameHashOtherParent = validateTranslationImportPackage(
    validGiftImportPackage(),
    trustedGiftTarget(englishGiftHash, OTHER_GIFT_REVISION_ID),
  );
  expect(sameHashOtherParent.valid).toBe(false);
  expect(sameHashOtherParent.issues).toEqual([
    { code: "TARGET_MISMATCH", path: ["parentRevisionId"] },
  ]);

  const sameHashOtherObject = validateTranslationImportPackage(
    validGiftImportPackage(),
    {
      objectKind: "IDOL",
      parentRevisionId: idolRevisionIdSchema.parse(IDOL_REVISION_ID),
      currentEnglishSourceHash: englishGiftHash,
    },
  );
  expect(sameHashOtherObject.valid).toBe(false);
  expect(sameHashOtherObject.issues).toEqual([
    { code: "TARGET_MISMATCH", path: ["objectKind"] },
  ]);
});

test("canonicalizes gift variant UUID case before hashing", () => {
  const uppercaseVariantId = giftVariantIdSchema.parse(
    String(VARIANT_ID).toUpperCase(),
  );
  expect(
    computeGiftTranslationContentHash({
      ...englishGiftFields,
      variantLabels: [
        {
          ...englishGiftFields.variantLabels[0],
          giftVariantId: uppercaseVariantId,
        },
      ],
    }),
  ).toBe(computeGiftTranslationContentHash(englishGiftFields));
});

test("matches ICU variables in keyed label arrays independent of record order", () => {
  const secondVariantId = giftVariantIdSchema.parse(
    "4a18af13-f996-43f5-87a2-b9716e96a8fa",
  );
  const englishWithKeyedLabels = {
    ...englishGiftFields,
    variantLabels: [
      { giftVariantId: VARIANT_ID, label: "Standard for {recipient}" },
      { giftVariantId: secondVariantId, label: "Deluxe x {count}" },
    ],
  };
  const spanishWithReorderedLabels = {
    ...spanishGiftFields,
    variantLabels: [
      { giftVariantId: secondVariantId, label: "De lujo x {count}" },
      { giftVariantId: VARIANT_ID, label: "Estándar para {recipient}" },
    ],
  };
  const englishHash = sourceHashSchema.parse(
    computeGiftTranslationContentHash(englishWithKeyedLabels),
  );

  expect(
    validateTranslationImportPackage(
      giftImportPackageWithFields(
        englishWithKeyedLabels,
        spanishWithReorderedLabels,
      ),
      trustedGiftTarget(englishHash),
    ).valid,
  ).toBe(true);
});

test("rejects translation fields with a different ICU variable set", () => {
  const englishWithIcu = {
    ...englishGiftFields,
    description:
      "{recipient} receives {count, number} gifts on {deliveryDate, date}.",
  } as const;
  const spanishMissingVariable = {
    ...spanishGiftFields,
    description: "{recipient} recibe {count, number} regalos.",
  } as const;
  const englishHash = sourceHashSchema.parse(
    computeGiftTranslationContentHash(englishWithIcu),
  );

  const report = validateTranslationImportPackage(
    giftImportPackageWithFields(englishWithIcu, spanishMissingVariable),
    trustedGiftTarget(englishHash),
  );

  expect(report.valid).toBe(false);
  expect(report.issues).toEqual([
    { code: "ICU_VARIABLE_MISMATCH", path: ["fields", "description"] },
  ]);
});

test.each([
  {
    name: "an unclosed outer brace",
    englishDescription: "{count, plural, one {One gift} other {# gifts}}",
    translatedDescription: "{count, plural, one {Un regalo} other {# regalos}",
  },
  {
    name: "an unsupported argument type",
    englishDescription: "Delivery takes {count, number} days.",
    translatedDescription: "La entrega tarda {count, currency} días.",
  },
  {
    name: "a plural argument without an other branch",
    englishDescription: "{count, plural, one {One gift} other {# gifts}}",
    translatedDescription: "{count, plural, one {Un regalo}}",
  },
  {
    name: "a select argument without an other branch",
    englishDescription: "{state, select, ready {Ready} other {Waiting}}",
    translatedDescription: "{state, select, ready {Listo}}",
  },
])(
  "rejects $name before comparing ICU variables",
  ({ englishDescription, translatedDescription }) => {
    const englishWithIcu = {
      ...englishGiftFields,
      description: englishDescription,
    };
    const spanishWithInvalidIcu = {
      ...spanishGiftFields,
      description: translatedDescription,
    };
    const englishHash = sourceHashSchema.parse(
      computeGiftTranslationContentHash(englishWithIcu),
    );

    const report = validateTranslationImportPackage(
      giftImportPackageWithFields(englishWithIcu, spanishWithInvalidIcu),
      trustedGiftTarget(englishHash),
    );

    expect(report.valid).toBe(false);
    expect(report.issues).toEqual([
      { code: "ICU_SYNTAX_INVALID", path: ["fields", "description"] },
    ]);
  },
);

test("rejects invalid ICU syntax in the bound English source", () => {
  const englishWithInvalidIcu = {
    ...englishGiftFields,
    description: "{count, plural, one {One gift} other {# gifts}",
  };
  const spanishWithIcu = {
    ...spanishGiftFields,
    description: "{count, plural, one {Un regalo} other {# regalos}}",
  };
  const englishHash = sourceHashSchema.parse(
    computeGiftTranslationContentHash(englishWithInvalidIcu),
  );

  const report = validateTranslationImportPackage(
    giftImportPackageWithFields(englishWithInvalidIcu, spanishWithIcu),
    trustedGiftTarget(englishHash),
  );

  expect(report.valid).toBe(false);
  expect(report.issues).toEqual([
    {
      code: "ICU_SYNTAX_INVALID",
      path: ["context", "englishSource", "description"],
    },
  ]);
});

test("accepts matching ICU variables without treating plural/select branch text as variables", () => {
  const englishWithIcu = {
    ...englishGiftFields,
    description:
      "{count, plural, one {{recipient} gets Gift} other {{recipient} gets Gifts}} — {state, select, ready {Ready} other {Waiting}}.",
  } as const;
  const spanishWithIcu = {
    ...spanishGiftFields,
    description:
      "{count, plural, one {{recipient} recibe Regalo} other {{recipient} recibe Regalos}} — {state, select, ready {Listo} other {Esperando}}.",
  } as const;
  const englishHash = sourceHashSchema.parse(
    computeGiftTranslationContentHash(englishWithIcu),
  );
  const spanishHash = sourceHashSchema.parse(
    computeGiftTranslationContentHash(spanishWithIcu),
  );

  expect(
    validateTranslationImportPackage(
      giftImportPackageWithFields(englishWithIcu, spanishWithIcu),
      trustedGiftTarget(englishHash),
    ),
  ).toEqual({
    schemaVersion: 1,
    valid: true,
    contentHash: spanishHash,
    issues: [],
  });
});

test("retains machine provenance after independent human approval", () => {
  const approvedMachineTranslation = {
    schemaVersion: 1,
    id: TRANSLATION_ID,
    giftRevisionId: GIFT_REVISION_ID,
    ...approvedAudit(spanishGiftHash, englishGiftHash),
    origin: "MACHINE",
    ...spanishGiftFields,
  };

  expect(
    giftRevisionTranslationSchema.safeParse(approvedMachineTranslation).success,
  ).toBe(true);
});

test("requires import provenance while allowing an independently approved final row", () => {
  const approvedImport = {
    schemaVersion: 1,
    id: TRANSLATION_ID,
    giftRevisionId: GIFT_REVISION_ID,
    ...approvedAudit(spanishGiftHash, englishGiftHash),
    origin: "IMPORT",
    importBatchId: IMPORT_BATCH_ID,
    ...spanishGiftFields,
  };

  expect(giftRevisionTranslationSchema.safeParse(approvedImport).success).toBe(
    true,
  );
  expect(
    giftRevisionTranslationSchema.safeParse({
      ...approvedImport,
      importBatchId: undefined,
    }).success,
  ).toBe(false);
});

test("includes optional gift subtitles in the canonical content hash", () => {
  expect(computeGiftTranslationContentHash(englishGiftFields)).not.toBe(
    computeGiftTranslationContentHash({
      ...englishGiftFields,
      subtitle: "A different subtitle",
    }),
  );
  expect(
    giftRevisionTranslationSchema.safeParse({
      schemaVersion: 1,
      id: TRANSLATION_ID,
      giftRevisionId: GIFT_REVISION_ID,
      ...approvedAudit(spanishGiftHash, englishGiftHash),
      ...spanishGiftFields,
    }).success,
  ).toBe(true);
});

test("allows only balanced, attribute-free controlled rich text", () => {
  const idolFields = {
    displayName: "Luma Vale",
    shortBio: "A fictional performer.",
    fullBio:
      "<p>A fictional <strong>performer</strong>.</p><ul><li>Test profile</li></ul>",
    seoTitle: "Luma Vale gifts",
    seoDescription: "A fictional performer page.",
  } as const;
  const idolHash = sourceHashSchema.parse(
    computeIdolTranslationContentHash(idolFields),
  );
  const idolRow = {
    schemaVersion: 1,
    id: TRANSLATION_ID,
    idolRevisionId: IDOL_REVISION_ID,
    ...approvedAudit(idolHash, englishGiftHash),
    ...idolFields,
  };
  expect(idolRevisionTranslationSchema.safeParse(idolRow).success).toBe(true);

  for (const fullBio of [
    "<script>alert(1)</script>",
    '<p onclick="alert(1)">unsafe</p>',
    "<iframe>unsafe</iframe>",
    "<p><strong>unbalanced</p></strong>",
  ]) {
    expect(
      idolRevisionTranslationSchema.safeParse({ ...idolRow, fullBio }).success,
    ).toBe(false);
  }

  const policyFields = {
    title: "Fixture refund policy",
    summary: "A fictional policy.",
    body: "<p>Refunds are reviewed with <em>care</em>.<br />Contact support.</p>",
  } as const;
  const policyHash = sourceHashSchema.parse(
    computePolicyTranslationContentHash(policyFields),
  );
  const policyRow = {
    schemaVersion: 1,
    id: TRANSLATION_ID,
    policyRevisionId: POLICY_REVISION_ID,
    ...approvedAudit(policyHash, englishGiftHash),
    ...policyFields,
  };
  expect(policyRevisionTranslationSchema.safeParse(policyRow).success).toBe(
    true,
  );
  expect(
    policyRevisionTranslationSchema.safeParse({
      ...policyRow,
      body: '<p class="legal">attributes are forbidden</p>',
    }).success,
  ).toBe(false);

  const publishedPolicy = {
    schemaVersion: 1,
    policyKey: "fixture-refund-policy",
    kind: "REFUND",
    localeContext: {
      schemaVersion: 1,
      requestedLocale: "en",
      resolvedLocale: "en",
      fallbackUsed: false,
    },
    title: "Fixture refund policy",
    summary: "A fictional policy.",
    body: "<script>alert(1)</script>",
    effectiveAt: "2026-09-03T02:30:00Z",
  };
  expect(publishedPolicyViewSchema.safeParse(publishedPolicy).success).toBe(
    false,
  );
});
