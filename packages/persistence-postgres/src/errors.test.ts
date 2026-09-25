import { describe, expect, test } from "vitest";

import { classifyPostgresFailure } from "./errors.js";

describe("classifyPostgresFailure", () => {
  test.each([
    ["40001", "TRANSACTION_ABORTED", "RETRY_SAME_COMMAND"],
    ["40P01", "TRANSACTION_ABORTED", "RETRY_SAME_COMMAND"],
    ["23505", "ALREADY_EXISTS", "NONE"],
    ["23503", "INTEGRITY_VIOLATION", "NONE"],
    ["23514", "INTEGRITY_VIOLATION", "NONE"],
    ["08006", "TEMPORARY_UNAVAILABLE", "RETRY_SAME_COMMAND"],
    ["57P03", "TEMPORARY_UNAVAILABLE", "RETRY_SAME_COMMAND"],
    ["28P01", "CONFIGURATION_ERROR", "NONE"],
    ["28000", "CONFIGURATION_ERROR", "NONE"],
    ["3D000", "CONFIGURATION_ERROR", "NONE"],
    ["42P01", "CONFIGURATION_ERROR", "NONE"],
    ["42703", "CONFIGURATION_ERROR", "NONE"],
    ["42883", "CONFIGURATION_ERROR", "NONE"],
    ["0A000", "CONFIGURATION_ERROR", "NONE"],
    ["22003", "INTEGRITY_VIOLATION", "NONE"],
    ["22P02", "INTEGRITY_VIOLATION", "NONE"],
  ] as const)(
    "maps SQLSTATE %s to a stable supplier-free error",
    (sqlState, code, recovery) => {
      expect(
        classifyPostgresFailure({
          code: sqlState,
          message: "raw SQL failed [SENSITIVE_DATABASE_DETAIL]",
          constraint: "private_constraint_name",
        }),
      ).toEqual({
        code,
        recovery,
        ...(recovery === "RETRY_SAME_COMMAND" ? { retryAfterMs: 250 } : {}),
      });
    },
  );

  test("fails closed without reflecting unknown error details", () => {
    expect(
      classifyPostgresFailure(
        new Error("connection failed [SENSITIVE_DATABASE_DETAIL]"),
      ),
    ).toEqual({
      code: "UNEXPECTED_ADAPTER_FAILURE",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 250,
    });
  });

  test("classifies a driver error wrapped by the query layer", () => {
    expect(
      classifyPostgresFailure({
        message: "query failed",
        cause: { code: "23505", constraint: "private_constraint_name" },
      }),
    ).toEqual({ code: "ALREADY_EXISTS", recovery: "NONE" });
  });

  test.each(["code", "cause"] as const)(
    "does not execute a provider %s accessor",
    (property) => {
      let getterCalls = 0;
      const providerError = {};
      Object.defineProperty(providerError, property, {
        enumerable: true,
        get() {
          getterCalls += 1;
          return property === "code" ? "40001" : { code: "40001" };
        },
      });

      expect(classifyPostgresFailure(providerError)).toEqual({
        code: "UNEXPECTED_ADAPTER_FAILURE",
        recovery: "RETRY_SAME_COMMAND",
        retryAfterMs: 250,
      });
      expect(getterCalls).toBe(0);
    },
  );

  test("does not trust inherited SQLSTATE fields", () => {
    const providerError = Object.create({ code: "40001" }) as object;

    expect(classifyPostgresFailure(providerError)).toEqual({
      code: "UNEXPECTED_ADAPTER_FAILURE",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 250,
    });
  });

  test("fails closed when a provider proxy rejects descriptor inspection", () => {
    const providerError = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("RAW_PROVIDER_DESCRIPTOR_TRAP");
        },
      },
    );

    expect(classifyPostgresFailure(providerError)).toEqual({
      code: "UNEXPECTED_ADAPTER_FAILURE",
      recovery: "RETRY_SAME_COMMAND",
      retryAfterMs: 250,
    });
  });
});
