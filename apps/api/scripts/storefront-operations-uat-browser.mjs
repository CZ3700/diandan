import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  safeOperationEvidence,
  createOperationsRecorder,
  isOperationsEvidencePath,
} from "./storefront-operations-uat-model.mjs";
import { startOperationsControl } from "./storefront-operations-uat-control.mjs";

/** Opens prepared role contexts only. It never clicks a business operation or a timer. */
export async function openOperationsUat({
  origin,
  credentials,
  fixtures,
  check,
  configPath,
  persist,
}) {
  const admin = new globalThis.URL(origin);
  if (
    admin.protocol !== "http:" ||
    admin.hostname !== "localhost" ||
    admin.pathname !== "/"
  )
    throw new Error("LOCAL_TEST_ORIGIN_REQUIRED");
  const certificate = new X509Certificate(
    await readFile(path.join(path.dirname(configPath), "server.crt")),
  );
  const pin = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: [`--ignore-certificate-errors-spki-list=${pin}`],
  });
  const recorder = createOperationsRecorder();
  let control;
  let evidenceFailed = false;
  const pending = new Set();
  try {
    const pages = {};
    for (const role of ["editor", "reviewer", "manager"]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      });
      await context.addCookies(
        ["session", "csrf"].map((kind) => ({
          name: `__Host-fan-admin-${kind}`,
          value: credentials[role][kind === "session" ? "token" : "csrf"],
          domain: "localhost",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Strict",
        })),
      );
      const page = await context.newPage();
      pages[role] = page;
      await page.goto(`${origin}/zh-CN`, { waitUntil: "domcontentloaded" });
      const session = await page.evaluate(async () => {
        const response = await globalThis.fetch("/api/admin/session", {
          cache: "no-store",
        });
        const value = await response.json();
        return {
          status: response.status,
          authenticated: value.outcome === "SUCCESS",
          permissions: value.permissions ?? [],
          hasCsrf:
            typeof value.csrfToken === "string" && value.csrfToken.length > 0,
        };
      });
      check(
        session.status === 200 && session.authenticated && session.hasCsrf,
        "isolated role window has an actual current TEST session",
      );
      check(
        session.permissions.includes("content.translation.review") ===
          (role !== "editor") &&
          session.permissions.includes("content.publish") ===
            (role === "manager"),
        "role windows preserve edit/review/publication boundaries",
      );
      const cookies = await context.cookies(origin);
      check(
        cookies.length === 2 &&
          cookies.every(
            (cookie) =>
              cookie.secure && cookie.httpOnly && cookie.sameSite === "Strict",
          ),
        "localhost contexts retain Secure HttpOnly Strict cookies without persisting them",
      );
      context.on("response", (response) => {
        const url = new globalThis.URL(response.url());
        if (
          url.origin !== origin ||
          url.search ||
          !isOperationsEvidencePath(url.pathname) ||
          !control
        )
          return;
        const work = response
          .json()
          .then(async (body) => {
            const event = safeOperationEvidence(
              role,
              url.pathname,
              response.status(),
              body,
            );
            if (event) await control.record(event);
          })
          .catch(() => {
            evidenceFailed = true;
          });
        pending.add(work);
        void work.finally(() => pending.delete(work));
      });
    }
    await persist(recorder.snapshot());
    control = await startOperationsControl({
      recorder,
      materials: fixtures.operationsUat,
      persist,
      focus: async (role) => {
        await pages[role].bringToFront();
      },
    });
    const guideContext = await browser.newContext({
      viewport: { width: 1200, height: 900 },
      reducedMotion: "reduce",
    });
    const guide = await guideContext.newPage();
    await guide.goto(control.origin, { waitUntil: "domcontentloaded" });
    check(
      recorder.snapshot().attempts.length === 0,
      "opening prepared windows does not start or complete any human task",
    );
    console.log(`LOCAL_OPERATIONS_UAT_READY ${control.origin}`);
    console.log(
      "PENDING_HUMAN_OPERATIONS_UAT: three isolated role windows and action cards are ready; no timed acceptance has run.",
    );
    return {
      async close() {
        await Promise.all(pending);
        try {
          await control.close();
        } finally {
          await browser.close();
        }
        if (evidenceFailed) throw new Error("OPERATIONS_EVIDENCE_INCOMPLETE");
      },
    };
  } catch (error) {
    try {
      await control?.close();
    } finally {
      await browser.close();
    }
    throw error;
  }
}
