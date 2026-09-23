import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { createJourneyState } from "./regression-journey-state.mjs";
import { encryptMailCapture } from "./local-experience-services-mail-store.mjs";

test("notification verification reads actual captured mail from the separate TEST provider database", async () => {
  const key = Buffer.alloc(32, 4);
  const notificationId = "a0000000-0000-4000-8000-000000000001";
  const publicOrderId = "a0000000-0000-4000-8000-000000000002";
  const created = new Date("2026-09-23T00:00:00Z");
  const date =
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
      calendar: "gregory",
    }).format(created) + " UTC";
  const capture = encryptMailCapture(key, notificationId, {
    content: {
      subject: "Test subject",
      html: '<html lang="en">',
      text: `${publicOrderId}\n$48.00\n${date}`,
    },
  });
  const databases = [],
    closed = [];
  const state = createJourneyState(
    {
      ports: { postgres: 1234 },
      database: {
        user: "local",
        password: "fixture-only",
        database: "business",
      },
      services: {
        psp: { databaseName: "test_provider" },
        mail: { captureEncryptionKey: key.toString("base64url") },
      },
    },
    (options) => {
      databases.push(options.database);
      assert.equal(options.options, "-c default_transaction_read_only=on");
      return {
        async query(sql, parameters) {
          if (options.database === "business") {
            assert(
              !sql.includes("local_experience_mail"),
              "Provider capture cannot be joined inside the business database",
            );
            assert.equal(parameters[0], publicOrderId);
            return {
              rows: [
                {
                  id: notificationId,
                  requested_locale: "en",
                  resolved_locale: "en",
                  fallback_used: false,
                  status: "SENT",
                  created_at: created,
                },
              ],
            };
          }
          assert.equal(options.database, "test_provider");
          assert(sql.includes("local_experience_mail"));
          assert.equal(parameters[0], notificationId);
          return { rows: [{ capture }] };
        },
        async end() {
          closed.push(options.database);
        },
      };
    },
  );
  try {
    assert.deepEqual(
      await state.notification(publicOrderId, "en", 4800, "USD"),
      { subject: "Test subject" },
    );
  } finally {
    await state.close();
  }
  assert.deepEqual(databases.sort(), ["business", "test_provider"]);
  assert.deepEqual(closed.sort(), ["business", "test_provider"]);
});
