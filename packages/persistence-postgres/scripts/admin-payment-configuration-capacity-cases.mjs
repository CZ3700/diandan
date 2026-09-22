import { randomBytes, randomUUID } from "node:crypto";
export async function verifyPaymentConfigurationCapacity({
  client,
  check,
  execute,
  deployed,
  published,
  configuration,
  failure,
}) {
  const prior = [...deployed],
    fresh = [];
  const before = Number(
    (
      await client.query(
        "SELECT count(*) n FROM admin_payment_configuration_revisions",
      )
    ).rows[0].n,
  );
  const merchant = (
    await client.query(
      "SELECT merchant_entity_id FROM payment_provider_accounts WHERE id=$1",
      [prior[0].providerAccountId],
    )
  ).rows[0].merchant_entity_id;
  await client.query("BEGIN");
  try {
    for (let i = 0; i < 99; i++) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO payment_provider_accounts(id,merchant_entity_id,adapter_key,environment,account_reference_digest,credential_secret_ref,status) VALUES($1,$2,'fake','TEST',$3,$4,'ACTIVE')`,
        [
          id,
          merchant,
          randomBytes(32),
          `secret-ref:v1:aws-sm:test/payment/${id}`,
        ],
      );
      await client.query(
        `INSERT INTO payment_provider_health_events(id,provider_account_id,sequence,from_status,to_status,observer_kind,task_name,reason_code,request_id,correlation_id) VALUES($1,$2,1,NULL,'HEALTHY','SYSTEM','configuration-capacity-test','SYNTHETIC_TEST_HEALTH',$3,$4)`,
        [randomUUID(), id, randomUUID(), randomUUID()],
      );
      fresh.push({ ...prior[0], providerAccountId: id });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  // The second existing account has only an unpublished managed draft. It is
  // deliberately absent from this deployment snapshot, but remains known history.
  deployed.splice(0, deployed.length, prior[0], ...fresh);
  try {
    const result = await execute({
      action: "SAVE",
      sourceRevisionId: null,
      expectedPublicationId: published.publicationId,
      idempotencyKey: randomUUID(),
      configuration: {
        schemaVersion: 1,
        channels: fresh.map((a) => ({
          ...configuration.channels[0],
          providerAccountId: a.providerAccountId,
          enabled: false,
          translations: [],
        })),
        routes: [],
      },
    });
    failure(result, "CONFLICT");
    check(
      Number(
        (
          await client.query(
            "SELECT count(*) n FROM admin_payment_configuration_revisions",
          )
        ).rows[0].n,
      ) === before,
      "over-capacity save creates no partially managed history",
    );
  } finally {
    deployed.splice(0, deployed.length, ...prior);
  }
}
