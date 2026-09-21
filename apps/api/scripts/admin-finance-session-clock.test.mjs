import assert from "node:assert/strict";
import test from "node:test";
import {
  waitForFinanceSessionClock,
  createFinanceBrowserSessionClock,
} from "./admin-finance-session-clock.mjs";

test("route uninstall error cannot replace an earlier route failure", async () => {
  let handler;
  const original = new Error("original route failure"),
    secondary = new Error("uninstall failure");
  const page = {
    on: () => {},
    off: () => {},
    route: async (_pattern, fn) => {
      handler = fn;
    },
    unroute: async () => {
      throw secondary;
    },
  };
  const gate = createFinanceBrowserSessionClock({
    client: { query: async () => assert.fail("not issued") },
    tokenPepper: "d".repeat(64),
    check: assert.ok,
  });
  const release = await gate.install(page);
  await handler({
    request: () => ({ method: () => "GET" }),
    continue: async () => {
      throw original;
    },
    abort: async () => {},
  });
  await assert.rejects(release(), (error) => error === original);
});

test("scope cleanup also drains an already dispatched handler arriving while uninstall awaits", async () => {
  let handler,
    finishLate,
    finished = false;
  const page = {
    on: () => {},
    off: () => {},
    route: async (_pattern, fn) => {
      handler = fn;
    },
    unroute: async () => {
      void handler({
        request: () => ({ method: () => "GET" }),
        continue: () =>
          new Promise((resolve) => {
            finishLate = resolve;
          }),
        abort: async () => assert.fail("no failure"),
      });
    },
  };
  const gate = createFinanceBrowserSessionClock({
    client: { query: async () => assert.fail("not issued") },
    tokenPepper: "d".repeat(64),
    check: assert.ok,
  });
  const release = await gate.install(page);
  const released = release().then(() => {
    finished = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(finished, false, "cleanup must own late in-flight work");
  finishLate();
  await released;
  assert.equal(finished, true);
});

test("authentication scope drains a pending real route handler before removal and preserves its first error", async () => {
  let handler,
    resolveContinue,
    unrouted = false,
    continued = 0,
    aborted = 0;
  const first = new Error("first route failure");
  const page = {
    on: () => {},
    off: () => {},
    route: async (_pattern, fn) => {
      handler = fn;
    },
    unroute: async () => {
      unrouted = true;
    },
  };
  const gate = createFinanceBrowserSessionClock({
    client: { query: async () => assert.fail("no callback cannot query") },
    tokenPepper: "d".repeat(64),
    check: assert.ok,
  });
  const release = await gate.install(page);
  const work = handler({
    request: () => ({ method: () => "GET" }),
    continue: () => {
      continued++;
      return new Promise((_resolve, reject) => {
        resolveContinue = () => reject(first);
      });
    },
    abort: async () => {
      aborted++;
      throw new Error("secondary abort failure");
    },
  });
  const released = release();
  let releaseFinished = false;
  void released.then(
    () => {
      releaseFinished = true;
    },
    () => {
      releaseFinished = true;
    },
  );
  await Promise.resolve();
  assert.equal(unrouted, false);
  assert.equal(releaseFinished, false);
  resolveContinue();
  await work;
  await assert.rejects(released, (error) => error === first);
  assert.equal(continued, 1);
  assert.equal(aborted, 1);
  assert.equal(unrouted, true);
});

test("a read that completes past the six-second bound cannot authorize readiness", async () => {
  let elapsed = 0;
  await assert.rejects(
    waitForFinanceSessionClock({
      read: async () => {
        elapsed = 6001;
        return { eligible: true, postgresReady: true, nodeReady: true };
      },
      now: () => elapsed,
      delay: async () => {},
    }),
    /TEST session clock did not become ready/u,
  );
});

test("browser readiness belongs only to the current successful callback's first GET and is removed afterward", async () => {
  let listener,
    handler,
    queries = 0,
    forwarded = 0;
  const issuedSession = "a".repeat(42) + "A",
    issuedCsrf = "b".repeat(42) + "E",
    other = "c".repeat(42) + "I";
  const page = {
    on: (_event, fn) => {
      listener = fn;
    },
    off: (_event, fn) => {
      assert.equal(fn, listener);
      listener = null;
    },
    route: async (_pattern, fn) => {
      handler = fn;
    },
    unroute: async (_pattern, fn) => {
      assert.equal(fn, handler);
      handler = null;
    },
  };
  const gate = createFinanceBrowserSessionClock({
    client: {
      query: async () => {
        queries++;
        return {
          rows: [{ eligible: true, postgres_ready: true, node_ready: true }],
        };
      },
    },
    tokenPepper: "d".repeat(64),
    check: assert.ok,
  });
  const release = await gate.install(page);
  const request = (method, token = issuedSession) =>
    handler({
      request: () => ({
        method: () => method,
        allHeaders: async () => ({
          cookie: `__Host-fan-admin-session=${token}; __Host-fan-admin-csrf=${issuedCsrf}`,
        }),
      }),
      continue: async () => {
        forwarded++;
      },
      abort: async () => assert.fail("ready request cannot be aborted"),
    });
  await request("GET");
  assert.equal(queries, 0, "existing credential before callback is untouched");
  listener({
    url: () => "https://admin.example.invalid/api/admin/auth/callback",
    status: () => 303,
    headerValues: async () => [
      `__Host-fan-admin-session=${issuedSession}; Max-Age=3600`,
      `__Host-fan-admin-csrf=${issuedCsrf}; Max-Age=3600`,
    ],
  });
  await request("POST");
  await request("GET", other);
  assert.equal(
    queries,
    0,
    "non-GET and other credential cannot acquire the clock gate",
  );
  await request("GET");
  assert.equal(queries, 1);
  await request("GET");
  assert.equal(
    queries,
    1,
    "later future-session negative tests retain the ordinary server boundary",
  );
  assert.equal(forwarded, 5);
  await release();
  assert.equal(handler, null);
  assert.equal(listener, null);
});

test("TEST session readiness waits through a real-clock regression without authorizing the request", async () => {
  let elapsed = 0,
    reads = 0;
  const samples = [
    { eligible: true, postgresReady: false, nodeReady: true },
    { eligible: true, postgresReady: true, nodeReady: false },
    { eligible: true, postgresReady: false, nodeReady: true },
    { eligible: true, postgresReady: true, nodeReady: true },
  ];
  const result = await waitForFinanceSessionClock({
    read: async () => samples[reads++],
    now: () => elapsed,
    delay: async (value) => {
      elapsed += value;
    },
  });
  assert.equal(result, "READY");
  assert.equal(reads, 4);
  assert.equal(elapsed, 75);
});

test("unknown, expired, revoked, inactive, non-MFA or mismatched-CSRF session is never waited or repaired", async () => {
  for (const reason of [
    "UNKNOWN",
    "EXPIRED",
    "REVOKED",
    "INACTIVE",
    "NON_MFA",
    "CSRF_MISMATCH",
  ]) {
    let waits = 0;
    assert.equal(
      await waitForFinanceSessionClock({
        read: async () => ({ eligible: false, reason }),
        now: () => 0,
        delay: async () => {
          waits++;
        },
      }),
      "PASSTHROUGH",
    );
    assert.equal(waits, 0);
  }
});

test("TEST readiness has a monotonic bound and cannot permit a persistent future session", async () => {
  let elapsed = 0;
  await assert.rejects(
    waitForFinanceSessionClock({
      read: async () => ({
        eligible: true,
        postgresReady: false,
        nodeReady: false,
      }),
      now: () => elapsed,
      delay: async (value) => {
        elapsed += value;
      },
    }),
    /TEST session clock did not become ready/u,
  );
  assert.equal(elapsed, 6000);
});

test("revocation while waiting immediately leaves the original authorization boundary in control", async () => {
  let elapsed = 0,
    reads = 0;
  assert.equal(
    await waitForFinanceSessionClock({
      read: async () =>
        ++reads === 1
          ? { eligible: true, postgresReady: false, nodeReady: false }
          : { eligible: false },
      now: () => elapsed,
      delay: async (value) => {
        elapsed += value;
      },
    }),
    "PASSTHROUGH",
  );
  assert.equal(elapsed, 25);
});
