import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
export async function verifyPaymentConfigurationStorage({
  client,
  check,
  execute,
  request,
  first,
  second,
  published,
  actors,
  deployed,
  success,
  failure,
}) {
  const original = success(
    await execute({ action: "READ", revisionId: published.revisionId }),
    "original configuration",
  ).selected.configuration;
  const rejectSql = async (work, label) => {
    await client.query("BEGIN");
    try {
      await work();
      await client.query("COMMIT");
      assert.fail(label);
    } catch (error) {
      await client.query("ROLLBACK");
      check(["23514", "55000", "23505", "23503"].includes(error.code), label);
    }
  };
  const clone = async (
    configuration = original,
    head = published.publicationId,
  ) =>
    success(
      await execute({
        action: "SAVE",
        sourceRevisionId: published.revisionId,
        expectedPublicationId: head,
        idempotencyKey: randomUUID(),
        configuration,
      }),
      "derive configured draft",
    );
  const validate = async (
    revisionId,
    head = published.publicationId,
    mode = "PUBLISH",
  ) =>
    success(
      await execute({
        action: "VALIDATE",
        revisionId,
        expectedPublicationId: head,
        mode,
      }),
      "validate draft",
    );
  const publicationCommand = (draft, validation, head, action = "PUBLISH") => ({
    action,
    revisionId: draft.revisionId,
    expectedPublicationId: head,
    validationHash: validation.validationHash,
    reasonCode: "LOCAL_VERIFIED",
    confirmed: true,
    idempotencyKey: randomUUID(),
  });
  const draft = await clone(),
    validation = await validate(draft.revisionId);
  check(validation.valid, "copied approval validates");
  const route = (
    await client.query(
      "SELECT * FROM payment_route_rules WHERE config_version_id=$1",
      [draft.revisionId],
    )
  ).rows[0];
  await rejectSql(
    () =>
      client.query(
        `INSERT INTO payment_route_rule_countries(payment_route_rule_id,country) VALUES($1,'GB')`,
        [route.id],
      ),
    "direct additional country cannot change validated document",
  );
  await rejectSql(
    () =>
      client.query(
        `INSERT INTO payment_route_rules(id,config_version_id,provider_config_id,provider_account_id,rule_key,rule_version,payment_method,enabled,minimum_amount_minor,maximum_amount_minor,priority,rollout_basis_points) SELECT $1,config_version_id,provider_config_id,provider_account_id,'rogue.rule',rule_version,payment_method,false,minimum_amount_minor,maximum_amount_minor,priority,rollout_basis_points FROM payment_route_rules WHERE id=$2`,
        [randomUUID(), route.id],
      ),
    "direct additional rule cannot change validated document",
  );
  const partial = await clone();
  await rejectSql(
    () =>
      client.query(
        `INSERT INTO payment_route_rules(id,config_version_id,provider_config_id,provider_account_id,rule_key,rule_version,payment_method,enabled,minimum_amount_minor,maximum_amount_minor,priority,rollout_basis_points) SELECT $1,$2,c.id,c.provider_account_id,r.rule_key,v.version,r.payment_method,r.enabled,r.minimum_amount_minor,r.maximum_amount_minor,r.priority,r.rollout_basis_points FROM payment_route_rules r JOIN payment_provider_configs c ON c.config_version_id=$2 AND c.provider_account_id=r.provider_account_id JOIN config_versions v ON v.id=$2 WHERE r.id=$3`,
        [randomUUID(), partial.revisionId, route.id],
      ),
    "partial route materialization without scopes cannot commit",
  );
  for (const table of [
    "admin_payment_configuration_revisions",
    "admin_payment_configuration_receipts",
    "admin_payment_configuration_validations",
    "admin_payment_configuration_activations",
  ])
    await rejectSql(
      () => client.query(`DELETE FROM ${table}`),
      `${table} history cannot be deleted`,
    );
  const longKey = "A".repeat(256);
  const longCommand = {
    action: "SAVE",
    sourceRevisionId: published.revisionId,
    expectedPublicationId: published.publicationId,
    idempotencyKey: longKey,
    configuration: original,
  };
  success(await execute(longCommand), "256 character idempotency key");
  check(
    success(await execute(longCommand), "long key replay").replayed,
    "full contract length key remains permanent",
  );
  const concurrentCommand = { ...longCommand, idempotencyKey: randomUUID() };
  const duplicate = await Promise.all([
    execute(concurrentCommand, 0, first),
    execute(concurrentCommand, 0, second),
  ]);
  check(
    duplicate.every((r) => r.outcome === "SUCCESS") &&
      duplicate[0].revisionId === duplicate[1].revisionId &&
      duplicate.filter((r) => r.replayed).length === 1,
    "concurrent same-key save commits one immutable revision",
  );
  const badVersion = deployed[0].adapterVersion;
  deployed[0].adapterVersion = "9.9.9";
  failure(
    await execute(
      publicationCommand(draft, validation, published.publicationId),
    ),
    "VALIDATION_REQUIRED",
  );
  deployed[0].adapterVersion = badVersion;
  const promoted = success(
    await execute(
      publicationCommand(draft, validation, published.publicationId),
    ),
    "second publication",
  );
  check(
    promoted.generation === published.generation + 1,
    "publication advances generation",
  );
  const rollbackValidation = await validate(
    published.revisionId,
    promoted.publicationId,
    "ROLLBACK",
  );
  check(
    rollbackValidation.valid,
    "historical immutable configuration validates for rollback",
  );
  const rolledBack = success(
    await execute(
      publicationCommand(
        published,
        rollbackValidation,
        promoted.publicationId,
        "ROLLBACK",
      ),
    ),
    "rollback",
  );
  check(
    rolledBack.generation === promoted.generation + 1,
    "rollback generation increases",
  );
  const projected =
    await second.adminPaymentConfigurationTransactionManager.runInAdminPaymentConfigurationTransaction(
      (r) => r.readPublished(),
    );
  check(
    projected.revisionId === published.revisionId &&
      projected.policies[0].version === 3,
    "rollback restores old values using fresh monotonic policy version",
  );
  const racers = await Promise.all([
    clone(original, rolledBack.publicationId),
    clone(original, rolledBack.publicationId),
  ]);
  const validated = await Promise.all(
    racers.map((d) => validate(d.revisionId, rolledBack.publicationId)),
  );
  const racing = await Promise.all(
    racers.map((d, i) =>
      execute(
        publicationCommand(d, validated[i], rolledBack.publicationId),
        0,
        i ? second : first,
      ),
    ),
  );
  check(
    racing.filter((r) => r.outcome === "SUCCESS").length === 1 &&
      racing.filter((r) => r.code === "STALE_VERSION").length === 1,
    "concurrent confirmed publications have exactly one winner",
  );
  let current = racing.find((r) => r.outcome === "SUCCESS");
  failure(
    await execute({
      action: "SAVE",
      sourceRevisionId: null,
      expectedPublicationId: published.publicationId,
      idempotencyKey: randomUUID(),
      configuration: original,
    }),
    "STALE_VERSION",
  );
  // A failed/slow original probe must not recover health after policy activation.
  const currentRoute = (
    await client.query(
      "SELECT * FROM payment_route_rules WHERE config_version_id=$1",
      [current.revisionId],
    )
  ).rows[0];
  const account = original.channels[0].providerAccountId;
  const health = (method, input) =>
    first.paymentHealthTransactionManager.runInPaymentHealthTransaction((r) =>
      r[method](input),
    );
  const context = {
    schemaVersion: 1,
    routeId: currentRoute.id,
    configVersion: Number(currentRoute.rule_version),
    ruleVersion: Number(currentRoute.rule_version),
    command: {
      schemaVersion: 1,
      operation: "GET_CAPABILITIES",
      providerAccountId: account,
      environment: "TEST",
      market: "GLOBAL",
      country: "US",
      currency: "USD",
      amountMinor: 100,
      requestedLocale: "en",
      supportedActionTypes: ["REDIRECT"],
    },
  };
  for (let i = 0; i < 3; i++)
    await health("record", {
      schemaVersion: 1,
      observationId: randomUUID(),
      providerAccountId: account,
      environment: "TEST",
      operation: "GET_CAPABILITIES",
      classification: "TECHNICAL_FAILURE",
      code: "TEMPORARY_UNAVAILABLE",
      probeContext: context,
    });
  let lease = null;
  const deadline = performance.now() + 6000;
  while (!lease) {
    lease = await health("claimProbe", {
      schemaVersion: 1,
      accounts: [{ providerAccountId: account, environment: "TEST" }],
    });
    if (!lease) {
      assert.ok(performance.now() < deadline, "probe becomes due");
      await delay(25);
    }
  }
  const fallback = deployed.find((a) => a.providerAccountId !== account);
  check(!!fallback, "second TEST account exists");
  const switched = globalThis.structuredClone(original);
  switched.channels[0].enabled = false;
  switched.routes[0].enabled = false;
  switched.channels.push({
    ...globalThis.structuredClone(original.channels[0]),
    providerAccountId: fallback.providerAccountId,
  });
  switched.routes.push({
    ...globalThis.structuredClone(original.routes[0]),
    providerAccountId: fallback.providerAccountId,
    ruleKey: "fallback.card",
  });
  const switchDraft = await clone(switched, current.publicationId);
  for (const t of switched.channels[1].translations) {
    success(
      await execute({
        action: "SUBMIT",
        revisionId: switchDraft.revisionId,
        providerAccountId: fallback.providerAccountId,
        locale: t.locale,
        idempotencyKey: randomUUID(),
      }),
      "fallback submit",
    );
    success(
      await execute(
        {
          action: "APPROVE",
          revisionId: switchDraft.revisionId,
          providerAccountId: fallback.providerAccountId,
          locale: t.locale,
          idempotencyKey: randomUUID(),
        },
        1,
      ),
      "fallback review",
    );
  }
  const switchValidation = await validate(
    switchDraft.revisionId,
    current.publicationId,
  );
  check(
    switchValidation.valid,
    "healthy fallback can replace unavailable channel",
  );
  current = success(
    await execute(
      publicationCommand(switchDraft, switchValidation, current.publicationId),
    ),
    "fallback publication",
  );
  const staleProbe = await health("completeProbe", {
    schemaVersion: 1,
    lease,
    classification: "SUCCESS",
    code: null,
  });
  check(
    !staleProbe.applied && staleProbe.healthStatus === "UNAVAILABLE",
    "old probe cannot silently recover unavailable account after activation",
  );
  const invalidRollback = await validate(
    published.revisionId,
    current.publicationId,
    "ROLLBACK",
  );
  check(
    !invalidRollback.valid &&
      invalidRollback.issues.some((i) => i.code === "ACCOUNT_UNAVAILABLE"),
    "rollback also checks live circuit health",
  );
  // Authentication remains current even when a previously valid command has a receipt.
  await client.query(
    "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=$1",
    [actors[2].session],
  );
  failure(
    await execute({ action: "READ", revisionId: null }, 2),
    "UNAUTHENTICATED",
  );
  const expiredRequest = request({ action: "READ", revisionId: null });
  expiredRequest.access.csrfTokenDigest = "0".repeat(64);
  const badCsrf =
    await first.adminPaymentConfigurationTransactionManager.runInAdminPaymentConfigurationTransaction(
      (r) => r.execute(expiredRequest),
    );
  failure(badCsrf, "CSRF_INVALID");
  const token = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex"),
    session = randomUUID();
  await client.query(
    `INSERT INTO admin_sessions(id,admin_identity_id,session_token_digest,csrf_token_digest,authenticated_with_mfa,expires_at) VALUES($1,$2,decode($3,'hex'),decode($4,'hex'),true,clock_timestamp()+interval '1500 milliseconds')`,
    [session, actors[0].id, token, csrf],
  );
  const waitingRequest = request({
    action: "SAVE",
    sourceRevisionId: published.revisionId,
    expectedPublicationId: current.publicationId,
    idempotencyKey: randomUUID(),
    configuration: original,
  });
  waitingRequest.access.sessionTokenDigest = token;
  waitingRequest.access.csrfTokenDigest = csrf;
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('admin-payment-configuration-publication',0))",
  );
  const waiting =
    second.adminPaymentConfigurationTransactionManager.runInAdminPaymentConfigurationTransaction(
      (r) => r.execute(waitingRequest),
    );
  const waitDeadline = performance.now() + 3000;
  while (
    !(
      await client.query(
        "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) waiting",
      )
    ).rows[0].waiting
  ) {
    assert.ok(
      performance.now() < waitDeadline,
      "command reaches actual publication lock",
    );
    await delay(10);
  }
  while (
    !(
      await client.query(
        "SELECT expires_at<=clock_timestamp() expired FROM admin_sessions WHERE id=$1",
        [session],
      )
    ).rows[0].expired
  )
    await delay(25);
  await client.query("COMMIT");
  failure(await waiting, "UNAUTHENTICATED");
  check(
    !(
      await client.query(
        "SELECT 1 FROM admin_payment_configuration_receipts WHERE idempotency_key=$1",
        [waitingRequest.command.idempotencyKey],
      )
    ).rowCount,
    "expiry during real lock wait writes no receipt",
  );
  await client.query("BEGIN");
  await client.query(
    "SELECT id FROM payment_config_publication_heads FOR UPDATE",
  );
  const began = performance.now();
  let timeout;
  try {
    await second.adminPaymentConfigurationTransactionManager.runInAdminPaymentConfigurationTransaction(
      (r) => r.readPublished(),
    );
  } catch (error) {
    timeout = error;
  } finally {
    await client.query("ROLLBACK");
  }
  check(
    !!timeout && performance.now() - began < 13000,
    "projection blocked on real head lock fails within acquisition-to-release deadline",
  );
  const recovered =
    await second.adminPaymentConfigurationTransactionManager.runInAdminPaymentConfigurationTransaction(
      (r) => r.readPublished(),
    );
  check(
    recovered.publicationId === current.publicationId,
    "next projection read recovers after deadline and lock release",
  );
  return current;
}
