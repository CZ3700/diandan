/// <reference types="node" />
import { createHmac } from "node:crypto";
import { adminOpaqueTokenSchema } from "@fan-support/contracts";

export type AdminContentTokenPurpose =
  "admin-session" | "admin-csrf" | "content-preview" | "base-content-preview";

export function validateAdminContentTokenPepper(tokenPepper: string): void {
  if (typeof tokenPepper !== "string" || !/^[a-f0-9]{64}$/u.test(tokenPepper)) {
    throw new Error("invalid admin token configuration");
  }
}

/** Purpose separation prevents a valid capability digest authorizing another use. */
export function digestAdminContentToken(
  input: Readonly<{
    tokenPepper: string;
    purpose: AdminContentTokenPurpose;
    token: string;
  }>,
): string {
  validateAdminContentTokenPepper(input.tokenPepper);
  if (
    !adminOpaqueTokenSchema.safeParse(input.token).success ||
    ![
      "admin-session",
      "admin-csrf",
      "content-preview",
      "base-content-preview",
    ].includes(input.purpose)
  ) {
    throw new Error("invalid admin token");
  }
  return createHmac("sha256", Buffer.from(input.tokenPepper, "hex"))
    .update(`fan-support:admin-token:v1:${input.purpose}:`, "utf8")
    .update(input.token, "ascii")
    .digest("hex");
}
