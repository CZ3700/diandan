import { describe, expect, test } from "vitest";
import {
  adminPasswordProblem,
  decodeBase32,
  digestAdminLocalChallenge,
  digestAdminLocalIdentitySubject,
  digestAdminRecoveryCode,
  encodeBase32,
  generateAdminTemporaryPassword,
  generateAdminRecoveryCodes,
  generateAdminTotpSecret,
  hashAdminPassword,
  normalizeAdminRecoveryCode,
  adminTotpUri,
  totpCode,
  verifyAdminPassword,
  verifyAdminTotp,
} from "./admin-local-credentials.js";

const pepper = "a".repeat(64);

describe("admin passwords", () => {
  test("scrypt hashes are salted, self-describing and verify only the same password", async () => {
    const first = await hashAdminPassword("correct horse battery");
    const second = await hashAdminPassword("correct horse battery");
    expect(first).toMatch(
      /^scrypt\$1\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/u,
    );
    expect(first).not.toBe(second);
    expect(await verifyAdminPassword("correct horse battery", first)).toBe(
      true,
    );
    expect(await verifyAdminPassword("correct horse batterY", first)).toBe(
      false,
    );
  });
  test("an unknown account or malformed hash still costs a hash and never verifies", async () => {
    expect(await verifyAdminPassword("anything at all", null)).toBe(false);
    expect(await verifyAdminPassword("anything at all", "plain")).toBe(false);
    expect(
      await verifyAdminPassword("anything at all", "scrypt$1$2$8$1$AA$AA"),
    ).toBe(false);
  });
  test("new passwords need 12 to 128 characters and must not be the login name", () => {
    expect(adminPasswordProblem("short", "studio")).toBe("TOO_SHORT");
    expect(adminPasswordProblem("x".repeat(129), "studio")).toBe("TOO_LONG");
    expect(adminPasswordProblem("Studio.Owner", "studio.owner")).toBe(
      "SAME_AS_LOGIN",
    );
    expect(adminPasswordProblem("应援工作室的长密码十二位", "studio")).toBe(
      null,
    );
    expect(adminPasswordProblem("a long enough passphrase", "studio")).toBe(
      null,
    );
  });
});

describe("TOTP", () => {
  // RFC 6238 Appendix B, SHA-1, truncated to six digits.
  const rfcSecret = Buffer.from("12345678901234567890", "ascii");
  test.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("RFC 6238 vector at %i seconds", (seconds, code) => {
    expect(totpCode(rfcSecret, Math.floor(seconds / 30))).toBe(code);
  });
  test("base32 round-trips the RFC secret like authenticator apps expect", () => {
    expect(encodeBase32(rfcSecret)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(decodeBase32("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")).toEqual(
      rfcSecret,
    );
    expect(decodeBase32("GEZ1")).toBe(null);
  });
  test("accepts one step of clock drift, never a replayed or older step", () => {
    const now = new Date(1111111111 * 1000);
    const step = Math.floor(1111111111 / 30);
    expect(verifyAdminTotp(rfcSecret, "050471", now, null)).toBe(step);
    expect(
      verifyAdminTotp(rfcSecret, totpCode(rfcSecret, step - 1), now, null),
    ).toBe(step - 1);
    expect(
      verifyAdminTotp(rfcSecret, totpCode(rfcSecret, step + 1), now, null),
    ).toBe(step + 1);
    expect(
      verifyAdminTotp(rfcSecret, totpCode(rfcSecret, step - 2), now, null),
    ).toBe(null);
    expect(verifyAdminTotp(rfcSecret, "050471", now, step)).toBe(null);
    expect(verifyAdminTotp(rfcSecret, "05047", now, null)).toBe(null);
    expect(verifyAdminTotp(rfcSecret, "abcdef", now, null)).toBe(null);
  });
  test("new secrets are 160 random bits and the URI names the studio and account", () => {
    const secret = generateAdminTotpSecret();
    expect(secret).toHaveLength(20);
    expect(generateAdminTotpSecret()).not.toEqual(secret);
    expect(
      adminTotpUri({
        issuer: "Fan Support Studio",
        account: "studio.owner",
        secret: rfcSecret,
      }),
    ).toBe(
      "otpauth://totp/Fan%20Support%20Studio:studio.owner?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Fan%20Support%20Studio&algorithm=SHA1&digits=6&period=30",
    );
  });
});

describe("recovery codes", () => {
  test("ten unambiguous single-use codes, compared only through a peppered digest", () => {
    const codes = generateAdminRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes)
      expect(code).toMatch(
        /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/u,
      );
    const code = codes[0]!;
    expect(normalizeAdminRecoveryCode(` ${code.toLowerCase()} `)).toBe(
      code.replaceAll("-", ""),
    );
    expect(normalizeAdminRecoveryCode("not a code")).toBe(null);
    const digest = digestAdminRecoveryCode(pepper, code);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digestAdminRecoveryCode(pepper, code.replaceAll("-", ""))).toBe(
      digest,
    );
    expect(digestAdminRecoveryCode("b".repeat(64), code)).not.toBe(digest);
  });
});

describe("built-in sign-in material", () => {
  test("temporary passwords are unambiguous, grouped and long enough for the policy", () => {
    const passwords = new Set(
      Array.from({ length: 50 }, () => generateAdminTemporaryPassword()),
    );
    expect(passwords.size).toBe(50);
    for (const password of passwords) {
      expect(password).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/u);
      expect(adminPasswordProblem(password, "night.shift")).toBe(null);
    }
  });
  test("a built-in identity key is peppered, stable and bound to the account id", () => {
    const account = "3f2c9a1e-0000-4000-8000-000000000001";
    const digest = digestAdminLocalIdentitySubject(pepper, account);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digestAdminLocalIdentitySubject(pepper, account)).toBe(digest);
    expect(
      digestAdminLocalIdentitySubject(
        pepper,
        "3f2c9a1e-0000-4000-8000-000000000002",
      ),
    ).not.toBe(digest);
    expect(digestAdminLocalIdentitySubject("b".repeat(64), account)).not.toBe(
      digest,
    );
    expect(() => digestAdminLocalIdentitySubject(pepper, "owner")).toThrow();
  });
  test("a sign-in challenge is stored only as a purpose-bound digest", () => {
    const token = "A".repeat(42) + "A";
    const digest = digestAdminLocalChallenge(pepper, token);
    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(digestAdminLocalChallenge("b".repeat(64), token)).not.toBe(digest);
    expect(() => digestAdminLocalChallenge(pepper, "short")).toThrow();
  });
});
