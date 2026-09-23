import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";

async function bounded(action, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_, reject) => {
        timer = globalThis.setTimeout(
          () => reject(new Error(message)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/** Kept separate so partial startup, disconnect failures, and cleanup are failure-tested. */
export async function runOwnedRumBrowser(
  launcher,
  { connect, verify, removeProfile, timeoutMs = 5_000 },
) {
  const errors = [];
  let browser, result;
  try {
    // The Launcher exists before launch: a spawn followed by readiness failure remains owned.
    await launcher.launch();
    browser = await connect(launcher.port);
    assert.equal(browser.contexts().length, 1);
    result = await verify(browser.contexts()[0], browser);
  } catch (error) {
    errors.push(error);
  } finally {
    const child = launcher.chromeProcess;
    if (browser) {
      try {
        await bounded(
          () => browser.close(),
          timeoutMs,
          "Owned browser disconnect timed out",
        );
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      launcher.kill();
    } catch (error) {
      errors.push(error);
    }
    let stopped = !child;
    if (child) {
      const deadline = globalThis.performance.now() + timeoutMs;
      while (
        child.exitCode === null &&
        child.signalCode === null &&
        globalThis.performance.now() < deadline
      )
        await delay(10);
      stopped = child.exitCode !== null || child.signalCode !== null;
      if (!stopped)
        errors.push(
          new Error("Owned Chrome did not exit; owned profile retained"),
        );
    }
    // Never remove a profile belonging to a process whose exit was not confirmed.
    if (stopped) {
      try {
        await removeProfile();
      } catch (error) {
        errors.push(error);
      }
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length)
    throw new AggregateError(errors, "Owned RUM browser or cleanup failed");
  return result;
}

/** Each call owns a new Chrome process and profile, including its default context. */
export async function withNativeRumContext({ gateway }, verify) {
  const require = createRequire(import.meta.url);
  const lighthouseRequire = createRequire(require.resolve("lighthouse"));
  const { Launcher, getChromePath } = await import(
    lighthouseRequire.resolve("chrome-launcher")
  );
  const configuredChrome = process.env.FAN_SUPPORT_GOOGLE_CHROME_PATH?.trim();
  const chromePath = configuredChrome || getChromePath();
  const chromeFlags = [
    "--headless=new",
    "--enable-automation",
    "--no-proxy-server",
  ];
  if (gateway) {
    const certificate = new X509Certificate(
      await readFile(gateway.certificatePath),
    );
    const pin = createHash("sha256")
      .update(certificate.publicKey.export({ type: "spki", format: "der" }))
      .digest("base64");
    chromeFlags.push(
      `--ignore-certificate-errors-spki-list=${pin}`,
      "--host-resolver-rules=MAP media.example.invalid 127.0.0.1",
    );
  }
  const profile = await mkdtemp(path.join(tmpdir(), "fan-support-rum-"));
  let launcher;
  try {
    launcher = new Launcher({
      chromePath,
      userDataDir: profile,
      handleSIGINT: false,
      logLevel: "silent",
      chromeFlags,
    });
  } catch (error) {
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
  return runOwnedRumBrowser(launcher, {
    // noDefaults applies only to this fresh owned default context, not newContext().
    connect: (port) =>
      chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true }),
    verify: (context, browser) =>
      verify(context, browser, {
        executableSelection: configuredChrome
          ? "FAN_SUPPORT_GOOGLE_CHROME_PATH"
          : "INSTALLED_CHROME_DISCOVERY",
        chromeFlags,
        noDefaults: true,
        freshOwnedProfile: true,
        defaultContext: true,
      }),
    removeProfile: () => rm(profile, { recursive: true, force: true }),
  });
}

export function assertNativeHiddenEvidence(evidence) {
  assert.equal(evidence.before, "visible");
  assert.equal(evidence.after, "hidden");
  assert.equal(evidence.sameDocument, true);
  assert.equal(evidence.sameUrl, true);
  assert.equal(evidence.sameTimeOrigin, true);
  assert.ok(
    evidence.events.some((event) => event.state === "hidden" && event.trusted),
  );
  assert.ok(evidence.events.every((event) => event.trusted));
}

/** Observe a genuine Chrome tab switch while the sampled document remains alive. */
export async function hideRumDocument(page) {
  const observed = await page.evaluateHandle(() => {
    const state = {
      document: globalThis.document,
      url: globalThis.location.href,
      timeOrigin: globalThis.performance.timeOrigin,
      before: globalThis.document.visibilityState,
      events: [],
    };
    globalThis.document.addEventListener("visibilitychange", (event) => {
      if (state.events.length < 8)
        state.events.push({
          state: globalThis.document.visibilityState,
          trusted: event.isTrusted,
        });
    });
    return state;
  });
  try {
    const foreground = await page.context().newPage();
    await foreground.bringToFront();
    await expect
      .poll(() => page.evaluate(() => globalThis.document.visibilityState), {
        timeout: 5_000,
      })
      .toBe("hidden");
    const evidence = await observed.evaluate((state) => ({
      before: state.before,
      after: globalThis.document.visibilityState,
      sameDocument: state.document === globalThis.document,
      sameUrl: state.url === globalThis.location.href,
      sameTimeOrigin: state.timeOrigin === globalThis.performance.timeOrigin,
      events: state.events,
    }));
    assertNativeHiddenEvidence(evidence);
    return evidence;
  } finally {
    await observed.dispose();
  }
}
