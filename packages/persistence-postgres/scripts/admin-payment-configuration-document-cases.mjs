export async function verifyPaymentConfigurationDocument({
  client,
  check,
  configuration,
}) {
  const safe = async (value) =>
    (
      await client.query(
        "SELECT public.managed_payment_document_is_safe($1::jsonb) safe",
        [JSON.stringify(value)],
      )
    ).rows[0].safe;
  check(
    await safe(configuration),
    "well-shaped incomplete document is valid draft storage",
  );
  const edits = [
    [
      "health settings reject numeric strings",
      (d) => {
        d.channels[0].healthPolicy.failureThreshold = "3";
      },
    ],
    [
      "route amounts reject numeric strings",
      (d) => {
        d.routes[0].maximumAmountMinor = "100";
      },
    ],
    [
      "route priority rejects numeric strings",
      (d) => {
        d.routes[0].priority = "1";
      },
    ],
    [
      "route rollout rejects numeric strings",
      (d) => {
        d.routes[0].rolloutBasisPoints = "1";
      },
    ],
    [
      "country array rejects duplicates",
      (d) => {
        d.routes[0].countries = ["US", "US"];
      },
    ],
    [
      "market array rejects duplicates",
      (d) => {
        d.routes[0].markets = ["GLOBAL", "GLOBAL"];
      },
    ],
    [
      "currency array rejects duplicates",
      (d) => {
        d.routes[0].currencies = ["USD", "USD"];
      },
    ],
    [
      "capability array rejects duplicates",
      (d) => {
        d.routes[0].requiredDeviceCapabilities = ["REDIRECT", "REDIRECT"];
      },
    ],
    [
      "country array rejects null",
      (d) => {
        d.routes[0].countries = [null];
      },
    ],
    [
      "market array respects 100 limit",
      (d) => {
        d.routes[0].markets = Array.from(
          { length: 101 },
          (_, i) => `MARKET_${i}`,
        );
      },
    ],
    [
      "nested unknown fields rejected",
      (d) => {
        d.channels[0].healthPolicy.credentialSecretRef = "forbidden";
      },
    ],
    [
      "missing required top-level field rejected",
      (d) => {
        delete d.routes;
      },
    ],
  ];
  for (const [label, edit] of edits) {
    const candidate = globalThis.structuredClone(configuration);
    edit(candidate);
    check(!(await safe(candidate)), label);
  }
}
