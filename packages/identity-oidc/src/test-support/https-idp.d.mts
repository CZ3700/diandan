import type { Buffer } from "node:buffer";

export type TestOidcMode =
  | "valid"
  | "no-mfa"
  | "wrong-signature"
  | "disconnect"
  | "NORMAL"
  | "NO_MFA"
  | "WRONG_SIGNATURE"
  | "UNSIGNED"
  | "MISSING_ID_TOKEN"
  | "MALFORMED"
  | "DISCONNECT"
  | "SLOW"
  | "OVERSIZED"
  | "BODY_STALL"
  | "INVALID_GRANT"
  | "ACCESS_DENIED"
  | "RATE_LIMIT"
  | "REDIRECT";
export type TestTlsMaterial = {
  key: Buffer;
  cert: Buffer;
  keyPath: string;
  certPath: string;
  cleanup(): void;
};
export function createTestTlsMaterial(host: string): TestTlsMaterial;
export type TestOidcOptions = {
  host?: string;
  clientId?: string;
  clientSecret?: string;
  subject?: string;
  acr?: string;
  amr?: string[];
  redirectOrigins?: string[];
  beforeValidTokenResponse?: (input: { state: string }) => Promise<void>;
};
export type TestOidcProvider = {
  issuer: string;
  fetch: typeof fetch;
  ca: Buffer;
  readonly tokenRequests: number;
  readonly discoveryRequests: number;
  readonly tokenBody: URLSearchParams;
  readonly tokenAuthorization: string | undefined;
  reset(): void;
  setMode(mode: TestOidcMode): void;
  setSubject(subject: string): void;
  setClaims(claims: Record<string, unknown>): void;
  setDiscovery(metadata: Record<string, unknown>): void;
  stop(): Promise<void>;
};
export function startTestOidcProvider(
  options?: TestOidcOptions,
): Promise<TestOidcProvider>;
