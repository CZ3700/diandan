import { Buffer } from "node:buffer";
import { expect, test, vi } from "vitest";
import type { KeyManagementPort } from "@fan-support/key-management-port";

const modulePath = "./checkout-contact.js";
const runtime = (await import(modulePath).catch(() => ({}))) as {
  encryptCheckoutContact?: (
    keys: KeyManagementPort,
    email: string,
    subjectId: string,
  ) => Promise<unknown>;
};
const email = "Private.Test@Example.test";
const subjectId = "00000000-0000-4000-8000-000000000103";
function fixture() {
  const encryptEnvelope = vi.fn(async () => ({
    schemaVersion: 1,
    operation: "ENCRYPT_ENVELOPE",
    outcome: "SUCCESS",
    value: {
      ciphertext: `enc:v1:${"a".repeat(43)}`,
      encryptedDataKey: `enc:v1:${"b".repeat(43)}`,
      keyVersion: "test-envelope-v1",
      algorithm: "AES_256_GCM",
    },
  }));
  const computeBlindIndex = vi.fn(async () => ({
    schemaVersion: 1,
    operation: "COMPUTE_BLIND_INDEX",
    outcome: "SUCCESS",
    value: {
      digestBase64: "c".repeat(43),
      keyVersion: "test-lookup-v1",
      algorithm: "HMAC_SHA_256",
    },
  }));
  return {
    encryptEnvelope,
    computeBlindIndex,
    keys: {
      encryptEnvelope,
      computeBlindIndex,
      decryptEnvelope: vi.fn(),
      encryptEnvelopeFields: vi.fn(),
    } as unknown as KeyManagementPort,
  };
}
test("checkout contact only returns encrypted email and its keyed normalized lookup", async () => {
  const f = fixture();
  expect(runtime.encryptCheckoutContact).toBeTypeOf("function");
  const result = await runtime.encryptCheckoutContact!(
    f.keys,
    email,
    subjectId,
  );
  expect(f.encryptEnvelope).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "ENCRYPT_ENVELOPE",
    purpose: "CUSTOMER_CONTACT_EMAIL",
    subjectId,
    plaintextBase64: Buffer.from(email).toString("base64url"),
  });
  expect(f.computeBlindIndex).toHaveBeenCalledWith({
    schemaVersion: 1,
    operation: "COMPUTE_BLIND_INDEX",
    purpose: "CUSTOMER_CONTACT_EMAIL_LOOKUP",
    valueBase64: Buffer.from(email.toLowerCase()).toString("base64url"),
  });
  expect(result).toEqual({
    emailCiphertext: `enc:v1:${"a".repeat(43)}`,
    encryptedDataKey: `enc:v1:${"b".repeat(43)}`,
    encryptionKeyVersion: "test-envelope-v1",
    emailLookupHmac: Buffer.from("c".repeat(43), "base64url").toString("hex"),
    lookupKeyVersion: "test-lookup-v1",
  });
  expect(JSON.stringify(result)).not.toContain(email);
  expect(f.keys.decryptEnvelope).not.toHaveBeenCalled();
});
test.each(["encryptEnvelope", "computeBlindIndex"] as const)(
  "%s failure cannot return a partial contact or leak input",
  async (method) => {
    const f = fixture();
    f[method].mockRejectedValue(new Error(`upstream leaked ${email}`));
    expect(runtime.encryptCheckoutContact).toBeTypeOf("function");
    await expect(
      runtime.encryptCheckoutContact!(f.keys, email, subjectId),
    ).rejects.toThrow("Checkout contact encryption unavailable");
    try {
      await runtime.encryptCheckoutContact!(f.keys, email, subjectId);
    } catch (error) {
      expect(String(error)).not.toContain(email);
    }
  },
);
