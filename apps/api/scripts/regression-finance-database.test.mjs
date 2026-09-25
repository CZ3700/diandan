import assert from "node:assert/strict";
import test from "node:test";
const { withFinanceTestDatabase } =
  await import("./admin-finance-test-database.mjs").catch(() => ({}));

test("finance defaults to the original isolated Docker database and reports that actual runtime", async () => {
  const database = { fixture: "docker" };
  const result = await withFinanceTestDatabase(
    async (actual, metadata) => {
      assert.equal(actual, database);
      assert.deepEqual(metadata, {
        kind: "DOCKER_EPHEMERAL_TEST",
        configuredBy: "withEphemeralPostgres",
      });
      return "complete";
    },
    {
      environment: {},
      docker: async (work, options) => {
        assert.deepEqual(options, { environment: {} });
        return work(database, {
          kind: "DOCKER_EPHEMERAL_TEST",
          configuredBy: "withEphemeralPostgres",
        });
      },
      native: async () => assert.fail("No implicit native database"),
    },
  );
  assert.equal(result, "complete");
});

test("finance preserves the actual common runtime metadata and explicit environment", async () => {
  const environment = { POSTGRES_TEST_BIN: "/pg18/bin" };
  const metadata = {
    kind: "NATIVE_ISOLATED_TEST",
    serverVersion: "18.6",
    configuredBy: "POSTGRES_TEST_BIN",
  };
  await withFinanceTestDatabase(
    async (_database, actual) => assert.deepEqual(actual, metadata),
    {
      environment,
      docker: async (work, options) => {
        assert.equal(options.environment, environment);
        return work({}, metadata);
      },
      native: async () => assert.fail("No legacy override"),
    },
  );
});

test("conflicting common and finance selectors fail before starting either runtime", async () => {
  await assert.rejects(
    withFinanceTestDatabase(async () => assert.fail("No callback"), {
      environment: {
        POSTGRES_TEST_BIN: "/common/bin",
        ADMIN_FINANCE_TEST_POSTGRES_BIN: "/legacy/bin",
      },
      docker: async () => assert.fail("No common runtime"),
      native: async () => assert.fail("No legacy runtime"),
    }),
    /conflicting/i,
  );
});

test("an explicit native selector is used by finance and exposes only safe runtime metadata", async () => {
  const database = { fixture: "native" };
  const result = await withFinanceTestDatabase(
    async (actual, metadata) => {
      assert.equal(actual, database);
      assert.deepEqual(metadata, {
        kind: "NATIVE_ISOLATED_TEST",
        serverVersion: "18.6",
        configuredBy: "ADMIN_FINANCE_TEST_POSTGRES_BIN",
      });
      return "complete";
    },
    {
      environment: { ADMIN_FINANCE_TEST_POSTGRES_BIN: "/owned/postgres/bin" },
      docker: async () =>
        assert.fail("Explicit native selection cannot use Docker"),
      native: async (work, options) => {
        assert.deepEqual(options, { binDirectory: "/owned/postgres/bin" });
        return work(database, {
          serverVersion: "18.6",
          dataDirectory: "/private",
          runId: "private",
        });
      },
    },
  );
  assert.equal(result, "complete");
});

for (const binDirectory of ["", "relative", "/unavailable/postgres/bin"])
  test(`invalid or unavailable explicit finance tools never fall back (${JSON.stringify(binDirectory)})`, async () => {
    const failure = new Error("TEST tools rejected");
    await assert.rejects(
      withFinanceTestDatabase(async () => assert.fail("No scenario can run"), {
        environment: { ADMIN_FINANCE_TEST_POSTGRES_BIN: binDirectory },
        docker: async () => assert.fail("No silent Docker fallback"),
        native: async (_work, options) => {
          assert.equal(options.binDirectory, binDirectory);
          throw failure;
        },
      }),
      (error) => error === failure,
    );
  });

for (const stage of ["operation", "cleanup"])
  test(`native ${stage} failure is not replayed on another database`, async () => {
    const failure = new Error("TEST operation failed");
    let calls = 0;
    await assert.rejects(
      withFinanceTestDatabase(
        async () => {
          calls++;
          if (stage === "operation") throw failure;
        },
        {
          environment: {
            ADMIN_FINANCE_TEST_POSTGRES_BIN: "/owned/postgres/bin",
          },
          docker: async () => assert.fail("No replay on Docker"),
          native: async (work) => {
            await work({}, { serverVersion: "18.6" });
            throw failure;
          },
        },
      ),
      (error) => error === failure,
    );
    assert.equal(calls, 1);
  });
