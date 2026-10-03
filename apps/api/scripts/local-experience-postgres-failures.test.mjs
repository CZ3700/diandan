import assert from "node:assert/strict";
import test from "node:test";
const module = await import("./local-experience-postgres-failures.mjs").catch(
  () => ({}),
);

test("rolled-back writes report only SQLSTATE, trigger function and constraint names", async () => {
  assert.equal(typeof module.reportPostgresFailures, "function");
  const failures = [
    Object.assign(new Error("PRIVATE_CANARY value"), {
      code: "23514",
      where: "PL/pgSQL function guard_wish_reservation() line 9 at RAISE",
      constraint: "wish_bindings_pkey",
      detail: "Key (handle)=(PRIVATE_CANARY) already exists.",
    }),
    Object.assign(new Error("PRIVATE_CANARY"), {
      code: "not a code",
      where: 'PL/pgSQL function "Bad Name"() line 1',
      constraint: "PRIVATE CANARY",
    }),
  ];
  class FakeClient {
    query() {
      return Promise.reject(failures.shift());
    }
  }
  const lines = [];
  module.reportPostgresFailures(FakeClient, (line) => lines.push(line));
  for (let index = 0; index < 2; index++)
    await assert.rejects(new FakeClient().query("SELECT 1"));
  assert.doesNotMatch(lines.join(""), /PRIVATE_CANARY|Key \(/u);
  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    [
      {
        postgresFailure: {
          code: "23514",
          guard: "guard_wish_reservation",
          constraint: "wish_bindings_pkey",
        },
      },
      { postgresFailure: { code: null, guard: null, constraint: null } },
    ],
  );
});

test("journey evidence counts only well-formed failure lines from a mixed log", () => {
  assert.equal(typeof module.summarizePostgresFailures, "function");
  const log = [
    '{"stage":"ready"}',
    '{"postgresFailure":{"code":"40001","guard":null,"constraint":null}}',
    '{"postgresFailure":{"code":"40001","guard":null,"constraint":null}}',
    '{"postgresFailure":{"code":"23514","guard":"assert_wish_binding","constraint":null}}',
    '{"postgresFailure":{"code":"PRIVATE_CANARY","guard":"x y","constraint":"PRIVATE CANARY"}}',
    "not json PRIVATE_CANARY",
  ].join("\n");
  const summary = module.summarizePostgresFailures(log);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_CANARY/u);
  assert.deepEqual(summary, [
    { code: "40001", guard: null, constraint: null, count: 2 },
    { code: "23514", guard: "assert_wish_binding", constraint: null, count: 1 },
    { code: null, guard: null, constraint: null, count: 1 },
  ]);
});
