/** Browser constants and erased types, without loading runtime Zod schemas. */
export const RUM_ENDPOINT = "/api/storefront/rum" as const;
export type { RumIntake, RumContext } from "./rum.js";
