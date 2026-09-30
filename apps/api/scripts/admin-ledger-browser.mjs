#!/usr/bin/env node
// ADR-022 / L3-12: the artist ledger in a real browser, on real PostgreSQL and the production API composition.
// Orders are replica-seeded (no checkout ran); fan messages are encrypted with this instance's own key service,
// so revealing one goes through the application's real decryption. Usage (after building the API):
//   node scripts/admin-ledger-browser.mjs [--compiled]
import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { createLedgerSeeder } from "../../../packages/persistence-postgres/scripts/artist-ledger-fixture.mjs";
import { runLocalAccountBrowserAcceptance } from "./admin-local-browser-harness.mjs";

const bytes = (value) =>
  Buffer.from(value.slice("enc:v1:".length), "base64url");
/** Calendar parts of an instant in Beijing time. */
const beijing = (date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
/** Stored ZIP entries of an .xlsx, by name. */
function unzip(file) {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const entries = {};
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true),
      nameLength = view.getUint16(offset + 26, true),
      extra = view.getUint16(offset + 28, true);
    const name = file
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString("utf8");
    const start = offset + 30 + nameLength + extra;
    entries[name] = file.subarray(start, start + size).toString("utf8");
    offset = start + size;
  }
  return entries;
}

await runLocalAccountBrowserAcceptance(
  "ledger-browser",
  async (t) => {
    const {
      check,
      secret,
      stage,
      api,
      as,
      signIn,
      open,
      audit,
      fitsWidth,
      shot,
      client,
      keys,
    } = t;
    const owner = await signIn("studio.owner", t.ownerPassword);
    async function staff(loginName, displayName, role) {
      const created = (
        await api(
          "staff/create",
          { loginName, displayName, roleKeys: [role] },
          as(owner),
        )
      ).data;
      check(
        created.kind === "STAFF_CREATED",
        `${loginName} created as ${role}`,
      );
      const started = await signIn(
        loginName,
        secret(created.temporaryPassword),
      );
      const done = await t.access("step", {
        challengeToken: started.challengeToken,
        step: {
          kind: "NEW_PASSWORD",
          newPassword: secret(
            `${loginName} ${randomBytes(9).toString("base64url")}`,
          ),
        },
      });
      secret(done.sessionToken);
      secret(done.csrfToken);
      return done;
    }

    stage("seed");
    const mina = await staff("mina.park", "Mina Park", "studio:broker");
    const rui = await staff("rui.tanaka", "Rui Tanaka", "studio:broker");
    const identity = async (login) =>
      (
        await client.query(
          "SELECT admin_identity_id id FROM admin_local_accounts WHERE login_name=$1",
          [login],
        )
      ).rows[0].id;
    const ownerId = await identity("studio.owner"),
      minaId = await identity("mina.park"),
      ruiId = await identity("rui.tanaka");
    const ownerSession = (
      await client.query(
        "SELECT id FROM admin_sessions WHERE admin_identity_id=$1 ORDER BY created_at DESC LIMIT 1",
        [ownerId],
      )
    ).rows[0].id;
    const seeder = createLedgerSeeder(client, {
      actor: { actorId: ownerId, sessionId: ownerSession },
      reviewer: ownerId,
      async encrypt(intentId, { text, name }) {
        const result = await keys.encryptEnvelopeFields({
          schemaVersion: 1,
          operation: "ENCRYPT_ENVELOPE_FIELDS",
          subjectId: intentId,
          fields: [
            {
              purpose: "SUPPORT_INTENT_MESSAGE",
              plaintextBase64: Buffer.from(text).toString("base64url"),
            },
            {
              purpose: "SUPPORT_INTENT_DISPLAY_NAME",
              plaintextBase64: Buffer.from(name).toString("base64url"),
            },
          ],
        });
        const field = (purpose) =>
          result.value.fields.find((entry) => entry.purpose === purpose)
            .ciphertext;
        return {
          fanMessageCiphertext: bytes(field("SUPPORT_INTENT_MESSAGE")),
          displayNameCiphertext: bytes(field("SUPPORT_INTENT_DISPLAY_NAME")),
          encryptedDataKey: bytes(result.value.encryptedDataKey),
          keyVersion: result.value.keyVersion,
        };
      },
    });
    const now = Date.now();
    const recent = new Date(now - 5 * 60_000).toISOString();
    const today = beijing(new Date(now));
    // Noon Beijing time on the 2nd of the previous month.
    const previous = new Date(
      Date.UTC(today.year, today.month - 2, 2, 4),
    ).toISOString();
    const artists = {};
    await seeder.seed(async () => {
      for (const handle of ["aria-moon", "bella-star", "coco-rain", "dora-sky"])
        artists[handle] = await seeder.artist(handle);
      await seeder.assign(artists["aria-moon"], minaId);
      await seeder.assign(artists["bella-star"], minaId);
      await seeder.assign(artists["coco-rain"], ruiId);
      const line = (key, handle, rest) => ({
        key,
        artistId: artists[handle],
        qty: 1,
        ...rest,
      });
      await seeder.order({
        paidAt: recent,
        lines: [
          line("L1", "aria-moon", {
            qty: 2,
            unit: 1250,
            status: "DELIVERED",
            title: "Moonlight bouquet",
            message: {
              moderation: "APPROVED",
              locale: "ja",
              text: "お誕生日おめでとう！",
              name: "Hana",
            },
          }),
          line("L2", "aria-moon", {
            unit: 1000,
            status: "DELIVERED",
            kind: "VIRTUAL",
            title: "Star cheer",
          }),
          line("L3", "coco-rain", {
            unit: 3000,
            status: "PREPARING",
            title: "Stage flowers",
            message: {
              moderation: "REJECTED",
              locale: "en",
              text: "Withheld text",
              name: "Nope",
            },
          }),
        ],
        refunds: [{ status: "SUCCEEDED", items: [["L1", 500]] }],
      });
      await seeder.order({
        paidAt: recent,
        lines: [
          line("L4", "aria-moon", {
            unit: 4000,
            status: "ON_HOLD",
            title: "Concert banner",
            message: {
              moderation: "PENDING",
              locale: "en",
              text: "Can't wait for the concert",
              name: "Kai",
            },
          }),
          line("L5", "bella-star", {
            unit: 1500,
            status: "PENDING",
            title: "Plush bear",
          }),
        ],
        refunds: [
          { status: "PROCESSING", items: [["L4", 1000]] },
          { status: "SUCCEEDED", items: [["L5", 1500]] },
        ],
      });
      await seeder.order({
        currency: "JPY",
        paidAt: recent,
        lines: [
          line("L6", "aria-moon", {
            unit: 3000,
            status: "DELIVERED",
            kind: "VIRTUAL",
            title: "Light stick",
          }),
        ],
      });
      await seeder.order({
        environment: "TEST",
        paidAt: recent,
        lines: [
          line("L7", "aria-moon", {
            unit: 700,
            status: "DELIVERED",
            title: "Test gift",
          }),
        ],
      });
      await seeder.order({
        paidAt: recent,
        dispute: "LOST",
        lines: [
          line("L8", "bella-star", {
            unit: 2000,
            status: "DELIVERED",
            title: "Photo book",
          }),
          line("L9", "dora-sky", {
            unit: 500,
            status: "DELIVERED",
            kind: "VIRTUAL",
            title: "Sparkle",
          }),
        ],
        refunds: [{ status: "SUCCEEDED", items: [["L8", 200]] }],
      });
      await seeder.order({
        paidAt: previous,
        lines: [
          line("L10", "aria-moon", {
            unit: 900,
            status: "DELIVERED",
            title: "Last month gift",
          }),
        ],
      });
      await seeder.order({
        state: "UNPAID",
        paidAt: recent,
        lines: [line("L11", "aria-moon", { unit: 1000, title: "Unpaid gift" })],
      });
    });
    const items = seeder.items;
    const reads = async (actorId) =>
      Number(
        (
          await client.query(
            "SELECT count(*) n FROM audit_logs WHERE actor_id=$1 AND action='ORDER_PRIVATE_READ'",
            [actorId],
          )
        ).rows[0].n,
      );
    const exports = async (actorId) =>
      (
        await client.query(
          "SELECT scope,broker_identity_id,line_count FROM artist_ledger_exports WHERE actor_id=$1 ORDER BY created_at",
          [actorId],
        )
      ).rows;

    // ---------- The studio: orders area → artist ledger ----------
    async function openLedger(
      locale,
      viewport,
      session,
      { broker = false, reducedMotion } = {},
    ) {
      const opened = await open(locale, viewport, {
        session,
        ...(reducedMotion ? { reducedMotion } : {}),
      });
      const { page } = opened;
      try {
        await page
          .locator("[data-management-section]")
          .first()
          .waitFor({ timeout: 180_000 });
      } catch (error) {
        await shot(page, `stuck-${locale}-${viewport}`).catch(() => undefined);
        const body = await page
          .locator("body")
          .innerText()
          .catch(() => "");
        throw new Error(
          `${error.message.split("\n")[0]} | page errors: ${opened.errors.join(" / ")} | body: ${body.slice(0, 300)}`,
          { cause: error },
        );
      }
      if (broker)
        await page.locator('[data-management-section="LEDGER"]').click();
      else {
        await page.locator('[data-management-section="ORDERS"]').click();
        await page.locator("[data-ledger-navigation]").click();
      }
      await page
        .locator("[data-ledger-workspace]:not([aria-busy='true'])")
        .waitFor({ timeout: 120_000 });
      return opened;
    }
    const settle = (page) =>
      page
        .locator("[data-ledger-workspace]:not([aria-busy='true'])")
        .waitFor({ timeout: 60_000 });
    /** Runs an action that reloads the ledger and waits for that read to answer and render; no stale reads. */
    const act = async (page, action) => {
      const answered = page.waitForResponse(
        (response) =>
          /\/api\/admin\/ledger-(overview|artist)$/u.test(
            new URL(response.url()).pathname,
          ),
        { timeout: 120_000 },
      );
      await action();
      await answered;
      await settle(page);
    };

    stage("studio overview");
    {
      const { page, context, errors } = await openLedger(
        "en",
        "desktop",
        owner,
      );
      const text = async (selector) =>
        (await page.locator(selector).innerText()).replaceAll(/\s+/gu, " ");
      const usd = await text('[data-ledger-total="LIVE-USD"]');
      check(
        usd.includes("$30.00") &&
          usd.includes("$70.00") &&
          usd.includes("$45.00") &&
          usd.includes("$100.00"),
        "LIVE USD totals: completed, pending, refunded, net",
      );
      check(
        usd.includes("1 orders") &&
          usd.includes("2 orders") &&
          usd.includes("$10.00"),
        "orders counted once; refund in progress shown apart",
      );
      check(
        (await text('[data-ledger-total="LIVE-JPY"]')).includes("¥3,000"),
        "JPY totalled apart",
      );
      check(
        (await text('[data-ledger-total="TEST-USD"]')).includes("Test"),
        "TEST payments labelled and apart",
      );
      const rows = async () =>
        page.locator("[data-ledger-artists] tbody tr").count();
      check(
        (await rows()) === 6,
        "one row per artist, currency and payment type",
      );
      check(
        (await text("[data-ledger-artists]")).includes("Mina Park") &&
          (await text("[data-ledger-artists]")).includes("Unassigned"),
        "rows show the current broker",
      );
      check(
        !(await text("[data-ledger-artists]")).includes("Unpaid gift"),
        "unpaid orders are not counted",
      );
      await act(page, () =>
        page
          .locator("[data-ledger-broker-filter]")
          .selectOption({ label: "Mina Park" }),
      );
      const handles = async () =>
        (await page.locator("[data-ledger-open-artist]").allInnerTexts()).map(
          (v) => v.trim(),
        );
      check(
        [...new Set(await handles())].sort().join() === "aria-moon,bella-star",
        "filtering by broker keeps that broker's artists",
      );
      check(
        (await text("[data-ledger-export-scope]")).includes(
          "All artists of Mina Park",
        ),
        "the export names the filtered broker",
      );
      await act(page, () =>
        page.locator("[data-ledger-broker-filter]").selectOption("ALL"),
      );
      await page.locator("[data-ledger-search]").fill("coco");
      check(
        (await handles()).join() === "coco-rain",
        "searching narrows the rows",
      );
      await page.locator("[data-ledger-search]").fill("");
      // Keyboard: last month, then back to this month.
      await page.locator('[data-ledger-preset="LAST_MONTH"]').focus();
      await act(page, () => page.keyboard.press("Enter"));
      check(
        (await handles()).join() === "aria-moon" && (await rows()) === 1,
        "last month holds only last month's gift",
      );
      await page.locator('[data-ledger-preset="THIS_MONTH"]').focus();
      await act(page, () => page.keyboard.press("Enter"));
      await page.locator('[data-ledger-preset="CUSTOM"]').click();
      const day = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
      await page.locator("[data-ledger-from]").fill(day);
      await page.locator("[data-ledger-to]").fill(day);
      await act(page, () => page.locator("[data-ledger-apply]").click());
      check((await rows()) === 6, "a custom single day shows today's gifts");
      check(
        (await text("[data-ledger-period-text]")).includes("UTC+8"),
        "the period names Beijing time",
      );
      // The artist view, by keyboard.
      await page
        .locator(`[data-ledger-open-artist="${artists["aria-moon"]}"]`)
        .first()
        .focus();
      await act(page, () => page.keyboard.press("Enter"));
      check(
        await page.evaluate(
          () =>
            globalThis.document.activeElement?.hasAttribute(
              "data-ledger-heading",
            ) ?? false,
        ),
        "the artist heading takes focus",
      );
      const pending = await text('[data-ledger-lines="PENDING"]'),
        completed = await text('[data-ledger-lines="COMPLETED"]');
      check(
        pending.includes("Concert banner") &&
          pending.includes("On hold") &&
          pending.includes("$10.00"),
        "pending lists the held gift with its refund in progress",
      );
      check(
        completed.includes("Moonlight bouquet") &&
          completed.includes("$20.00") &&
          completed.includes("Star cheer"),
        "completed lists delivered gifts net of refunds",
      );
      await page.locator(`[data-ledger-message="${items.L1.item}"]`).click();
      await page.locator('.ml-message-action [role="alert"]').waitFor();
      check(
        (await text(".ml-message-action [role='alert']")).includes(
          "not allowed to open messages in this language",
        ),
        "without a review-language grant the studio gets the orders rule, not the message",
      );
      const download = page.waitForEvent("download");
      await page.locator("[data-ledger-export]").click();
      const file = await download;
      const saved = `${t.output}/owner-aria-moon.xlsx`;
      await file.saveAs(saved);
      const sheets = unzip(await readFile(saved));
      check(
        file.suggestedFilename().endsWith(".xlsx") &&
          Object.keys(sheets).includes("xl/worksheets/sheet2.xml"),
        "the export downloads an .xlsx with two sheets",
      );
      check(
        sheets["xl/worksheets/sheet2.xml"].includes("Moonlight bouquet") &&
          !sheets["xl/worksheets/sheet2.xml"].includes("Hana"),
        "the details list gifts and never fan names or messages",
      );
      check(
        !Object.values(sheets).join("").includes("お誕生日"),
        "no message text anywhere in the file",
      );
      check(
        (await exports(ownerId)).at(-1)?.scope === "ARTIST",
        "the export left an ARTIST receipt",
      );
      await act(page, () => page.locator("[data-ledger-back]").click());
      const all = page.waitForEvent("download");
      await page.locator("[data-ledger-export]").click();
      await (await all).saveAs(`${t.output}/owner-all.xlsx`);
      check(
        (await exports(ownerId)).at(-1)?.scope === "ALL",
        "the overview export is the global scope",
      );
      await shot(page, "studio-overview-en-desktop");
      check(errors.length === 0, "no page errors for the studio");
      await context.close();
    }

    stage("broker");
    {
      const { page, context, errors } = await openLedger(
        "zh-CN",
        "phone",
        mina,
        { broker: true },
      );
      const sections = (
        await page
          .locator("[data-management-section]")
          .evaluateAll((nodes) =>
            nodes.map((n) => n.getAttribute("data-management-section")),
          )
      ).sort();
      check(
        sections.join() === "ACCOUNT,ARTISTS,LEDGER",
        "a broker's sidebar is artists, ledger and account settings",
      );
      check(
        (await page.locator("[data-ledger-broker-filter]").count()) === 0,
        "a broker has no broker filter",
      );
      const handles = [
        ...new Set(
          (await page.locator("[data-ledger-open-artist]").allInnerTexts()).map(
            (v) => v.trim(),
          ),
        ),
      ].sort();
      check(
        handles.join() === "aria-moon,bella-star",
        "a broker sees only its own artists",
      );
      check(
        (await page.locator("[data-ledger-export-scope]").innerText()).includes(
          "我名下的全部艺人",
        ),
        "a broker exports its own artists",
      );
      await act(page, () =>
        page
          .locator(`[data-ledger-open-artist="${artists["aria-moon"]}"]`)
          .first()
          .click(),
      );
      const before = await reads(minaId);
      await page.locator(`[data-ledger-message="${items.L1.item}"]`).click();
      const shown = page.locator("[data-ledger-message-open]");
      await shown.waitFor();
      const content = await shown.innerText();
      check(
        content.includes("Hana") && content.includes("お誕生日おめでとう！"),
        "the broker reveals the signature and message",
      );
      check((await reads(minaId)) === before + 1, "the reveal wrote one audit");
      const wide = await page.evaluate(() =>
        [...globalThis.document.querySelectorAll("body *")]
          .filter(
            (node) =>
              node.getBoundingClientRect().right >
                globalThis.document.documentElement.clientWidth + 0.5 &&
              !node.closest(".ml-scroll"),
          )
          .slice(0, 8)
          .map(
            (node) =>
              `${node.tagName.toLowerCase()}.${[...node.classList].join(".")}:${Math.round(node.getBoundingClientRect().right)}`,
          ),
      );
      check(
        await fitsWidth(page),
        `no horizontal overflow with a message open on a phone ${wide.join(" ")}`,
      );
      await audit(page, "broker artist zh-CN phone with message open");
      await page.locator("[data-ledger-message-hide]").click();
      check(
        (await page.locator("[data-ledger-message-open]").count()) === 0,
        "hiding removes the text",
      );
      check(
        (await page
          .locator(`[data-ledger-message="${items.L2.item}"]`)
          .count()) === 0,
        "no reveal where there is no message",
      );
      const download = page.waitForEvent("download");
      await act(page, () => page.locator("[data-ledger-back]").click());
      await page.locator("[data-ledger-export]").click();
      await (await download).saveAs(`${t.output}/broker-mine.xlsx`);
      const receipt = (await exports(minaId)).at(-1);
      check(
        receipt?.scope === "BROKER" && receipt.broker_identity_id === minaId,
        "a broker's export is recorded as its own scope",
      );
      await shot(page, "broker-overview-zh-CN-phone");
      check(errors.length === 0, "no page errors for the broker");
      await context.close();
      const other = await openLedger("en", "desktop", rui, { broker: true });
      await act(other.page, () =>
        other.page
          .locator(`[data-ledger-open-artist="${artists["coco-rain"]}"]`)
          .first()
          .click(),
      );
      check(
        (await other.page
          .locator(`[data-ledger-message="${items.L3.item}"]`)
          .count()) === 0,
        "a rejected message offers no reveal to its broker",
      );
      await other.context.close();
    }

    stage("languages");
    const titles = new Set();
    for (const locale of SUPPORTED_LOCALES)
      for (const viewport of ["phone", "desktop"]) {
        for (const [who, session, broker] of [
          ["studio", owner, false],
          ["broker", mina, true],
        ]) {
          const { page, context, errors } = await openLedger(
            locale,
            viewport,
            session,
            { broker },
          );
          titles.add(await page.locator("[data-ledger-heading]").innerText());
          check(
            await fitsWidth(page),
            `${who} ${locale} ${viewport}: overview fits the width`,
          );
          await audit(page, `${who} overview ${locale} ${viewport}`);
          await act(page, () =>
            page
              .locator(`[data-ledger-open-artist="${artists["aria-moon"]}"]`)
              .first()
              .click(),
          );
          check(
            await fitsWidth(page),
            `${who} ${locale} ${viewport}: artist view fits the width`,
          );
          if (who === "studio")
            await audit(page, `studio artist ${locale} ${viewport}`);
          check(
            errors.length === 0,
            `${who} ${locale} ${viewport}: no page errors`,
          );
          await context.close();
        }
      }
    check(
      titles.size >= 6,
      "the title is translated (Spanish and Portuguese share one)",
    );

    stage("reduced motion");
    {
      const { page, context } = await openLedger("en", "desktop", owner, {
        reducedMotion: "reduce",
      });
      const duration = await page
        .locator('[data-ledger-preset="TODAY"]')
        .evaluate(
          (node) => globalThis.getComputedStyle(node).transitionDuration,
        );
      check(
        duration.split(",").every((value) => Number.parseFloat(value) === 0),
        "no transitions under reduced motion",
      );
      await context.close();
    }
  },
  { item: "l3-12" },
);
