import { Buffer } from "node:buffer";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  keyManagementPortResponseSchema,
  keyVersionSchema,
  type ComputeBlindIndexCommand,
  type ComputeBlindIndexResponse,
} from "@fan-support/contracts";
export type CartSessionCredentialOptions = Readonly<{
  activePepperVersion: string;
  pepperVersions: readonly string[];
  keyManagement: {
    computeBlindIndex(
      command: ComputeBlindIndexCommand,
    ): Promise<ComputeBlindIndexResponse>;
  };
}>;
export function isCartSessionToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

/** Raw cookie and CSRF values stop here; business code receives only keyed digests. */
export function createCartSessionCredentials(
  options: CartSessionCredentialOptions,
) {
  if (
    options.pepperVersions.length < 1 ||
    options.pepperVersions.length > 4 ||
    new Set(options.pepperVersions).size !== options.pepperVersions.length ||
    !options.pepperVersions.includes(options.activePepperVersion) ||
    options.pepperVersions.some(
      (version) => !keyVersionSchema.safeParse(version).success,
    ) ||
    typeof options.keyManagement?.computeBlindIndex !== "function"
  )
    throw new TypeError("Invalid cart session key configuration");
  const versions = [
    options.activePepperVersion,
    ...options.pepperVersions.filter(
      (version) => version !== options.activePepperVersion,
    ),
  ];
  async function mac(
    token: string,
    purpose: ComputeBlindIndexCommand["purpose"],
    keyVersion: string,
  ) {
    const parsed = keyManagementPortResponseSchema.safeParse(
      await options.keyManagement.computeBlindIndex({
        schemaVersion: 1,
        operation: "COMPUTE_BLIND_INDEX",
        purpose,
        keyVersion,
        valueBase64: Buffer.from(token, "ascii").toString("base64url"),
      }),
    );
    if (
      !parsed.success ||
      parsed.data.operation !== "COMPUTE_BLIND_INDEX" ||
      parsed.data.outcome !== "SUCCESS" ||
      parsed.data.value.keyVersion !== keyVersion ||
      !isCartSessionToken(parsed.data.value.digestBase64)
    ) {
      throw new Error("Cart session credentials unavailable");
    }
    return parsed.data.value.digestBase64;
  }
  async function resolve(token: string, csrf?: string) {
    if (!isCartSessionToken(token))
      throw new TypeError("Invalid cart session token");
    try {
      const proofs = await Promise.all(
        versions.map(async (version) => {
          const [digest, csrfToken] = await Promise.all([
            mac(token, "CART_ACCESS_TOKEN", version),
            mac(token, "CSRF_TOKEN", version),
          ]);
          return { digest, csrfToken, version };
        }),
      );
      return {
        accessCandidates: proofs.map((proof) => ({
          schemaVersion: 1 as const,
          tokenDigest: Buffer.from(proof.digest, "base64url").toString("hex"),
          pepperVersion: proof.version,
        })),
        csrfToken: proofs[0]!.csrfToken,
        csrfValid:
          isCartSessionToken(csrf) &&
          proofs.reduce(
            (matches, proof) =>
              Number(
                timingSafeEqual(
                  Buffer.from(csrf, "base64url"),
                  Buffer.from(proof.csrfToken, "base64url"),
                ),
              ) | matches,
            0,
          ) !== 0,
      };
    } catch {
      throw new Error("Cart session credentials unavailable");
    }
  }
  return Object.freeze({
    resolve,
    async issue() {
      const token = randomBytes(32).toString("base64url");
      return { token, ...(await resolve(token)) };
    },
  });
}
