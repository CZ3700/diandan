import { AdminClientError } from "../workspace/client";
import type { ManagementCopy } from "./copy";
export function managementError(error: unknown, copy: ManagementCopy): string {
  const code = error instanceof AdminClientError ? error.code : "";
  switch (code) {
    case "REUPLOAD_REQUIRED":
      return copy.reuploadRequired;
    case "FORBIDDEN":
    case "NEEDS_AUTHORIZATION":
      return copy.forbidden;
    case "UNAUTHENTICATED":
    case "SESSION_EXPIRED":
      return copy.sessionMissing;
    case "TARGET_CONFLICT":
    case "VERSION_CONFLICT":
    case "STALE_VERSION":
      return copy.conflict;
    case "INVENTORY_POLICY_LOCKED":
      return copy.inventoryPolicyLocked;
    case "SOURCE_TOO_SMALL":
      return copy.sourceTooSmall;
    case "HERO_NOT_CONFIGURED":
      return copy.posterUnavailable;
    case "DEFAULTS_NOT_CONFIGURED":
      return copy.noMarket;
    case "NETWORK_ERROR":
      return copy.network;
    case "imageFormat":
      return copy.imageFormat;
    case "imageEmpty":
      return copy.imageEmpty;
    default:
      return copy.failedProcessing;
  }
}
