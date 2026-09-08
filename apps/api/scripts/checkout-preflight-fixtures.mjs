import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

function encryptedBytes(value) {
  if (typeof value !== "string" || !/^enc:v1:[A-Za-z0-9_-]+$/u.test(value))
    throw new Error("Invalid TEST encrypted profile envelope");
  return Buffer.from(value.slice(7), "base64url");
}

/** P5 profile management is not implemented: initialize only encrypted TEST prerequisites, never checkout business rows. */
export async function seedCheckoutFulfillmentProfiles({
  client,
  kms,
  fixtures,
  identity,
  check,
}) {
  let count = 0;
  for (const artist of fixtures.artists) {
    const id = randomUUID();
    const plaintext = Buffer.from(
      JSON.stringify({
        environment: "TEST",
        destination: "SYNTHETIC_TEST_STUDIO",
        recipient: "TEST_STAFF",
      }),
    );
    let result;
    try {
      result = await kms.adapter.encryptEnvelope({
        schemaVersion: 1,
        operation: "ENCRYPT_ENVELOPE",
        purpose: "FULFILLMENT_PROFILE",
        subjectId: id,
        plaintextBase64: plaintext.toString("base64url"),
      });
    } finally {
      plaintext.fill(0);
    }
    check(
      result.outcome === "SUCCESS",
      "TEST fulfillment profile is actually envelope encrypted",
    );
    if (result.outcome !== "SUCCESS")
      throw new Error("TEST fulfillment encryption failed");
    const value = result.value;
    await client.query(
      `insert into idol_fulfillment_profiles
      (id, idol_id, profile_version, status, profile_ciphertext, encrypted_data_key, encryption_key_version, created_by)
      values ($1, $2, 1, 'ACTIVE', $3, $4, $5, $6)`,
      [
        id,
        artist.id,
        encryptedBytes(value.ciphertext),
        encryptedBytes(value.encryptedDataKey),
        value.keyVersion,
        identity.identities.identities.manager,
      ],
    );
    count++;
  }
  return {
    schemaVersion: 1,
    status: "READY",
    count,
    testOnly: true,
    normalProfileManagementAvailable: false,
  };
}
