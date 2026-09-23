import { createHash, randomUUID } from "node:crypto";
import { URL } from "node:url";
import { expect } from "@playwright/test";
import {
  SUPPORTED_LOCALES,
  adminPaymentConfigurationResponseSchema,
} from "@fan-support/contracts";
import { canonicalPublicationValue } from "@fan-support/content";
import { loadStorefrontCopy } from "@fan-support/i18n";

function paymentUi({ page, config, check }) {
  const response = (action) =>
    page.waitForResponse(
      (value) => {
        const url = new URL(value.url());
        return (
          url.origin === config.origins.admin &&
          url.pathname === `/api/admin/payment-config-${action}` &&
          value.request().method() === "POST"
        );
      },
      { timeout: 30000 },
    );
  const idle = () =>
    expect(page.locator("[data-payment-workspace]")).toHaveAttribute(
      "aria-busy",
      "false",
      { timeout: 30000 },
    );
  async function parsed(value, kind) {
    check(value.ok(), `Payment ${kind} uses a successful actual BFF response`);
    const result = adminPaymentConfigurationResponseSchema.safeParse(
      await value.json(),
    );
    check(
      result.success &&
        result.data.outcome === "SUCCESS" &&
        result.data.kind === kind,
      `Payment ${kind} response satisfies the canonical contract`,
    );
    return result.data;
  }
  async function read(action) {
    const [value] = await Promise.all([response("read"), action()]);
    const workspace = await parsed(value, "WORKSPACE");
    await idle();
    return workspace;
  }
  // Every action is an actual control click; no direct HTTP writes or state fixtures.
  async function mutation(action, click) {
    const [receiptResponse, workspaceResponse] = await Promise.all([
      response(action.toLowerCase()),
      response("read"),
      click(),
    ]);
    const receipt = await parsed(receiptResponse, "MUTATION");
    check(receipt.action === action, `Actual payment mutation is ${action}`);
    const workspace = await parsed(workspaceResponse, "WORKSPACE");
    await idle();
    return { receipt, workspace };
  }
  return {
    async open() {
      const selector = (await page.locator("[data-payment-workspace]").count())
        ? "[data-payment-refresh]"
        : '[data-management-section="PAYMENTS"]';
      return read(() => page.locator(selector).click());
    },
    async select(workspace, revisionId) {
      if (workspace.selected?.revisionId === revisionId) return workspace;
      const item = workspace.history.find(
        (row) => row.revisionId === revisionId,
      );
      check(Boolean(item), "Exact payment revision is available in UI history");
      const selected = await read(() =>
        page.locator(`[data-payment-open-version="${item.version}"]`).click(),
      );
      check(
        selected.selected?.revisionId === revisionId,
        "UI reads exact payment revision",
      );
      return selected;
    },
    mutation,
    async validate(mode) {
      const [value] = await Promise.all([
        response("validate"),
        page.locator(`[data-payment-check-${mode.toLowerCase()}]`).click(),
      ]);
      const validation = await parsed(value, "VALIDATION");
      await idle();
      check(
        validation.mode === mode,
        "Payment validation mode matches its UI action",
      );
      return validation;
    },
    async publish(mode) {
      const validation = await this.validate(mode);
      check(
        validation.valid,
        `Payment ${mode} passes the normal publication gate`,
      );
      const form = page.locator("[data-payment-confirm-publication]");
      await expect(form.locator('button[type="submit"]')).toBeDisabled();
      await form.locator('input[type="checkbox"]').check();
      return mutation(mode, () =>
        form.locator('button[type="submit"]').click(),
      );
    },
  };
}

function snapshot(workspace, check) {
  check(
    workspace.currentRevisionId !== null &&
      workspace.currentPublicationId !== null &&
      workspace.selected?.revisionId === workspace.currentRevisionId,
    "Snapshot reads the actual managed payment publication head",
  );
  return {
    schemaVersion: 1,
    currentRevisionId: workspace.currentRevisionId,
    currentPublicationId: workspace.currentPublicationId,
    generation: workspace.generation,
    configurationHash: createHash("sha256")
      .update(canonicalPublicationValue(workspace.selected.configuration))
      .digest("hex"),
  };
}

/** Restart proof reads through the same authenticated management UI, never the database. */
export async function readLocalPaymentSnapshot({ page, config, check }) {
  const ui = paymentUi({ page, config, check });
  let workspace = await ui.open();
  check(
    workspace.currentRevisionId !== null,
    "Managed payment configuration survives restart",
  );
  workspace = await ui.select(workspace, workspace.currentRevisionId);
  return snapshot(workspace, check);
}

async function fillFirstManagedDraft(page, account, suffix) {
  await page.locator("[data-payment-edit]").click();
  for (const kind of ["channel", "rule"])
    while (await page.locator(`[data-payment-${kind}]`).count())
      await page
        .locator(`[data-payment-${kind}]`)
        .last()
        .locator("button")
        .last()
        .click();
  await page.locator("[data-payment-add-channel]").click();
  await page
    .locator('[name="c0.account"]')
    .selectOption(account.providerAccountId);
  await page.locator('[name="c0.enabled"]').check();
  await page.locator('[name="c0.order"]').fill("0");
  await page.locator('[name="c0.rollout"]').fill("100");
  for (const locale of SUPPORTED_LOCALES) {
    const copy = await loadStorefrontCopy(locale);
    await page.locator(".mp-copy-editor > label select").selectOption(locale);
    await page
      .locator(`[name="c0.${locale}.name"]`)
      .fill(`${copy.checkoutMethod.slice(0, 60)} TEST ${suffix}`);
    await page.locator(`[name="c0.${locale}.hint"]`).fill(copy.checkoutTest);
  }
  await page.locator("[data-payment-add-rule]").click();
  await page
    .locator('[name="r0.account"]')
    .selectOption(account.providerAccountId);
  await page.locator('[name="r0.method"]').selectOption("fake_card");
  await page.locator('[name="r0.enabled"]').check();
  // This is the existing dedicated local TEST seed scope, not a production default.
  for (const [key, value] of Object.entries({
    countries: "US",
    markets: "GLOBAL",
    currencies: "USD",
    minimum: "0",
    maximum: "100000000",
    priority: "10",
    rollout: "100",
  }))
    await page.locator(`[name="r0.${key}"]`).fill(value);
  await page.locator('[name="r0.devices"][value="REDIRECT"]').check();
}

/** Real independent identities author, review, publish and roll back managed TEST configuration. */
export async function verifyLocalPaymentOperations({
  manager,
  reviewer,
  config,
  check,
  capture,
  report,
}) {
  check(
    config.environment === "LOCAL_TEST" &&
      /^(?:test|acceptance)-[a-z0-9-]+$/u.test(config.instance),
    "Payment acceptance mutates only the dedicated local TEST instance",
  );
  const author = paymentUi({ page: manager, config, check });
  const second = paymentUi({ page: reviewer, config, check });
  let workspace = await author.open();
  let reviewWorkspace = await second.open();
  check(
    workspace.actorId !== reviewWorkspace.actorId,
    "Payment review uses a distinct authenticated platform identity",
  );
  check(
    workspace.canEdit &&
      workspace.canPublish &&
      !reviewWorkspace.canEdit &&
      !reviewWorkspace.canPublish,
    "Author and independent reviewer retain their server-defined permissions",
  );
  check(
    SUPPORTED_LOCALES.every((locale) =>
      reviewWorkspace.reviewLocales.includes(locale),
    ),
    "Local independent reviewer has the explicit seven-language grants",
  );
  const account = workspace.accounts.find(
    (row) =>
      row.providerAccountId === config.services.psp.binding.providerAccountId,
  );
  check(
    workspace.accounts.length === 1 &&
      account?.environment === "TEST" &&
      account.adapterKey === "fake" &&
      account.deployed &&
      account.healthPolicy !== null &&
      account.paymentMethods.includes("fake_card"),
    "Only the already deployed persistent TEST account is selected",
  );
  const initialGeneration = workspace.generation;
  await fillFirstManagedDraft(manager, account, randomUUID().slice(0, 8));
  const saved = await author.mutation("SAVE", () =>
    manager.locator("[data-payment-save]").click(),
  );
  workspace = saved.workspace;
  const firstRevision = saved.receipt.revisionId;
  check(
    workspace.selected.reviews.length === SUPPORTED_LOCALES.length &&
      workspace.selected.reviews.every((row) => row.status === "DRAFT"),
    "Changed seven-language copy requires new independent review",
  );
  const blocked = await author.validate("PUBLISH");
  check(!blocked.valid, "Unreviewed payment copy cannot publish");
  await expect(
    manager.locator("[data-payment-confirm-publication]"),
  ).toHaveCount(0);
  await capture(manager, "local-payment-unreviewed-blocked");
  for (const locale of SUPPORTED_LOCALES) {
    workspace = (
      await author.mutation("SUBMIT", () =>
        manager
          .locator(`[data-payment-locale="${locale}"] [data-payment-submit]`)
          .click(),
      )
    ).workspace;
  }
  check(
    workspace.selected.reviews.every(
      (row) => row.status === "IN_REVIEW" && !row.canApprove,
    ),
    "Author cannot approve their own submitted payment copy",
  );
  await expect(manager.locator("[data-payment-approve]")).toHaveCount(0);
  reviewWorkspace = await second.select(await second.open(), firstRevision);
  for (const locale of SUPPORTED_LOCALES) {
    reviewWorkspace = (
      await second.mutation("APPROVE", () =>
        reviewer
          .locator(`[data-payment-locale="${locale}"] [data-payment-approve]`)
          .click(),
      )
    ).workspace;
  }
  check(
    reviewWorkspace.selected.reviews.every(
      (row) =>
        row.status === "APPROVED" &&
        row.reviewerId === reviewWorkspace.actorId &&
        row.editorId !== row.reviewerId,
    ),
    "Every payment translation is approved by the independent logged-in reviewer",
  );
  await capture(reviewer, "local-payment-independent-review");
  await author.select(await author.open(), firstRevision);
  const published = await author.publish("PUBLISH");
  workspace = published.workspace;
  check(
    workspace.currentRevisionId === firstRevision &&
      workspace.generation === initialGeneration + 1,
    "Actual managed payment publication advances once",
  );
  const firstHash = snapshot(workspace, check).configurationHash;
  await capture(manager, "local-payment-first-publication");
  await manager.locator("[data-payment-edit]").click();
  await manager.locator('[name="r0.priority"]').fill("11");
  const changed = await author.mutation("SAVE", () =>
    manager.locator("[data-payment-save]").click(),
  );
  check(
    changed.workspace.selected.reviews.every(
      (row) => row.status === "APPROVED",
    ),
    "Routing-only edit retains unchanged server-reviewed translations",
  );
  const next = await author.publish("PUBLISH");
  check(
    next.workspace.currentRevisionId === changed.receipt.revisionId &&
      next.workspace.generation === initialGeneration + 2,
    "Second routing-only payment revision is actually published",
  );
  await author.select(next.workspace, firstRevision);
  const rolledBack = await author.publish("ROLLBACK");
  const final = snapshot(rolledBack.workspace, check);
  check(
    final.currentRevisionId === firstRevision &&
      final.generation === initialGeneration + 3 &&
      final.configurationHash === firstHash,
    "Rollback creates new publication evidence and restores the exact reviewed configuration",
  );
  const observed = await readLocalPaymentSnapshot({
    page: reviewer,
    config,
    check,
  });
  check(
    JSON.stringify(observed) === JSON.stringify(final),
    "Independent browser identity reads the same final payment publication",
  );
  await capture(manager, "local-payment-rolled-back");
  report.cases.push(
    "payment-draft-independent-seven-language-review-two-publications-rollback",
  );
  return final;
}
