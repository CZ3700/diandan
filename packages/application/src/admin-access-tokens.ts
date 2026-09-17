/// <reference types="node" />
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  sourceHashSchema,
  adminOpaqueTokenSchema,
  identityPortCommandSchema,
} from "@fan-support/contracts";
import { validateAdminContentTokenPepper } from "./admin-content-tokens.js";

/** A separate, stable identity key is also used when provisioning platform identities. */
export function digestAdminIdentitySubject(
  input: Readonly<{ subjectPepper: string; issuer: string; subject: string }>,
) {
  validateAdminContentTokenPepper(input.subjectPepper);
  identityPortCommandSchema.options[1].shape.issuer.parse(input.issuer);
  identityPortCommandSchema.options[1].shape.code.parse(input.subject);
  return sourceHashSchema.parse(
    createHmac("sha256", Buffer.from(input.subjectPepper, "hex"))
      .update("fan-support:admin-identity:v1:", "utf8")
      .update(JSON.stringify([input.issuer, input.subject]), "utf8")
      .digest("hex"),
  );
}
export function digestAdminLoginValue(
  pepper: string,
  purpose: "state" | "binding" | "claim",
  value: string,
) {
  validateAdminContentTokenPepper(pepper);
  return sourceHashSchema.parse(
    createHmac("sha256", Buffer.from(pepper, "hex"))
      .update(`fan-support:admin-login-digest:v1:${purpose}:`)
      .update(value)
      .digest("hex"),
  );
}
/** Each random HttpOnly browser token seeds distinct state, nonce and S256 verifier; no recoverable secret is stored in PostgreSQL. */
export function deriveAdminLoginProofs(pepper: string, browserToken: string) {
  validateAdminContentTokenPepper(pepper);
  adminOpaqueTokenSchema.parse(browserToken);
  const derive = (purpose: string, encoding: "hex" | "base64url") =>
    createHmac("sha256", Buffer.from(pepper, "hex"))
      .update(`fan-support:admin-login-proof:v1:${purpose}:`)
      .update(browserToken, "ascii")
      .digest(encoding);
  return {
    state: derive("state", "hex"),
    nonce: derive("nonce", "hex"),
    codeVerifier: derive("pkce", "base64url"),
  };
}
export function equalAdminLoginState(left: string, right: string): boolean {
  const a = Buffer.from(left),
    b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
