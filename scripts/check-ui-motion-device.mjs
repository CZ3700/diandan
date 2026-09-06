/* global AbortSignal, fetch */

import { URL, pathToFileURL } from "node:url";

export function createDeviceCapabilities(deviceId) {
  if (typeof deviceId !== "string" || deviceId.trim().length === 0) {
    throw new Error(
      "FAN_SUPPORT_DEVICE_UDID must select a paired physical iPhone",
    );
  }
  return {
    capabilities: {
      alwaysMatch: {
        browserName: "Safari",
        platformName: "iOS",
        "safari:useSimulator": false,
        "safari:deviceType": "iPhone",
        "safari:deviceUDID": deviceId,
      },
    },
  };
}

export function assessDeviceSession(response) {
  const value = response?.value;
  if (typeof value?.error === "string") {
    const message = String(value.message).toLowerCase();
    const reason = message.includes("web inspector is not enabled")
      ? "web-inspector-disabled"
      : message.includes("remote automation")
        ? "remote-automation-disabled"
        : message.includes("locked")
          ? "device-locked"
          : "session-unavailable";
    return { status: "blocked", reason };
  }
  const capabilities = value?.capabilities;
  if (
    !isSessionId(value?.sessionId) ||
    typeof capabilities?.browserName !== "string" ||
    capabilities.browserName.toLowerCase() !== "safari" ||
    typeof capabilities?.platformName !== "string" ||
    capabilities.platformName.toLowerCase() !== "ios" ||
    capabilities?.["safari:useSimulator"] === true
  ) {
    return { status: "blocked", reason: "invalid-device-session" };
  }
  return {
    status: "ready-for-recording",
    browser: "Safari",
    platform: "iOS",
    browserVersion: String(capabilities.browserVersion ?? "unknown"),
  };
}

function isSessionId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]+$/u.test(value);
}

async function main() {
  const origin = new URL(process.env.FAN_SUPPORT_WEBDRIVER_ORIGIN);
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new Error(
      "FAN_SUPPORT_WEBDRIVER_ORIGIN must be a loopback HTTP origin",
    );
  }
  const response = await fetch(new URL("session", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      createDeviceCapabilities(process.env.FAN_SUPPORT_DEVICE_UDID),
    ),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json();
  const sessionId = body?.value?.sessionId;
  let result;
  let cleanupFailed = false;
  try {
    result = response.ok
      ? assessDeviceSession(body)
      : {
          status: "blocked",
          reason: assessDeviceSession(body).reason ?? "driver-http-error",
        };
  } finally {
    if (isSessionId(sessionId)) {
      const cleanup = await fetch(
        new URL(`session/${encodeURIComponent(sessionId)}`, origin),
        { method: "DELETE", signal: AbortSignal.timeout(10_000) },
      );
      cleanupFailed = !cleanup.ok;
    }
  }
  if (cleanupFailed) {
    throw new Error(
      "The check could not close its temporary WebDriver session",
    );
  }
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        checkedAt: new Date().toISOString(),
        ...result,
        motionAccepted: false,
      },
      null,
      2,
    ),
  );
  process.exitCode = result.status === "ready-for-recording" ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      "Device preflight failed; check the local driver and paired iPhone. No motion acceptance was recorded.",
    );
    process.exitCode = 1;
  });
}
