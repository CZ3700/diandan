import { z } from "zod";

export const CONTRACT_SCHEMA_VERSION = 1 as const;
export const schemaVersionSchema = z.literal(CONTRACT_SCHEMA_VERSION);

export type ContractSchemaVersion = z.infer<typeof schemaVersionSchema>;
