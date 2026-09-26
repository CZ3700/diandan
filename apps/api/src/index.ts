export const workspacePackageName = "@fan-support/api" as const;

// TEST and local-development compositions live in ./testing and are never exported here.
export * from "./publication-runtime-route.js";
export * from "./published-content-route.js";
export * from "./published-content-composition.js";

export * from "./admin-session-route.js";
export * from "./admin-workspace-route.js";

export * from "./gift-commerce-route.js";

export * from "./published-gift-commerce-route.js";
export * from "./management-center-route.js";
export {
  registerPaymentRuntimeRoute,
  type PaymentRuntimeRouteDependencies,
} from "./payment-runtime-route.js";
export {
  createPaymentRuntimeComposition,
  type PaymentRuntimeComposition,
} from "./payment-runtime-composition.js";

export * from "./admin-access-route.js";
export * from "./admin-finance-route.js";
export * from "./admin-payment-configuration-route.js";
export * from "./payment-configuration-runtime.js";
export * from "./admin-exceptions-route.js";
