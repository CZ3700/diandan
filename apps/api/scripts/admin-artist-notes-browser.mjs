#!/usr/bin/env node
// ADR-022 / L3-13: private artist notes in a real browser, on real PostgreSQL and the production API composition,
// with this instance's own key service. Artists are replica-seeded without photographs (no object storage here).
// Usage (after building the API): node scripts/admin-artist-notes-browser.mjs [--compiled]
import { randomBytes, randomUUID } from "node:crypto";
import { decodeBase32 } from "@fan-support/application";
import {
  SUPPORTED_LOCALES,
  adminStandardRolePermissions,
} from "@fan-support/contracts";
import {
  freshCode,
  runLocalAccountBrowserAcceptance,
} from "./admin-local-browser-harness.mjs";

const FIRST = {
  realName: "Kim Minji 김민지",
  contact: "+66 81 234 5678\nLINE: minji.k",
  identity: "Passport M12345678",
  other: "Prefers morning calls 🌸",
};
const SECOND = { ...FIRST, contact: "+66 89 765 4321\nIG: @minji.k" };

await runLocalAccountBrowserAcceptance(
  "artist-notes-browser",
  async (t) => {
    const { check, secret, stage, api, as, signIn, open, audit, fitsWidth } = t;
    const shot = t.shot;
    const q = async (text, values = []) =>
      (await t.client.query(text, values)).rows;
    const reads = async () =>
      (
        await q(
          "SELECT count(*)::int n FROM audit_logs WHERE action='ARTIST_PRIVATE_READ' AND field_category='ARTIST_PRIVATE'",
        )
      )[0].n;

    stage("seed");
    const owner = await signIn("studio.owner", t.ownerPassword);
    check(owner.kind === "SESSION_CREATED", "the administrator signs in");
    await t.client.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key=ANY($1::text[]) WHERE r.role_key='studio:operator' ON CONFLICT DO NOTHING",
      [adminStandardRolePermissions("studio:operator")],
    );
    async function staff(loginName, displayName, role) {
      const created = (
        await api(
          "staff/create",
          { loginName, displayName, roleKeys: [role] },
          as(owner),
        )
      ).data;
      check(created.kind === "STAFF_CREATED", `${loginName} created`);
      const started = await signIn(
        loginName,
        secret(created.temporaryPassword),
      );
      const password = secret(
        `${loginName} ${randomBytes(9).toString("base64url")}`,
      );
      const done = await t.access("step", {
        challengeToken: started.challengeToken,
        step: { kind: "NEW_PASSWORD", newPassword: password },
      });
      secret(done.sessionToken);
      secret(done.csrfToken);
      return done;
    }
    const night = await staff("night.shift", "Night Shift", "studio:operator");
    const mina = await staff("mina.park", "Mina Park", "studio:broker");
    const plain = await staff("plain.owner", "Plain Owner", "studio:owner");
    // The administrator turns on TOTP; its current session keeps signing in "without a code".
    const enrollment = (
      await api(
        "account/totp-begin",
        { currentPassword: t.ownerPassword },
        as(owner),
      )
    ).data;
    const key = decodeBase32(secret(enrollment.secret));
    const first = await freshCode(key, -1);
    const enabled = (
      await api("account/totp-confirm", { code: first.code }, as(owner))
    ).data;
    check(enabled.kind === "TOTP_ENABLED", "the administrator turns on TOTP");
    enabled.recoveryCodes.map(secret);
    const challenge = await signIn("studio.owner", t.ownerPassword);
    const second = await freshCode(key, first.step);
    const coded = await t.access("step", {
      challengeToken: challenge.challengeToken,
      step: { kind: "TOTP", code: second.code },
    });
    secret(coded.sessionToken);
    secret(coded.csrfToken);
    check(coded.kind === "SESSION_CREATED", "and signs in again with a code");

    const artists = { aria: randomUUID(), bo: randomUUID() };
    await t.client.query("BEGIN");
    await t.client.query("SET LOCAL session_replication_role=replica");
    for (const [index, [handle, id]] of Object.entries(artists).entries())
      await t.client.query(
        "INSERT INTO idols(id,handle,status,accepting_gifts,version,created_at,updated_at) VALUES($1,$2,'active',true,2,clock_timestamp()-make_interval(mins=>$3),clock_timestamp())",
        [id, `${handle}-notes`, 10 - index],
      );
    await t.client.query("COMMIT");
    const assigned = (
      await api(
        "management/artists/assign",
        {
          schemaVersion: 1,
          artistId: artists.aria,
          brokerId: (
            await q(
              "SELECT admin_identity_id id FROM admin_local_accounts WHERE login_name='mina.park'",
            )
          )[0].id,
          expectedBrokerId: null,
        },
        { ...as(coded), "idempotency-key": `l3-13-${randomUUID()}` },
      )
    ).data;
    check(
      assigned.kind === "ARTIST_ASSIGNED",
      "one artist belongs to the broker",
    );

    const context = async (session, artistId = artists.aria) =>
      api("artist-notes/context", { schemaVersion: 1, artistId }, as(session));
    for (const [session, status, label] of [
      [night, 403, "daily operations"],
      [mina, 403, "the broker, even for its own artist"],
    ])
      check(
        (await context(session)).status === status,
        `the API refuses ${label}`,
      );
    check(
      (await context(owner)).data.gate === "SIGN_IN_WITHOUT_CODE" &&
        (await context(plain)).data.gate === "TOTP_NOT_ENABLED" &&
        (await context(coded)).data.gate === "READY",
      "the API reports each administrator's gate",
    );

    async function editor(locale, viewport, session, options = {}) {
      const opened = await open(locale, viewport, { session, ...options });
      await opened.page
        .locator('[data-management-list="ARTISTS"]')
        .waitFor({ timeout: 180_000 });
      const answered = opened.page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/admin/artist-notes-context") &&
          response.request().method() === "POST",
        { timeout: 60_000 },
      );
      await opened.page
        .locator(`[data-management-item="${artists.aria}"]`)
        .click();
      await opened.page.locator("[data-management-editor]").waitFor();
      await answered;
      return opened;
    }
    const section = (page) => page.locator("[data-artist-notes]");
    const toggle = (page) => page.locator("[data-artist-notes-toggle]");
    const content = (page) => page.locator("[data-artist-notes-content]");
    const field = (page, name) =>
      page.locator(`[data-artist-notes-field="${name}"]`);

    stage("who sees the section");
    for (const [session, label] of [
      [night, "daily operations"],
      [mina, "the broker"],
    ]) {
      const {
        context: browser,
        page,
        errors,
      } = await editor("en", "desktop", session);
      await page.waitForTimeout(300);
      check(
        (await section(page).count()) === 0,
        `${label} sees no private notes section`,
      );
      check(errors.length === 0, `${label}: no page errors`);
      await browser.close();
    }
    for (const [session, gate, label] of [
      [owner, "SIGN_IN_WITHOUT_CODE", "signed in before turning on TOTP"],
      [plain, "TOTP_NOT_ENABLED", "without TOTP"],
    ]) {
      const { context: browser, page } = await editor(
        "zh-CN",
        "phone",
        session,
      );
      await section(page).waitFor();
      check(
        (await section(page).getAttribute("data-artist-notes-gate")) === gate,
        `an administrator ${label} sees the section locked`,
      );
      await toggle(page).click();
      const locked = (
        await page.locator("[data-artist-notes-locked]").innerText()
      ).trim();
      check(
        locked.includes("两步验证") || locked.includes("验证码"),
        `and is told how to unlock it (${label})`,
      );
      check(
        (await page.locator("[data-artist-notes-input]").count()) === 0 &&
          (await content(page).count()) === 0,
        `and gets neither a form nor content (${label})`,
      );
      check(
        await fitsWidth(page),
        `the locked section fits the phone (${label})`,
      );
      await shot(page, `locked-${gate.toLowerCase()}-phone-zh-CN`);
      await browser.close();
    }

    stage("write, change and read back (en, desktop)");
    const readsAtStart = await reads();
    {
      const {
        context: browser,
        page,
        errors,
      } = await editor("en", "desktop", coded);
      await section(page).waitFor();
      check(
        (await page.locator("[data-artist-notes-last]").innerText()).includes(
          "Nothing written yet",
        ),
        "the summary says nothing is written yet",
      );
      await toggle(page).click();
      await page.locator("[data-artist-notes-edit]").click();
      for (const [name, value] of Object.entries(FIRST))
        await page.locator(`[data-artist-notes-input="${name}"]`).fill(value);
      await page.locator("[data-artist-notes-save]").click();
      await content(page).waitFor();
      check(
        (await field(page, "realName").innerText()) === FIRST.realName &&
          (await field(page, "contact").innerText()) === FIRST.contact,
        "the saved notes are shown as written, line breaks included",
      );
      const [stored] = await q(
        "SELECT count(*)::int n,max(version)::int v,bool_or(position(convert_to('Minji','UTF8') in ciphertext)>0) leak FROM artist_private_notes WHERE idol_id=$1",
        [artists.aria],
      );
      check(
        stored.n === 1 && stored.v === 1 && stored.leak === false,
        "one encrypted version is stored, without the plaintext",
      );
      await page.locator("[data-artist-notes-edit]").click();
      await page
        .locator('[data-artist-notes-input="contact"]')
        .fill(SECOND.contact);
      await page.locator("[data-artist-notes-save]").click();
      await page
        .locator("[data-artist-notes-history]")
        .waitFor({ timeout: 30_000 });
      check(
        (await field(page, "contact").innerText()) === SECOND.contact,
        "a change becomes the current version",
      );
      check(
        (await page.locator("[data-artist-notes-version]").count()) === 2,
        "the history lists both versions",
      );
      const before = await reads();
      await page.locator('[data-artist-notes-version="1"] button').click();
      await page.locator("[data-artist-notes-old]").waitFor();
      check(
        (await field(page, "contact").innerText()) === FIRST.contact,
        "an earlier version can be opened",
      );
      check((await reads()) === before + 1, "and opening it is audited");
      check(errors.length === 0, "no page errors while writing");
      await shot(page, "history-desktop-en");
      await browser.close();
    }
    check(
      (
        await q(
          "SELECT count(*)::int n FROM audit_logs WHERE action='ARTIST_PRIVATE_NOTE_SAVED' AND subject_id=$1",
          [artists.aria],
        )
      )[0].n === 2,
      "each save left its audit",
    );

    stage("seven languages on phone and desktop");
    let opens = 0;
    const titles = new Set();
    const startReads = await reads();
    for (const viewport of ["phone", "desktop"])
      for (const locale of SUPPORTED_LOCALES) {
        const {
          context: browser,
          page,
          errors,
        } = await editor(locale, viewport, coded);
        await section(page).waitFor();
        check(
          !(await page.content()).includes("M12345678"),
          `${locale} ${viewport}: nothing private is on the page before opening`,
        );
        titles.add(
          (await page.locator(".mc-artist-notes-title").innerText()).trim(),
        );
        await toggle(page).click();
        opens += 1;
        await content(page).waitFor();
        check(
          (await field(page, "identity").innerText()) === FIRST.identity,
          `${locale} ${viewport}: the current notes open`,
        );
        check(
          (await page.getAttribute("html", "lang")) === locale,
          `${locale} ${viewport}: page language`,
        );
        check(
          await fitsWidth(page),
          `${locale} ${viewport}: no sideways scroll`,
        );
        await audit(page, `${locale} ${viewport} notes open`);
        if (locale === "th" || locale === "zh-CN")
          await shot(page, `open-${viewport}-${locale}`);
        check(errors.length === 0, `${locale} ${viewport}: no page errors`);
        await browser.close();
      }
    check(
      titles.size === SUPPORTED_LOCALES.length,
      "each language has its own title",
    );
    check(
      (await reads()) === startReads + opens,
      "every opening wrote exactly one read audit",
    );

    stage("keyboard, hiding the tab and reduced motion (ja, phone)");
    {
      const { context: browser, page } = await editor("ja", "phone", coded, {
        reducedMotion: "reduce",
      });
      await section(page).waitFor();
      await toggle(page).focus();
      await page.keyboard.press("Enter");
      await content(page).waitFor();
      check(
        (await page
          .locator("[data-artist-notes] details")
          .getAttribute("open")) !== null,
        "the keyboard opens the notes",
      );
      await page.keyboard.press("Tab");
      check(
        await page.evaluate(() =>
          Boolean(
            globalThis.document.activeElement?.closest("[data-artist-notes]"),
          ),
        ),
        "focus moves into the notes",
      );
      check(
        await page.evaluate(
          () =>
            globalThis.getComputedStyle(
              globalThis.document.querySelector("[data-artist-notes] summary"),
            ).transitionDuration === "0s",
        ),
        "nothing animates under reduced motion",
      );
      await page.evaluate(() => {
        Object.defineProperty(globalThis.document, "visibilityState", {
          value: "hidden",
          configurable: true,
        });
        globalThis.document.dispatchEvent(
          new globalThis.Event("visibilitychange"),
        );
      });
      await content(page).waitFor({ state: "detached" });
      check(
        !(await page.content()).includes("M12345678"),
        "hiding the tab drops the notes from the page",
      );
      await browser.close();
    }

    stage("a concurrent change (vi, desktop)");
    {
      const { context: browser, page } = await editor("vi", "desktop", coded);
      await section(page).waitFor();
      await toggle(page).click();
      await content(page).waitFor();
      await page.locator("[data-artist-notes-edit]").click();
      await page
        .locator('[data-artist-notes-input="other"]')
        .fill("Changed in the browser");
      const latest = (await context(coded)).data.versions[0];
      const sneaked = await api(
        "artist-notes/save",
        {
          schemaVersion: 1,
          artistId: artists.aria,
          noteId: randomUUID(),
          expectedVersion: latest.version,
          content: { ...SECOND, other: "Changed elsewhere" },
        },
        as(coded),
      );
      check(sneaked.data.kind === "SAVED", "someone else saves first");
      await page.locator("[data-artist-notes-save]").click();
      await page
        .locator("[data-artist-notes-notice]")
        .filter({ hasText: /\S/u })
        .waitFor();
      await content(page).waitFor();
      check(
        (await field(page, "other").innerText()) === "Changed elsewhere",
        "the stale save is refused and the latest version is shown",
      );
      check(
        (
          await q(
            "SELECT count(*)::int n FROM artist_private_notes WHERE idol_id=$1",
            [artists.aria],
          )
        )[0].n === 3,
        "nothing was overwritten",
      );
      await shot(page, "stale-desktop-vi");
      await browser.close();
    }
    check((await reads()) > readsAtStart, "reads were audited throughout");
  },
  { item: "l3-13" },
);
