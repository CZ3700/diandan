import { expect, test } from "vitest";
import * as airwallex from "./index.js";

test("the deployment boundary exposes the adapter factory and wiring constants, never raw transports or credentials", () => {
  expect(Object.keys(airwallex).sort()).toEqual([
    "AIRWALLEX_ADAPTER_KEY",
    "AIRWALLEX_ADAPTER_VERSION",
    "AIRWALLEX_API_ORIGINS",
    "AIRWALLEX_API_VERSION",
    "AIRWALLEX_CHECKOUT_ORIGINS",
    "AIRWALLEX_MAX_ACTION_TTL_MS",
    "AIRWALLEX_PROTOCOL",
    "AIRWALLEX_SIGNATURE_HEADER",
    "AIRWALLEX_TIMESTAMP_HEADER",
    "AIRWALLEX_WEBHOOK_EVENT_TYPES",
    "createAirwallexAdapter",
    "workspacePackageName",
  ]);
  expect(airwallex.workspacePackageName).toBe("@fan-support/payment-airwallex");
  expect(airwallex.AIRWALLEX_API_VERSION).toBe("2026-08-21");
});
