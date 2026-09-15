import { Buffer } from "node:buffer";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import {
  keyManagementPortResponseSchema,
  keyVersionSchema,
  type ComputeBlindIndexCommand,
  type ComputeBlindIndexResponse,
} from "@fan-support/contracts";

export type OrderAccessCredentialOptions = Readonly<{
  activePepperVersion: string;
  pepperVersions: readonly string[];
  keyManagement: {
    computeBlindIndex(
      command: ComputeBlindIndexCommand,
    ): Promise<ComputeBlindIndexResponse>;
  };
}>;
type Scope =
  | "ORDER_LINK_V1"
  | "ORDER_SESSION_V1"
  | "ORDER_CSRF_V1"
  | "ORDER_RATE_LIMIT_V1";

export function isOrderAccessCredential(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}

/** Raw credentials and network addresses end here; application commands contain only keyed digests. */
export function createOrderAccessCredentials(
  options: OrderAccessCredentialOptions,
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
    throw new TypeError("Invalid order access key configuration");
  const versions = [
    options.activePepperVersion,
    ...options.pepperVersions.filter(
      (version) => version !== options.activePepperVersion,
    ),
  ];
  async function mac(value: string, scope: Scope, keyVersion: string) {
    try {
      const response = keyManagementPortResponseSchema.safeParse(
        await options.keyManagement.computeBlindIndex({
          schemaVersion: 1,
          operation: "COMPUTE_BLIND_INDEX",
          purpose: "ORDER_ACCESS_TOKEN",
          keyVersion,
          valueBase64: Buffer.from(`${scope}\u0000${value}`, "utf8").toString(
            "base64url",
          ),
        }),
      );
      if (
        !response.success ||
        response.data.operation !== "COMPUTE_BLIND_INDEX" ||
        response.data.outcome !== "SUCCESS" ||
        response.data.value.keyVersion !== keyVersion ||
        !isOrderAccessCredential(response.data.value.digestBase64)
      )
        throw new Error("Invalid response");
      return response.data.value.digestBase64;
    } catch {
      throw new Error("Order access credentials unavailable");
    }
  }
  async function access(value: string, scope: Scope, pepperVersion: string) {
    return {
      schemaVersion: 1 as const,
      tokenDigest: Buffer.from(
        await mac(value, scope, pepperVersion),
        "base64url",
      ).toString("hex"),
      pepperVersion,
    };
  }
  function validateToken(token: string) {
    if (!isOrderAccessCredential(token))
      throw new TypeError("Invalid order access credential");
  }
  async function resolveLink(token: string) {
    validateToken(token);
    return Promise.all(
      versions.map((version) => access(token, "ORDER_LINK_V1", version)),
    );
  }
  async function resolveSession(token: string, csrf?: string) {
    validateToken(token);
    const proofs = await Promise.all(
      versions.map(async (version) => ({
        access: await access(token, "ORDER_SESSION_V1", version),
        csrfToken: await mac(token, "ORDER_CSRF_V1", version),
      })),
    );
    return {
      accesses: proofs.map((proof) => proof.access),
      csrfToken: proofs[0]!.csrfToken,
      csrfValid:
        isOrderAccessCredential(csrf) &&
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
  }
  return Object.freeze({
    resolveLink,
    resolveSession,
    async issueLink() {
      const token = randomBytes(32).toString("base64url");
      return {
        token,
        access: await access(
          token,
          "ORDER_LINK_V1",
          options.activePepperVersion,
        ),
      };
    },
    async issueSession() {
      const token = randomBytes(32).toString("base64url");
      const resolved = await resolveSession(token);
      return {
        token,
        access: resolved.accesses[0]!,
        csrfToken: resolved.csrfToken,
      };
    },
    async rateLimitAccess(networkIdentity: string) {
      if (isIP(networkIdentity) === 0)
        throw new TypeError("Invalid order access network identity");
      return access(
        networkIdentity,
        "ORDER_RATE_LIMIT_V1",
        options.activePepperVersion,
      );
    },
  });
}
