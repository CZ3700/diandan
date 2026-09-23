import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import pg from "pg";
import { expect } from "@playwright/test";
import { decryptMailCapture } from "./local-experience-services-mail-store.mjs";
import { verifyGiftPublicationAtomicity } from "./regression-journey-publication-state.mjs";

/** Read-only canonical checks. Plaintext mail is used in memory, never in evidence. */
export function createJourneyState(
  config,
  poolFactory = (options) => new pg.Pool(options),
) {
  const connection = {
    host: "127.0.0.1",
    port: config.ports.postgres,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    options: "-c default_transaction_read_only=on",
    max: 1,
  };
  const pool = poolFactory(connection);
  const providerPool = poolFactory({
    ...connection,
    database: config.services.psp.databaseName,
  });
  const key = Buffer.from(
    config.services.mail.captureEncryptionKey,
    "base64url",
  );
  return {
    publication(giftId) {
      return verifyGiftPublicationAtomicity(pool, giftId);
    },
    async purchase(publicOrderId) {
      const {
        rows: [row],
      } = await pool.query(
        `SELECT cart_id AS "cartId",
        checkout_session_id AS "checkoutId", public_order_id AS "publicOrderId",
        current_payment_attempt_id AS "attemptId", presentation_locale AS locale,
        market, currency, total_amount_minor::integer AS "amountMinor"
        FROM orders WHERE public_order_id=$1`,
        [publicOrderId],
      );
      assert(row, "Canonical order exists");
      return row;
    },
    async notification(publicOrderId, locale, amountMinor, currency) {
      let row;
      await expect
        .poll(
          async () => {
            ({
              rows: [row],
            } = await pool.query(
              `SELECT d.id,d.requested_locale,d.resolved_locale,
          d.fallback_used,d.status,o.created_at
          FROM notification_deliveries d JOIN orders o ON o.id=d.order_id
          WHERE o.public_order_id=$1 AND d.event_type='PAYMENT_CONFIRMED'`,
              [publicOrderId],
            ));
            return row?.status;
          },
          { timeout: 90000, intervals: [500, 1000] },
        )
        .toBe("SENT");
      assert(
        row.requested_locale === locale &&
          row.resolved_locale === locale &&
          !row.fallback_used,
        "Notification preserves the original order language without fallback",
      );
      const {
        rows: [captured],
      } = await providerPool.query(
        "SELECT capture FROM local_experience_mail WHERE notification_id=$1",
        [row.id],
      );
      assert(
        captured,
        "The independent TEST mail service captured the dispatched notification",
      );
      const mail = decryptMailCapture(key, row.id, captured.capture);
      assert(
        mail.content.html.includes(`<html lang="${locale}">`),
        "Actual captured email has the original locale",
      );
      assert(
        mail.content.text.includes(publicOrderId),
        "Captured email binds the actual order",
      );
      const formatter = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
      });
      const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
      const formatted = formatter.format(amountMinor / 10 ** digits);
      assert(
        mail.content.text.includes(formatted),
        "Actual email formats the original amount in the order locale",
      );
      const date =
        new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZone: "UTC",
          calendar: "gregory",
        }).format(row.created_at) + " UTC";
      assert(
        mail.content.text.includes(date),
        "Actual email formats the frozen order date",
      );
      return { subject: mail.content.subject };
    },
    async privateSnapshot(publicOrderId) {
      // Ciphertext remains in process memory and is compared without logging values.
      const { rows } = await pool.query(
        `SELECT row_to_json(s) AS intent, i.idol_id,i.gift_id,i.quantity
        FROM order_items i JOIN orders o ON o.id=i.order_id
        JOIN support_intents s ON s.id=i.support_intent_id WHERE o.public_order_id=$1 ORDER BY i.id`,
        [publicOrderId],
      );
      assert(rows.length > 0, "Order has private support intents");
      return JSON.stringify(rows);
    },
    async close() {
      key.fill(0);
      await Promise.all([pool.end(), providerPool.end()]);
    },
  };
}
