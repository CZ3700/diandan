export const CONFIG_VALIDATION_ERROR_CODE = "CONFIG_INVALID" as const;

export class ConfigValidationError extends Error {
  readonly code = CONFIG_VALIDATION_ERROR_CODE;
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    const normalizedFields = Object.freeze([...new Set(fields)].sort());

    super(`Runtime configuration is invalid: ${normalizedFields.join(", ")}`);
    this.name = "ConfigValidationError";
    this.fields = normalizedFields;
  }
}
