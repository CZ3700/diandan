import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createPaymentProtocolClient } from "./payment-runtime-client.mjs";
export async function verifyAdminPaymentConfigurationProtocol(
  context,
  runtime,
  payment,
) {
  const { check, client } = context;
  const manager = await runtime.login("manager"),
    readonly = await runtime.login("order");
  const reviewers = {};
  for (const locale of SUPPORTED_LOCALES)
    reviewers[locale] = await runtime.login(
      `payment-reviewer-${locale}`,
      locale,
    );
  const accountForCapability = async (capability) =>
    (
      await client.query(
        "SELECT provider_account_id FROM payment_route_rules WHERE id=$1",
        [capability.id],
      )
    ).rows[0]?.provider_account_id;
  const read = (session = manager, revisionId = null) =>
    runtime.command(session, "read", { schemaVersion: 1, revisionId });
  const mutation = (path, body, session = manager, options = {}) =>
    runtime.command(
      session,
      path,
      { schemaVersion: 1, ...body },
      { key: randomUUID(), ...options },
    );
  const validate = (revisionId, expectedPublicationId, mode = "PUBLISH") =>
    runtime.command(manager, "validate", {
      schemaVersion: 1,
      revisionId,
      expectedPublicationId,
      mode,
    });
  const initial = await read();
  check(
    initial.kind === "WORKSPACE" &&
      initial.selected === null &&
      initial.currentRevisionId === context.published.configVersionId &&
      initial.currentPublicationId === context.published.publicationId,
    "legacy current head remains truthful before managed history exists",
  );
  check(
    initial.accounts.some(
      (account) =>
        account.providerAccountId === runtime.normalizedAccountId &&
        account.deployed &&
        account.paymentMethods.includes("fake_card"),
    ),
    "safe management directory reflects the actual deployed normalized gateway factory",
  );
  check(
    !JSON.stringify(initial).includes("secret-ref:") &&
      !JSON.stringify(initial).includes("merchantAccount"),
    "workspace excludes connection and credential references",
  );
  const denied = await mutation(
    "save",
    {
      sourceRevisionId: null,
      expectedPublicationId: initial.currentPublicationId,
      configuration: runtime.configurationDocument(),
    },
    readonly,
    { status: 403 },
  );
  check(
    denied.code === "FORBIDDEN",
    "read-only operator cannot create a payment draft",
  );
  const empty = await mutation("save", {
    sourceRevisionId: null,
    expectedPublicationId: initial.currentPublicationId,
    configuration: { schemaVersion: 1, channels: [], routes: [] },
  });
  const invalid = await validate(
    empty.revisionId,
    initial.currentPublicationId,
  );
  check(
    !invalid.valid &&
      invalid.validationHash === null &&
      invalid.issues.some((issue) => issue.code === "EMPTY_ROUTES"),
    "incomplete drafts save but cannot validate as a purchasable configuration",
  );
  const unknown = await payment.fresh({ lost: true });
  const unknownBefore = await payment.state(unknown),
    legacyCounts = await context.psp.counts();
  check(
    unknownBefore.attempt_status === "UNKNOWN",
    "historical account has actual PSP acceptance with lost response before configuration changes",
  );
  async function draft(configuration, sourceRevisionId = null) {
    const workspace = await read();
    const saved = await mutation("save", {
      sourceRevisionId,
      expectedPublicationId: workspace.currentPublicationId,
      configuration,
    });
    return { ...saved, expectedPublicationId: workspace.currentPublicationId };
  }
  async function review(revisionId) {
    let workspace = await read(manager, revisionId);
    for (const channel of workspace.selected.configuration.channels)
      for (const locale of SUPPORTED_LOCALES) {
        let review = workspace.selected.reviews.find(
          (value) =>
            value.providerAccountId === channel.providerAccountId &&
            value.locale === locale,
        );
        if (review?.status === "APPROVED") continue;
        const target = {
          revisionId,
          providerAccountId: channel.providerAccountId,
          locale,
        };
        await mutation("submit", target);
        await mutation("approve", target, reviewers[locale]);
      }
    workspace = await read(manager, revisionId);
    check(
      workspace.selected.reviews.every(
        (value) =>
          value.status === "APPROVED" && value.editorId !== value.reviewerId,
      ),
      "seven independent locale reviewers approve the exact draft copy",
    );
  }
  const first = await draft(runtime.configurationDocument());
  const beforeReview = await validate(
    first.revisionId,
    first.expectedPublicationId,
  );
  check(
    !beforeReview.valid &&
      beforeReview.issues.some(
        (issue) => issue.code === "TRANSLATION_UNAPPROVED",
      ),
    "unapproved critical payment copy blocks publication",
  );
  const target = {
    revisionId: first.revisionId,
    providerAccountId: runtime.normalizedAccountId,
    locale: "en",
  };
  await mutation("submit", target);
  const self = await mutation("approve", target, manager, { status: 403 });
  check(
    self.code === "SELF_REVIEW",
    "author cannot approve their own payment copy",
  );
  const crossLocale = await mutation("approve", target, reviewers.ja, {
    status: 403,
  });
  check(
    crossLocale.code === "FORBIDDEN",
    "a reviewer cannot cross their explicitly granted locale",
  );
  await mutation("approve", target, reviewers.en);
  await review(first.revisionId);
  const valid = await validate(first.revisionId, first.expectedPublicationId);
  check(
    valid.valid &&
      valid.validationHash &&
      valid.diff.some((value) => value.kind === "CHANNEL"),
    "validation returns exact approved preview and structural diff",
  );
  const publishBody = {
    schemaVersion: 1,
    revisionId: first.revisionId,
    expectedPublicationId: first.expectedPublicationId,
    validationHash: valid.validationHash,
    reasonCode: "LOCAL_ACCEPTANCE",
    confirmed: true,
  };
  const missingValidation = await mutation(
    "publish",
    { ...publishBody, validationHash: "f".repeat(64) },
    manager,
    { status: 409 },
  );
  check(
    missingValidation.code === "VALIDATION_REQUIRED",
    "a fabricated validation hash cannot publish",
  );
  const publicationCountBefore = Number(
    (await client.query("SELECT count(*) n FROM payment_config_publications"))
      .rows[0].n,
  );
  const key = randomUUID();
  await runtime.nodes[0].dropNextPublicationResponse();
  const publishStarted = performance.now();
  let lost = false;
  try {
    await globalThis.fetch(
      `${runtime.nodes[0].base}/api/v1/admin/payment-configuration/publish`,
      {
        method: "POST",
        headers: {
          origin: runtime.adminOrigin,
          cookie: `__Host-fan-admin-session=${manager.sessionToken}`,
          "x-csrf-token": manager.csrfToken,
          "idempotency-key": key,
          "content-type": "application/json",
        },
        body: JSON.stringify(publishBody),
        signal: globalThis.AbortSignal.timeout(30000),
      },
    );
  } catch {
    lost = true;
  }
  check(lost, "actual HTTP publication response is lost after database commit");
  const published = await runtime.command(manager, "publish", publishBody, {
    key,
  });
  check(
    published.replayed && published.revisionId === first.revisionId,
    "retrying the same publication command returns its durable receipt",
  );
  check(
    Number(
      (await client.query("SELECT count(*) n FROM payment_config_publications"))
        .rows[0].n,
    ) ===
      publicationCountBefore + 1,
    "lost response retry creates exactly one publication",
  );
  const publicationPropagation = await runtime.waitForGeneration(
    published.generation,
  );
  check(
    performance.now() - publishStarted <= 60000,
    "publication propagation including HTTP retry stays within one minute",
  );
  async function checkout() {
    const session = await payment.checkout.initialize("en");
    await payment.checkout.add(session, {});
    const preflight = (await payment.checkout.validate(session)).data.preflight;
    const order = (
      await payment.checkout.create(session, preflight, payment.canaries[2])
    ).data.checkout;
    return { session, checkout: order };
  }
  const fresh = await checkout();
  const clients = runtime.nodes.map((node) =>
    createPaymentProtocolClient({
      paymentBase: node.base,
      origin: context.origin,
      check,
      canaries: payment.canaries,
    }),
  );
  const capabilities = [];
  for (const api of clients) {
    const result = (await api.capabilities(fresh.session, fresh.checkout.id))
      .data;
    check(
      result.outcome === "SUCCESS" &&
        result.capabilities.capabilities.length === 1 &&
        (await accountForCapability(result.capabilities.capabilities[0])) ===
          runtime.normalizedAccountId,
      "both independent API processes route new checkout only through the published account",
    );
    capabilities.push(result.capabilities.capabilities[0]);
  }
  const created = (
    await clients[1].create(fresh.session, fresh.checkout.id, capabilities[1], {
      key: randomUUID(),
    })
  ).data;
  check(
    created.outcome === "SUCCESS" &&
      created.attempt.status === "REQUIRES_ACTION",
    "real normalized gateway over authenticated TLS creates a hosted TEST payment",
  );
  check(
    (await runtime.normalizedPsp.counts()).payments === 1,
    "new account acceptance exists in its independent PSP database",
  );
  const recovered = (
    await clients[1].recover(
      unknown.session,
      unknown.checkout.id,
      unknown.attempt.id,
    )
  ).data;
  check(
    recovered.outcome === "SUCCESS" &&
      (
        await client.query(
          "SELECT provider_account_id FROM payment_attempts WHERE id=$1",
          [unknown.attempt.id],
        )
      ).rows[0]?.provider_account_id === runtime.legacyAccountId &&
      recovered.attempt.status === "REQUIRES_ACTION",
    "old UNKNOWN is reconciled against its frozen legacy provider after route replacement",
  );
  check(
    (await context.psp.counts()).payments === legacyCounts.payments,
    "historical reconciliation does not create another provider payment",
  );
  const staleCheckout = await checkout();
  const staleCapability = (
    await clients[0].capabilities(
      staleCheckout.session,
      staleCheckout.checkout.id,
    )
  ).data.capabilities.capabilities[0];
  const locker = new Client(context.database);
  await locker.connect();
  const priorFailures = await Promise.all(
    runtime.nodes.map((node) => node.observe()),
  );
  let failedRefreshes;
  const blockedAt = performance.now();
  try {
    await locker.query("BEGIN");
    await locker.query(
      "SELECT id FROM payment_config_publication_heads FOR UPDATE",
    );
    do {
      failedRefreshes = await Promise.all(
        runtime.nodes.map((node) => node.observe()),
      );
      if (
        failedRefreshes.every(
          (node, index) =>
            node.databaseFailures > priorFailures[index].databaseFailures,
        )
      )
        break;
      await delay(50);
    } while (performance.now() - blockedAt < 20000);
    check(
      failedRefreshes.every(
        (node, index) =>
          node.databaseFailures > priorFailures[index].databaseFailures &&
          node.generation === published.generation &&
          node.accounts.includes(runtime.legacyAccountId),
      ),
      "both independent refreshes fail within a bounded database deadline while preserving the previous complete directory",
    );
  } finally {
    await locker.query("ROLLBACK");
    await locker.end();
  }
  const boundedRefreshFailureMs = performance.now() - blockedAt;
  const stopped = await draft(
    runtime.configurationDocument({ rolloutBasisPoints: 0, threshold: 5 }),
    first.revisionId,
  );
  await review(stopped.revisionId);
  const stoppedValidation = await validate(
    stopped.revisionId,
    stopped.expectedPublicationId,
  );
  check(
    stoppedValidation.valid,
    "explicit zero rollout is valid without deleting the nonempty routing package",
  );
  const stopReceipt = await mutation("publish", {
    revisionId: stopped.revisionId,
    expectedPublicationId: stopped.expectedPublicationId,
    validationHash: stoppedValidation.validationHash,
    reasonCode: "LOCAL_EMERGENCY_STOP",
    confirmed: true,
  });
  const stopPropagation = await runtime.waitForGeneration(
    stopReceipt.generation,
  );
  check(
    stopPropagation.observations.every((node) =>
      node.policies.some(
        (policy) =>
          policy.providerAccountId === runtime.normalizedAccountId &&
          policy.failureThreshold === 5,
      ),
    ),
    "new health policy settings propagate with the publication in every independent process",
  );
  for (const api of clients) {
    await api.capabilities(staleCheckout.session, staleCheckout.checkout.id, {
      expected: 409,
      code: "CAPABILITY_UNAVAILABLE",
    });
    const result = (
      await api.capabilities(staleCheckout.session, staleCheckout.checkout.id, {
        country: null,
      })
    ).data;
    check(
      result.outcome === "SUCCESS" &&
        result.capabilities.capabilities.length === 0,
      "zero rollout closes country admission and leaves no selectable method in each process",
    );
  }
  await clients[0].create(
    staleCheckout.session,
    staleCheckout.checkout.id,
    staleCapability,
    { expected: 409, code: "STALE_CONFIGURATION" },
  );
  const rollbackValidation = await validate(
    first.revisionId,
    stopReceipt.publicationId,
    "ROLLBACK",
  );
  check(
    rollbackValidation.valid,
    "previously published immutable revision is independently validated for rollback",
  );
  const rollbackStarted = performance.now();
  const rollback = await mutation("rollback", {
    revisionId: first.revisionId,
    expectedPublicationId: stopReceipt.publicationId,
    validationHash: rollbackValidation.validationHash,
    reasonCode: "LOCAL_ROLLBACK",
    confirmed: true,
  });
  const rollbackPropagation = await runtime.waitForGeneration(
    rollback.generation,
  );
  check(
    performance.now() - rollbackStarted <= 60000 &&
      rollback.generation > stopReceipt.generation,
    "rollback is a new monotonic publication and activates within one minute",
  );
  check(
    rollbackPropagation.observations.every((node) =>
      node.policies.some(
        (policy) =>
          policy.providerAccountId === runtime.normalizedAccountId &&
          policy.failureThreshold === 3,
      ),
    ),
    "rollback restores old settings through a new health policy version",
  );
  const oldPid = runtime.nodes[1].pid;
  await runtime.restartSecondNode();
  check(
    runtime.nodes[1].pid !== oldPid,
    "second API process restarts with a new PID",
  );
  await runtime.waitForGeneration(rollback.generation);
  const restarted = createPaymentProtocolClient({
    paymentBase: runtime.nodes[1].base,
    origin: context.origin,
    check,
    canaries: payment.canaries,
  });
  const restartedCapabilities = (
    await restarted.capabilities(
      staleCheckout.session,
      staleCheckout.checkout.id,
    )
  ).data;
  check(
    (await accountForCapability(
      restartedCapabilities.capabilities.capabilities[0],
    )) === runtime.normalizedAccountId,
    "restarted API reconstructs current routing and connectors from PostgreSQL",
  );
  return {
    manager,
    firstRevisionId: first.revisionId,
    secondRevisionId: stopped.revisionId,
    finalPublicationId: rollback.publicationId,
    generation: rollback.generation,
    propagation: [publicationPropagation, stopPropagation, rollbackPropagation],
    boundedRefreshFailureMs,
    independentPids: runtime.nodes.map((node) => node.pid),
    unknownAttemptId: unknown.attempt.id,
  };
}
