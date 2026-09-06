import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

async function loadChecker() {
  const checker = await import("./check-ui-motion-device.mjs").catch(
    () => ({}),
  );
  assert.equal(typeof checker.createDeviceCapabilities, "function");
  assert.equal(typeof checker.assessDeviceSession, "function");
  return checker;
}

test("requests only the explicitly selected physical iPhone", async () => {
  const { createDeviceCapabilities } = await loadChecker();
  assert.deepEqual(createDeviceCapabilities("test-device"), {
    capabilities: {
      alwaysMatch: {
        browserName: "Safari",
        platformName: "iOS",
        "safari:useSimulator": false,
        "safari:deviceType": "iPhone",
        "safari:deviceUDID": "test-device",
      },
    },
  });
  for (const value of [undefined, "", " "]) {
    assert.throws(() => createDeviceCapabilities(value));
  }
});

test("missing inspector produces an actionable blocker without device identifiers", async () => {
  const { assessDeviceSession } = await loadChecker();
  const result = assessDeviceSession({
    value: {
      error: "session not created",
      message:
        "Private phone (PRIVATE-UDID): Web Inspector is not enabled on device",
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "web-inspector-disabled");
  assert.equal(JSON.stringify(result).includes("PRIVATE-UDID"), false);
});

test("remote automation and locked-device failures remain blocked", async () => {
  const { assessDeviceSession } = await loadChecker();
  for (const [message, reason] of [
    ["Remote Automation is not enabled", "remote-automation-disabled"],
    ["Device is locked", "device-locked"],
    ["No matching devices found", "session-unavailable"],
  ]) {
    assert.deepEqual(
      assessDeviceSession({ value: { error: "session not created", message } }),
      {
        status: "blocked",
        reason,
      },
    );
  }
});

test("a valid iOS session is readiness only, never motion acceptance", async () => {
  const { assessDeviceSession } = await loadChecker();
  assert.deepEqual(
    assessDeviceSession({
      value: {
        sessionId: "private-session",
        capabilities: {
          browserName: "Safari",
          platformName: "iOS",
          browserVersion: "26.5",
        },
      },
    }),
    {
      status: "ready-for-recording",
      browser: "Safari",
      platform: "iOS",
      browserVersion: "26.5",
    },
  );
});

test("malformed, desktop, and simulator responses cannot become ready", async () => {
  const { assessDeviceSession } = await loadChecker();
  for (const response of [
    null,
    {},
    { value: {} },
    {
      value: {
        sessionId: "id",
        capabilities: { browserName: "Safari", platformName: "macOS" },
      },
    },
    {
      value: {
        sessionId: "id",
        capabilities: {
          browserName: "Safari",
          platformName: "iOS",
          "safari:useSimulator": true,
        },
      },
    },
  ]) {
    assert.equal(assessDeviceSession(response).status, "blocked");
  }
});

test("CLI fails closed on HTTP errors and malformed capabilities while closing its session", async () => {
  for (const candidate of [
    {
      status: 500,
      sessionId: "test-session",
      browserName: "Safari",
      cleanup: "/session/test-session",
    },
    {
      status: 200,
      sessionId: "test-session",
      browserName: 123,
      cleanup: "/session/test-session",
    },
    { status: 200, sessionId: "..", browserName: "Safari", cleanup: undefined },
  ]) {
    const requests = [];
    const server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      res.writeHead(req.method === "POST" ? candidate.status : 200, {
        "content-type": "application/json",
      });
      res.end(
        JSON.stringify({
          value:
            req.method === "POST"
              ? {
                  sessionId: candidate.sessionId,
                  capabilities: {
                    browserName: candidate.browserName,
                    platformName: "iOS",
                  },
                }
              : null,
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const child = spawn(
        process.execPath,
        ["scripts/check-ui-motion-device.mjs"],
        {
          env: {
            ...process.env,
            FAN_SUPPORT_DEVICE_UDID: "PRIVATE-DEVICE",
            FAN_SUPPORT_WEBDRIVER_ORIGIN: `http://127.0.0.1:${server.address().port}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const [code] = await once(child, "close");
      assert.equal(code, 1);
      assert.equal(output.includes("PRIVATE-DEVICE"), false);
      assert.deepEqual(requests, [
        "POST /session",
        ...(candidate.cleanup ? [`DELETE ${candidate.cleanup}`] : []),
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
