import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { URL } from "node:url";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { evaluatePaymentRollout } from "../../../packages/domain/dist/index.js";
import { createPaymentProtocolClient } from "./payment-runtime-client.mjs";
import { waitForOrderPayment } from "./order-payment-client.mjs";

/** Local TEST acceptance: all configuration writes use authenticated public commands. */
export async function verifyPspOnboardingProtocol(context, runtime, payment) {
  const { check, client, progress } = context;
  const hash = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const manager = await runtime.login("manager");
  const reviewers = {};
  for (const locale of SUPPORTED_LOCALES)
    reviewers[locale] = await runtime.login(
      `payment-reviewer-${locale}`,
      locale,
    );
  const read = (revisionId = null) =>
    runtime.command(manager, "read", { schemaVersion: 1, revisionId });
  const mutation = (action, body, actor = manager) =>
    runtime.command(
      actor,
      action,
      { schemaVersion: 1, ...body },
      { key: randomUUID() },
    );
  const validate = (revisionId, expectedPublicationId, mode = "PUBLISH") =>
    runtime.command(manager, "validate", {
      schemaVersion: 1,
      revisionId,
      expectedPublicationId,
      mode,
    });
  const clients = runtime.nodes.map((node) =>
    createPaymentProtocolClient({
      paymentBase: node.base,
      origin: context.origin,
      check,
      canaries: payment.canaries,
    }),
  );
  const account = (
    await client.query(
      "SELECT environment,status FROM payment_provider_accounts WHERE id=$1",
      [runtime.normalizedAccountId],
    )
  ).rows[0];
  check(
    account.environment === "TEST" && account.status === "ACTIVE",
    "isolated onboarding account is actually ACTIVE/TEST",
  );
  check(
    runtime.nodes.every((node) => new URL(node.base).hostname === "127.0.0.1"),
    "onboarding APIs bind only loopback",
  );

  progress(
    "real accepted legacy PSP create loses its response before routing changes",
  );
  const unknown = await payment.fresh({ lost: true });
  const legacyCounts = await context.psp.counts();
  const oldOrderHash = await payment.immutableSnapshot(unknown);
  const receiptHash = async () => {
    const rows = (
      await client.query(
        "SELECT to_jsonb(r) AS receipt FROM payment_create_receipts r WHERE attempt_id=$1 ORDER BY id",
        [unknown.attempt.id],
      )
    ).rows;
    check(
      rows.length === 1,
      "old attempt retains exactly one durable original create receipt",
    );
    return hash(rows);
  };
  const oldReceiptHash = await receiptHash();
  const originalCreateBody = clients[0].createBody(
    unknown.capability,
    context.published.scope.country,
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
  const cohort = [];
  for (let index = 0; index < 24; index++) cohort.push(await checkout());
  const acceptance = await checkout();
  const money = new Map();
  const stages = [];
  const immutableRows = new Map();
  async function verifyImmutableHistory() {
    const rows = (
      await client.query(`
      SELECT 'publication' AS kind,p.id,to_jsonb(p) AS value FROM payment_config_publications p
      UNION ALL SELECT 'route',r.id,to_jsonb(r) FROM payment_route_rules r WHERE EXISTS(SELECT 1 FROM payment_config_publications p WHERE p.config_version_id=r.config_version_id)
      UNION ALL SELECT 'provider',c.id,to_jsonb(c) FROM payment_provider_configs c WHERE EXISTS(SELECT 1 FROM payment_config_publications p WHERE p.config_version_id=c.config_version_id)
      UNION ALL SELECT 'translation',t.id,to_jsonb(t) FROM payment_provider_config_translations t WHERE EXISTS(SELECT 1 FROM payment_config_publications p WHERE p.config_version_id=t.config_version_id)
      UNION ALL SELECT 'audit',a.id,to_jsonb(a) FROM audit_logs a WHERE a.action LIKE 'PAYMENT_CONFIG_%'
      ORDER BY kind,id
    `)
    ).rows;
    const current = new Map(
      rows.map((row) => [`${row.kind}:${row.id}`, hash(row.value)]),
    );
    for (const [id, digest] of immutableRows)
      check(
        current.get(id) === digest,
        "published route, translation, publication and audit history stays immutable",
      );
    for (const [id, digest] of current) immutableRows.set(id, digest);
  }
  await verifyImmutableHistory();

  async function approve(revisionId) {
    const before = (await read(revisionId)).selected;
    let approvals = 0;
    for (const locale of SUPPORTED_LOCALES) {
      const existing = before.reviews.find(
        (review) =>
          review.locale === locale &&
          review.providerAccountId === runtime.normalizedAccountId,
      );
      if (existing?.status === "APPROVED") continue;
      const target = {
        revisionId,
        providerAccountId: runtime.normalizedAccountId,
        locale,
      };
      await mutation("submit", target);
      await mutation("approve", target, reviewers[locale]);
      approvals++;
    }
    const selected = (await read(revisionId)).selected;
    check(
      SUPPORTED_LOCALES.every((locale) =>
        selected.reviews.some(
          (review) =>
            review.locale === locale &&
            review.status === "APPROVED" &&
            review.editorId !== review.reviewerId,
        ),
      ),
      "all seven critical translations have independent approval or unchanged approved lineage",
    );
    return { approvals, inherited: SUPPORTED_LOCALES.length - approvals };
  }
  async function measure(label, receipt, propagation, started, ratios, review) {
    const elapsedMs = performance.now() - started;
    check(
      elapsedMs <= 60000,
      "publication HTTP and both independent API refreshes complete within 60 seconds",
    );
    const route = (
      await client.query(
        `
      SELECT h.publication_id,h.config_version_id,h.config_version::int AS config_version,r.id AS route_id,r.rule_version::int AS rule_version,
      r.rollout_basis_points AS rule_ratio,c.rollout_basis_points AS provider_ratio
      FROM payment_config_publication_heads h
      JOIN payment_route_rules r ON r.config_version_id=h.config_version_id
      JOIN payment_provider_configs c ON c.config_version_id=h.config_version_id AND c.provider_account_id=r.provider_account_id
      WHERE r.provider_account_id=$1
    `,
        [runtime.normalizedAccountId],
      )
    ).rows[0];
    check(
      route &&
        route.publication_id === receipt.publicationId &&
        route.config_version_id === receipt.revisionId &&
        route.provider_ratio === ratios.provider &&
        route.rule_ratio === ratios.rule,
      "published PG head and both rollout gates match the normal command receipt",
    );
    const rows = [];
    let capabilityRequests = 0;
    for (const [index, value] of cohort.entries()) {
      const input = {
        schemaVersion: 1,
        checkoutSessionId: value.checkout.id,
        providerAccountId: runtime.normalizedAccountId,
        routeRuleId: route.route_id,
        providerRolloutBasisPoints: ratios.provider,
        ruleRolloutBasisPoints: ratios.rule,
      };
      const domain = evaluatePaymentRollout(input);
      const pg = (
        await client.query(
          "SELECT payment_rollout_bucket_v1('provider',$1::uuid,$2::uuid) AS provider_bucket,payment_rollout_bucket_v1('rule',$1::uuid,$3::uuid) AS rule_bucket",
          [input.checkoutSessionId, input.providerAccountId, input.routeRuleId],
        )
      ).rows[0];
      check(
        domain.kind !== "INVALID" &&
          domain.providerBucket === pg.provider_bucket &&
          domain.ruleBucket === pg.rule_bucket,
        "actual server checkout ID has identical PostgreSQL and domain buckets",
      );
      const eligible = domain.kind === "ELIGIBLE";
      let stableCapability;
      for (const [node, api] of clients.entries()) {
        for (const locale of SUPPORTED_LOCALES) {
          // Country-neutral reads also expose the unchanged quote when this cohort is excluded.
          const neutral = (
            await api.capabilities(value.session, value.checkout.id, {
              locale,
              country: null,
            })
          ).data.capabilities;
          capabilityRequests++;
          const amount = {
            amountMinor: neutral.amountMinor,
            currency: neutral.currency,
            market: neutral.market,
          };
          if (!money.has(value.checkout.id))
            money.set(value.checkout.id, amount);
          check(
            hash(amount) === hash(money.get(value.checkout.id)) &&
              neutral.presentationLocale === locale,
            "seven presentation locales preserve the original quote amount, currency and market",
          );
          check(
            neutral.countries.includes(context.published.scope.country) ===
              eligible && neutral.capabilities.length === 0,
            "country admission in both API processes equals the PG/domain AND decision",
          );
          const response = await api.capabilities(
            value.session,
            value.checkout.id,
            {
              locale,
              country: context.published.scope.country,
              ...(eligible
                ? {}
                : { expected: 409, code: "CAPABILITY_UNAVAILABLE" }),
            },
          );
          capabilityRequests++;
          if (eligible) {
            const view = response.data.capabilities;
            const capability = view.capabilities[0];
            check(
              view.capabilities.length === 1 &&
                capability.id === route.route_id &&
                capability.environment === "TEST" &&
                capability.configVersion === route.config_version &&
                capability.ruleVersion === route.rule_version,
              "actual country capability is the exact published TEST route in every locale and API process",
            );
            check(
              hash({
                amountMinor: view.amountMinor,
                currency: view.currency,
                market: view.market,
              }) === hash(amount),
              "actual country capability retains the same quote",
            );
            const identity = {
              id: capability.id,
              configVersion: capability.configVersion,
              ruleVersion: capability.ruleVersion,
            };
            if (!stableCapability) stableCapability = identity;
            check(
              hash(identity) === hash(stableCapability),
              "language and process changes do not resample a cohort or route",
            );
            if (
              label === "PUBLIC_100_PERCENT" &&
              index === 0 &&
              node === 0 &&
              locale === "en"
            )
              value.staleCapability = capability;
          }
        }
      }
      rows.push({
        checkoutSessionId: value.checkout.id,
        providerBucket: domain.providerBucket,
        ruleBucket: domain.ruleBucket,
        eligible,
      });
    }
    const admitted = rows.filter((row) => row.eligible).length;
    if (ratios.provider === 0 || ratios.rule === 0)
      check(
        admitted === 0,
        "zero rollout excludes every sampled real checkout",
      );
    if (ratios.provider === 10000 && ratios.rule === 10000)
      check(
        admitted === cohort.length,
        "100 percent rollout includes every sampled real checkout",
      );
    await verifyImmutableHistory();
    const stage = {
      label,
      revisionId: receipt.revisionId,
      publicationId: receipt.publicationId,
      generation: receipt.generation,
      routeId: route.route_id,
      configVersion: route.config_version,
      ruleVersion: route.rule_version,
      providerBasisPoints: ratios.provider,
      ruleBasisPoints: ratios.rule,
      propagationMs: elapsedMs,
      processObservations: propagation.observations.map(
        ({ pid, generation }) => ({ pid, generation }),
      ),
      review,
      cohortSize: cohort.length,
      admitted,
      excluded: cohort.length - admitted,
      observedAdmissionRatio: admitted / cohort.length,
      capabilityRequests,
      cohorts: rows,
    };
    stages.push(stage);
    await context.saveEvidence("stages.json", { schemaVersion: 1, stages });
    return stage;
  }
  async function publish(label, provider, rule) {
    progress(`publish and measure ${label}`);
    const head = await read();
    const configuration = runtime.configurationDocument({
      rolloutBasisPoints: provider,
    });
    configuration.routes[0].rolloutBasisPoints = rule;
    const saved = await mutation("save", {
      sourceRevisionId: stages.at(-1)?.revisionId ?? null,
      expectedPublicationId: head.currentPublicationId,
      configuration,
    });
    if (stages.length === 0) {
      const blocked = await validate(
        saved.revisionId,
        head.currentPublicationId,
      );
      check(
        !blocked.valid &&
          blocked.issues.some(
            (issue) => issue.code === "TRANSLATION_UNAPPROVED",
          ),
        "unreviewed seven-language copy blocks first publication",
      );
    }
    const review = await approve(saved.revisionId);
    const proof = await validate(saved.revisionId, head.currentPublicationId);
    check(
      proof.valid && proof.validationHash,
      "reviewed stage passes server validation before publishing",
    );
    const started = performance.now();
    const receipt = await mutation("publish", {
      revisionId: saved.revisionId,
      expectedPublicationId: head.currentPublicationId,
      validationHash: proof.validationHash,
      reasonCode:
        label === "EMERGENCY_ZERO"
          ? "LOCAL_EMERGENCY_STOP"
          : "LOCAL_ACCEPTANCE",
      confirmed: true,
    });
    const propagation = await runtime.waitForGeneration(receipt.generation);
    return measure(
      label,
      receipt,
      propagation,
      started,
      { provider, rule },
      review,
    );
  }

  await publish("INITIAL_ZERO", 0, 10000);
  await publish("INTERNAL_ISOLATED_TEST_100_PERCENT", 10000, 10000);
  const capability = (
    await clients[1].capabilities(acceptance.session, acceptance.checkout.id, {
      country: context.published.scope.country,
    })
  ).data.capabilities.capabilities[0];
  const created = (
    await clients[1].create(
      acceptance.session,
      acceptance.checkout.id,
      capability,
      {
        body: clients[1].createBody(
          capability,
          context.published.scope.country,
        ),
        key: randomUUID(),
      },
    )
  ).data;
  check(
    created.attempt?.status === "REQUIRES_ACTION" &&
      (await runtime.normalizedPsp.counts()).payments === 1,
    "isolated internal stage accepts one real persistent TEST PSP payment over authenticated TLS",
  );
  await publish("PUBLIC_5_PERCENT", 10000, 500);
  await publish("PUBLIC_25_PERCENT", 10000, 2500);
  const full = await publish("PUBLIC_100_PERCENT", 10000, 10000);
  const stop = await publish("EMERGENCY_ZERO", 0, 10000);

  const stoppedCapability = {
    ...cohort[0].staleCapability,
    id: stop.routeId,
    configVersion: stop.configVersion,
    ruleVersion: stop.ruleVersion,
  };
  const beforeStopCreates = {
    legacy: await context.psp.counts(),
    normalized: await runtime.normalizedPsp.counts(),
  };
  for (const api of clients)
    await api.create(
      cohort[0].session,
      cohort[0].checkout.id,
      stoppedCapability,
      {
        body: api.createBody(
          stoppedCapability,
          context.published.scope.country,
        ),
        key: randomUUID(),
        expected: 409,
        code: "CAPABILITY_UNAVAILABLE",
      },
    );
  check(
    Number(
      (
        await client.query(
          "SELECT count(*) AS n FROM payment_attempts a JOIN orders o ON o.id=a.order_id WHERE o.checkout_session_id=ANY($1::uuid[])",
          [cohort.map((value) => value.checkout.id)],
        )
      ).rows[0].n,
    ) === 0 &&
      hash(await context.psp.counts()) === hash(beforeStopCreates.legacy) &&
      hash(await runtime.normalizedPsp.counts()) ===
        hash(beforeStopCreates.normalized),
    "current zero-rollout versions deny new creates on both APIs without any cohort attempt or PSP mutation",
  );

  progress(
    "disabled routes retain original UNKNOWN receipt and original-account recovery",
  );
  check(
    (await payment.state(unknown)).attempt_status === "UNKNOWN",
    "actual response-loss attempt remains UNKNOWN until controlled recovery after emergency stop",
  );
  for (const api of clients) {
    const replay = (
      await api.create(
        unknown.session,
        unknown.checkout.id,
        unknown.capability,
        { key: unknown.key, body: originalCreateBody },
      )
    ).data;
    check(
      replay.attempt?.id === unknown.attempt.id,
      "original create key and body replay the original attempt after route disablement",
    );
  }
  await waitForOrderPayment(
    "original UNKNOWN recovery lease is actually due",
    async () =>
      (
        await client.query(
          "SELECT phase='RECONCILE' AND next_attempt_at<=clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp()) AS ready FROM payment_runtime_operations WHERE attempt_id=$1",
          [unknown.attempt.id],
        )
      ).rows[0]?.ready,
    check,
  );
  const recovered = (
    await clients[1].recover(
      unknown.session,
      unknown.checkout.id,
      unknown.attempt.id,
    )
  ).data;
  check(
    recovered.attempt?.status === "REQUIRES_ACTION",
    "disabled historical route still recovers using authenticated original PSP evidence",
  );
  check(
    (
      await client.query(
        "SELECT provider_account_id FROM payment_attempts WHERE id=$1",
        [unknown.attempt.id],
      )
    ).rows[0]?.provider_account_id === runtime.legacyAccountId,
    "recovery retains the original provider account",
  );
  check(
    (await context.psp.counts()).payments === legacyCounts.payments &&
      (await runtime.normalizedPsp.counts()).payments === 1,
    "original key recovery creates no second PSP payment in either account",
  );
  check(
    (await receiptHash()) === oldReceiptHash &&
      (await payment.immutableSnapshot(unknown)) === oldOrderHash,
    "recovery retains original create receipt, publication binding and order snapshot",
  );
  await clients[0].create(
    cohort[0].session,
    cohort[0].checkout.id,
    cohort[0].staleCapability,
    {
      body: clients[0].createBody(
        cohort[0].staleCapability,
        context.published.scope.country,
      ),
      key: randomUUID(),
      expected: 409,
      code: "STALE_CONFIGURATION",
    },
  );

  progress("validate immutable prior revision and publish audited rollback");
  const rollbackProof = await validate(
    full.revisionId,
    stop.publicationId,
    "ROLLBACK",
  );
  check(
    rollbackProof.valid && rollbackProof.validationHash,
    "previous 100 percent revision passes rollback validation",
  );
  const rollbackStarted = performance.now();
  const rollback = await mutation("rollback", {
    revisionId: full.revisionId,
    expectedPublicationId: stop.publicationId,
    validationHash: rollbackProof.validationHash,
    reasonCode: "LOCAL_ROLLBACK",
    confirmed: true,
  });
  check(
    rollback.generation > stop.generation,
    "rollback advances publication generation",
  );
  const rolled = await measure(
    "ROLLBACK_TO_100_PERCENT",
    rollback,
    await runtime.waitForGeneration(rollback.generation),
    rollbackStarted,
    { provider: 10000, rule: 10000 },
    { approvals: 0, inherited: 7 },
  );
  check(
    rolled.routeId === full.routeId &&
      hash(rolled.cohorts) === hash(full.cohorts),
    "rollback reuses exact immutable route identity and cohort buckets",
  );

  // Deterministic v1 vectors cover each AND quadrant; these are not sampled HTTP rollout claims.
  const vectors = new Map();
  let examined = 0;
  for (let index = 0; index < 20000 && vectors.size < 4; index++) {
    examined++;
    const input = {
      schemaVersion: 1,
      checkoutSessionId: `d1000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      providerAccountId: "a1000000-0000-4000-8000-000000000002",
      routeRuleId: "a1000000-0000-4000-8000-000000000003",
      providerRolloutBasisPoints: 500,
      ruleRolloutBasisPoints: 500,
    };
    const result = evaluatePaymentRollout(input);
    const quadrant = `${result.providerBucket < 500}:${result.ruleBucket < 500}`;
    if (!vectors.has(quadrant)) vectors.set(quadrant, { input, result });
  }
  check(
    vectors.size === 4,
    "deterministic dual-500 vectors cover both, provider-only, rule-only and neither gate",
  );
  for (const [quadrant, { input, result }] of vectors) {
    const pg = (
      await client.query(
        "SELECT payment_rollout_bucket_v1('provider',$1::uuid,$2::uuid) AS provider_bucket,payment_rollout_bucket_v1('rule',$1::uuid,$3::uuid) AS rule_bucket",
        [input.checkoutSessionId, input.providerAccountId, input.routeRuleId],
      )
    ).rows[0];
    check(
      result.providerBucket === pg.provider_bucket &&
        result.ruleBucket === pg.rule_bucket &&
        (result.kind === "ELIGIBLE") ===
          (pg.provider_bucket < 500 && pg.rule_bucket < 500) &&
        (result.kind === "ELIGIBLE") === (quadrant === "true:true"),
      "both 500 gates require AND in actual PostgreSQL and domain for every quadrant",
    );
  }
  const audits = (
    await client.query(
      "SELECT p.id AS publication_id,p.config_version_id,p.action,a.action AS audit_action,a.reason_code,a.outcome FROM payment_config_publications p JOIN audit_logs a ON a.id=p.audit_log_id WHERE p.id=ANY($1::uuid[]) ORDER BY p.created_at",
      [stages.map((stage) => stage.publicationId)],
    )
  ).rows;
  check(
    audits.length === 7 &&
      audits.every(
        (row, index) =>
          row.publication_id === stages[index].publicationId &&
          row.outcome === "SUCCEEDED" &&
          row.audit_action ===
            (index === 6
              ? "PAYMENT_CONFIG_ROLLBACK"
              : "PAYMENT_CONFIG_PUBLISH"),
      ),
    "every stage has its exact durable successful publication audit",
  );
  return {
    stages,
    audits,
    locales: SUPPORTED_LOCALES,
    independentPids: runtime.nodes.map((node) => node.pid),
    internalStage: {
      isolation: "LOOPBACK_FIXTURE_ONLY",
      environment: account.environment,
      accountStatus: account.status,
      liveEmployeeCohort: false,
    },
    sampling: {
      actualServerCheckoutIds: cohort.length,
      probabilityHitRequired: false,
      routeIdentityMayChangeOnNewRevision: true,
      dualGateRule:
        "providerBucket < providerBasisPoints AND ruleBucket < ruleBasisPoints",
    },
    dual500Vectors: {
      examinedDomainCandidates: examined,
      postgresComparisons: vectors.size,
      vectors: [...vectors].map(([quadrant, value]) => ({
        quadrant,
        ...value,
      })),
    },
    unknownRecovery: {
      attemptId: unknown.attempt.id,
      originalAccountId: runtime.legacyAccountId,
      originalReceiptHash: oldReceiptHash,
      originalOrderHash: oldOrderHash,
      beforeProviderPayments: legacyCounts.payments,
      afterProviderPayments: (await context.psp.counts()).payments,
      originalKeyReplayedOnBothProcesses: true,
    },
    immutableHistoryRows: immutableRows.size,
    capabilityRequests: stages.reduce(
      (sum, stage) => sum + stage.capabilityRequests,
      0,
    ),
  };
}
