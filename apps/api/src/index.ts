export * from "./publication-preflight-composition.js";
export {
  createTestAdminContentComposition,
  type TestAdminContentCompositionOptions,
} from "./admin-content-composition.js";
export const workspacePackageName = "@fan-support/api" as const;

export {
  createTestContentAuthoringComposition,
  type TestContentAuthoringCompositionOptions,
} from "./content-authoring-composition.js";
export {
  createTestBaseContentComposition,
  type TestBaseContentCompositionOptions,
} from "./base-content-composition.js";

export {
  createTestResourceManagementComposition,
  type TestResourceManagementCompositionOptions,
} from "./resource-management-composition.js";
export * from "./publication-runtime-route.js";
export * from "./published-content-route.js";
export * from "./publication-runtime-composition.js";
export * from "./published-content-composition.js";

export * from "./admin-session-route.js";
export * from "./admin-session-composition.js";
export * from "./admin-workspace-route.js";
export * from "./admin-workspace-composition.js";

export * from "./gift-commerce-route.js";

export * from "./gift-commerce-composition.js";

export * from "./published-gift-commerce-route.js";
