/** Opt-in wiring for an owned TEST process; never used for the preview build. */
export function storefrontTestRumEnvironment(environment, enabled = false) {
  if (typeof enabled !== "boolean")
    throw new TypeError("RUM fixture flag must be boolean");
  if (!enabled) return environment;
  if (environment.FAN_SUPPORT_DEPLOYMENT_ENV !== "test") {
    throw new TypeError("RUM fixture requires the owned TEST runtime");
  }
  return {
    ...environment,
    FAN_SUPPORT_RUM_MODE: "local",
    FAN_SUPPORT_RUM_SAMPLE_PERMILLE: "1000",
  };
}
