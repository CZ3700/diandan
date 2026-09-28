/// <reference types="node" />
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { validateAdminContentTokenPepper } from "./admin-content-tokens.js";

// ADR-021: built-in admin accounts. Only node:crypto; nothing here stores or logs a secret.

const SCRYPT = { N: 32_768, r: 8, p: 1, keyLength: 32, saltLength: 16 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const HASH_PATTERN =
  /^scrypt\$1\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/u;
// Verification of an unknown account or a damaged hash still pays for one full hash.
const DUMMY_SALT = Buffer.alloc(SCRYPT.saltLength, 7);

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize("NFC"),
      salt,
      SCRYPT.keyLength,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT_MAXMEM },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltLength);
  const key = await derive(password, salt);
  return `scrypt$1$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Only hashes written with the current parameters verify; anything else fails closed at full cost. */
export async function verifyAdminPassword(
  password: string,
  encoded: string | null,
): Promise<boolean> {
  const match = encoded === null ? null : HASH_PATTERN.exec(encoded);
  const current =
    match !== null &&
    Number(match[1]) === SCRYPT.N &&
    Number(match[2]) === SCRYPT.r &&
    Number(match[3]) === SCRYPT.p;
  const salt = current ? Buffer.from(match[4]!, "base64url") : DUMMY_SALT;
  const key = await derive(password, salt);
  if (!current) return false;
  const expected = Buffer.from(match[5]!, "base64url");
  return expected.length === key.length && timingSafeEqual(expected, key);
}

export type AdminPasswordProblem = "TOO_SHORT" | "TOO_LONG" | "SAME_AS_LOGIN";
/** Length is what matters (NIST SP 800-63B); no composition rules, any script counts per character. */
export function adminPasswordProblem(
  password: string,
  loginName: string,
): AdminPasswordProblem | null {
  const length = [...password.normalize("NFC")].length;
  if (length < 12) return "TOO_SHORT";
  if (length > 128) return "TOO_LONG";
  if (password.trim().toLowerCase() === loginName.trim().toLowerCase())
    return "SAME_AS_LOGIN";
  return null;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function encodeBase32(bytes: Buffer): string {
  let bits = 0,
    value = 0,
    output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}
export function decodeBase32(text: string): Buffer | null {
  const clean = text.replace(/[\s=]/gu, "").toUpperCase();
  let bits = 0,
    value = 0;
  const output: number[] = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

const TOTP_PERIOD_SECONDS = 30;
export function generateAdminTotpSecret(): Buffer {
  return randomBytes(20);
}
/** RFC 4226 HOTP with the RFC 6238 time step, SHA-1 and six digits, as authenticator apps expect. */
export function totpCode(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}
/** Returns the matched step (±1 for clock drift) only if it is newer than the last accepted one. */
export function verifyAdminTotp(
  secret: Buffer,
  code: string,
  now: Date,
  lastUsedStep: number | null,
): number | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const current = Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) matched = step;
  }
  if (matched === null) return null;
  return lastUsedStep === null || matched > lastUsedStep ? matched : null;
}
export function adminTotpUri(
  input: Readonly<{ issuer: string; account: string; secret: Buffer }>,
): string {
  const issuer = encodeURIComponent(input.issuer);
  const secret = encodeBase32(input.secret);
  return `otpauth://totp/${issuer}:${encodeURIComponent(input.account)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD_SECONDS}`;
}

// 32 symbols without 0/1/I/O, so a code read aloud or typed from paper stays unambiguous (60 bits each).
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const RECOVERY_PATTERN = /^[2-9A-HJ-NP-Z]{12}$/u;
export function generateAdminRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const raw = [...randomBytes(12)]
      .map((byte) => RECOVERY_ALPHABET[byte & 31])
      .join("");
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`);
  }
  return [...codes];
}
export function normalizeAdminRecoveryCode(input: string): string | null {
  const normalized = input.replace(/[\s-]/gu, "").toUpperCase();
  return RECOVERY_PATTERN.test(normalized) ? normalized : null;
}
export function digestAdminRecoveryCode(pepper: string, code: string): string {
  validateAdminContentTokenPepper(pepper);
  const normalized = normalizeAdminRecoveryCode(code);
  if (normalized === null) throw new Error("invalid recovery code");
  return createHmac("sha256", Buffer.from(pepper, "hex"))
    .update("fan-support:admin-recovery-code:v1:", "utf8")
    .update(normalized, "ascii")
    .digest("hex");
}
