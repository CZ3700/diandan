import assert from "node:assert/strict";
import test from "node:test";
import { regressionSuiteEnvironment } from "./regression-environment.mjs";

const selectors = [
  "POSTGRES_TEST_BIN",
  "FAN_SUPPORT_LOCAL_POSTGRES_BIN",
  "ADMIN_FINANCE_TEST_POSTGRES_BIN",
  "ADMIN_PAYMENT_CONFIG_TEST_POSTGRES_BIN",
  "ADMIN_EXCEPTIONS_TEST_POSTGRES_BIN",
  "PSP_ONBOARDING_TEST_POSTGRES_BIN",
];

test("all suites use one explicit PostgreSQL tool directory, with no legacy override", () => {
  for (const selector of selectors)
    for (const suite of [
      "quality",
      "catalog",
      "commerce",
      "operations",
      "journey",
    ])
      assert.deepEqual(
        regressionSuiteEnvironment(suite, {
          PATH: "/tools",
          [selector]: "/pg18/bin",
        }),
        {
          PATH: "/tools",
          POSTGRES_TEST_BIN: "/pg18/bin",
          ...(suite === "journey"
            ? { FAN_SUPPORT_LOCAL_POSTGRES_BIN: "/pg18/bin" }
            : {}),
        },
      );
});

test("identical legacy selectors agree; different or invalid selectors fail closed", () => {
  const matching = Object.fromEntries(
    selectors.map((key) => [key, "/pg18/bin"]),
  );
  assert.equal(
    regressionSuiteEnvironment("quality", matching).POSTGRES_TEST_BIN,
    "/pg18/bin",
  );
  for (const selector of selectors)
    for (const value of ["", "relative", "/other/bin"])
      assert.throws(() =>
        regressionSuiteEnvironment("quality", {
          ...matching,
          [selector]: value,
        }),
      );
});

test("unconfigured runs preserve the default and never invent a database selection", () => {
  assert.deepEqual(regressionSuiteEnvironment("quality", { PATH: "/tools" }), {
    PATH: "/tools",
  });
});
