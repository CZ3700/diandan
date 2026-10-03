#!/usr/bin/env node
// ADR-022 / L3-14: deleting staff accounts in a real browser, on real PostgreSQL and the production API composition.
// Artists are replica-seeded without photographs (no object storage here) and assigned through the API.
// Usage (after building the API): node scripts/admin-staff-deletion-browser.mjs [--compiled]
import { randomBytes, randomUUID } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  adminStandardRolePermissions,
} from "@fan-support/contracts";
import { runLocalAccountBrowserAcceptance } from "./admin-local-browser-harness.mjs";

await runLocalAccountBrowserAcceptance(
  "staff-deletion-browser",
  async (t) => {
    const { check, secret, stage, api, as, signIn, open, audit, fitsWidth } = t;
    const shot = t.shot;
    const q = async (text, values = []) =>
      (await t.client.query(text, values)).rows;
    const owner = await signIn("studio.owner", t.ownerPassword);
    /** Creates a staff account and signs it in past the temporary password. */
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
      return { session: done, password, member: created.member };
    }
    const members = async () =>
      (await api("staff/list", {}, as(owner))).data.members;
    const memberOf = async (loginName) =>
      (await members()).find((m) => m.loginName === loginName);
    const deletions = async () =>
      (
        await q(
          "SELECT count(*)::int n FROM audit_logs WHERE action='ADMIN_STAFF_DELETED'",
        )
      )[0].n;

    stage("seed");
    // The fixture's daily-operations role is deliberately thin; give it what the server command grants.
    await t.client.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key=ANY($1::text[]) WHERE r.role_key='studio:operator' ON CONFLICT DO NOTHING",
      [adminStandardRolePermissions("studio:operator")],
    );
    const mina = await staff("mina.park", "Mina Park", "studio:broker");
    const rui = await staff("rui.tanaka", "Rui Tanaka", "studio:broker");
    const night = await staff("night.shift", "Night Shift", "studio:operator");
    const day = await staff("day.shift", "Day Shift", "studio:operator");
    const artists = {
      aria: randomUUID(),
      bo: randomUUID(),
      cleo: randomUUID(),
    };
    await t.client.query("BEGIN");
    await t.client.query("SET LOCAL session_replication_role=replica");
    for (const [index, [handle, id]] of Object.entries(artists).entries())
      await t.client.query(
        "INSERT INTO idols(id,handle,status,accepting_gifts,version,created_at,updated_at) VALUES($1,$2,'active',true,2,clock_timestamp()-make_interval(mins=>$3),clock_timestamp())",
        [id, `${handle}-deletion`, 10 - index],
      );
    await t.client.query("COMMIT");
    const [{ id: minaIdentity }] = await q(
      "SELECT admin_identity_id id FROM admin_local_accounts WHERE login_name='mina.park'",
    );
    for (const id of Object.values(artists))
      check(
        (
          await api(
            "management/artists/assign",
            {
              schemaVersion: 1,
              artistId: id,
              brokerId: minaIdentity,
              expectedBrokerId: null,
            },
            { ...as(owner), "idempotency-key": `l3-14-${randomUUID()}` },
          )
        ).data.kind === "ARTIST_ASSIGNED",
        "an artist is assigned to Mina",
      );
    // One of her artists is deleted afterwards (deleting an artist archives it).
    await t.client.query("BEGIN");
    await t.client.query("SET LOCAL session_replication_role=replica");
    await t.client.query(
      "UPDATE idols SET status='archived',accepting_gifts=false WHERE id=$1",
      [artists.cleo],
    );
    await t.client.query("COMMIT");
    check(
      (await memberOf("mina.park")).assignedArtists === 2 &&
        (await memberOf("rui.tanaka")).assignedArtists === 0,
      "the list counts each broker's current artists",
    );
    const target = async (loginName) => {
      const member = await memberOf(loginName);
      return {
        accountId: member.accountId,
        expectedVersion: member.version,
        loginName,
      };
    };
    const refused = await api(
      "staff/delete",
      await target("rui.tanaka"),
      as(day.session),
    );
    check(
      refused.status === 403,
      "daily operations cannot delete accounts through the API",
    );
    const own = (await members()).find((m) => m.self);
    const self = await api(
      "staff/delete",
      {
        accountId: own.accountId,
        expectedVersion: own.version,
        loginName: own.loginName,
      },
      as(owner),
    );
    check(
      self.status !== 200 && self.data.code === "SELF_LOCKOUT",
      "nobody deletes their own account",
    );
    check((await deletions()) === 0, "refusals leave no deletion audit");

    async function openStaff(locale, viewport, options = {}) {
      const opened = await open(locale, viewport, {
        session: owner,
        ...options,
      });
      await opened.page
        .locator('[data-management-section="STAFF"]')
        .click({ timeout: 180_000 });
      await opened.page.locator(".staff-list").waitFor();
      return opened;
    }
    const rowOf = (page, loginName) =>
      page.locator(`[data-staff-member="${loginName}"]`);
    const panelOf = (page) => page.locator("[data-staff-delete-panel]");
    const nameField = (page) => page.locator('[id^="staff-delete-name-"]');
    const confirmOf = (page) => page.locator("[data-staff-delete-confirm]");
    const focusedOnName = (page) =>
      page.evaluate(() =>
        String(globalThis.document.activeElement?.id ?? "").startsWith(
          "staff-delete-name-",
        ),
      );

    stage("seven languages on phone and desktop");
    const wording = new Set();
    for (const viewport of ["phone", "desktop"])
      for (const locale of SUPPORTED_LOCALES) {
        const { context, page, errors } = await openStaff(locale, viewport);
        check(
          (await rowOf(page, "studio.owner")
            .locator("[data-staff-delete]")
            .count()) === 0,
          `${locale} ${viewport}: your own row offers no deletion`,
        );
        await rowOf(page, "mina.park").locator("[data-staff-delete]").click();
        await panelOf(page).waitFor();
        const text = await panelOf(page).innerText();
        wording.add(text);
        check(
          text.includes("mina.park") &&
            (
              await page.locator("[data-staff-delete-artists]").innerText()
            ).includes("2"),
          `${locale} ${viewport}: the confirmation names the account and its two artists`,
        );
        check(
          await confirmOf(page).isDisabled(),
          `${locale} ${viewport}: nothing is deleted before the name is typed`,
        );
        check(
          await focusedOnName(page),
          `${locale} ${viewport}: focus moves to the name field`,
        );
        check(
          await fitsWidth(page),
          `${locale} ${viewport}: no horizontal overflow`,
        );
        await audit(page, `${locale} ${viewport} delete confirmation`);
        if (locale === "zh-CN" || locale === "th")
          await shot(page, `confirm-${viewport}-${locale}`);
        await panelOf(page).locator('button[type="button"]').click();
        await panelOf(page).waitFor({ state: "detached" });
        check(errors.length === 0, `${locale} ${viewport}: no page errors`);
        await context.close();
      }
    check(
      wording.size === SUPPORTED_LOCALES.length,
      "each language words the confirmation its own way",
    );
    check(
      (await deletions()) === 0 &&
        (await memberOf("mina.park")).assignedArtists === 2,
      "cancelling deletes nothing",
    );

    stage("delete a broker (zh-CN, desktop)");
    {
      const { context, page, errors } = await openStaff("zh-CN", "desktop");
      await rowOf(page, "mina.park").locator("[data-staff-delete]").click();
      await nameField(page).fill("Mina Park");
      check(
        await confirmOf(page).isDisabled(),
        "the display name is not the login name",
      );
      await nameField(page).fill("mina.park");
      check(
        await confirmOf(page).isEnabled(),
        "the exact login name unlocks it",
      );
      await confirmOf(page).click();
      await rowOf(page, "mina.park").waitFor({ state: "detached" });
      const notice = await page.locator(".staff-notice--done").innerText();
      check(
        notice.includes("mina.park") && notice.includes("2"),
        "the notice says two artists went back to the studio",
      );
      check(errors.length === 0, "no page errors while deleting");
      await shot(page, "deleted-desktop-zh-CN");
      await context.close();
    }
    const [gone] = await q(
      "SELECT i.status,a.totp_ciphertext IS NULL no_totp,(SELECT count(*)::int FROM admin_identity_roles WHERE admin_identity_id=i.id) roles,(SELECT count(*)::int FROM admin_sessions WHERE admin_identity_id=i.id AND revoked_at IS NULL) live FROM admin_local_accounts a JOIN admin_identities i ON i.id=a.admin_identity_id WHERE a.login_name='mina.park'",
    );
    check(
      gone.status === "ARCHIVED" &&
        gone.no_totp &&
        gone.roles === 0 &&
        gone.live === 0,
      "the account is marked deleted, without roles or live sessions",
    );
    check(
      (
        await q(
          "SELECT count(*)::int n FROM idols WHERE id=ANY($1::uuid[]) AND public.idol_current_broker(id) IS NULL",
          [Object.values(artists)],
        )
      )[0].n === 3,
      "all three artists, the deleted one included, are the studio's again",
    );
    check(
      (
        await q(
          "SELECT count(*)::int n FROM idol_assignments a JOIN audit_logs l ON l.id=a.audit_log_id WHERE a.idol_id=ANY($1::uuid[]) AND a.broker_identity_id IS NULL AND l.reason_code='BROKER_DELETED'",
          [Object.values(artists)],
        )
      )[0].n === 3,
      "each artist has a record saying why it moved",
    );
    check(
      (await api("account/context", {}, as(mina.session))).status === 401,
      "her session stopped working",
    );
    check(
      (await signIn("mina.park", mina.password)).code === "INVALID_CREDENTIALS",
      "and she cannot sign in",
    );
    check(
      !(await members()).some((m) => m.loginName === "mina.park"),
      "she left the staff list",
    );

    stage("the artists went back to the studio (en, desktop)");
    {
      const { context, page, errors } = await open("en", "desktop", {
        session: owner,
      });
      await page
        .locator('[data-management-list="ARTISTS"]')
        .waitFor({ timeout: 180_000 });
      const options = await page
        .locator("#management-assignment-filter option")
        .allInnerTexts();
      const lines = await page
        .locator("[data-management-assignment]")
        .allInnerTexts();
      check(
        !options.includes("Mina Park") && options.includes("Rui Tanaka"),
        "the broker filter no longer offers her",
      );
      check(
        lines.length === 2 && lines.every((line) => line === options[1]),
        "her two current artists show as unassigned",
      );
      check(errors.length === 0, "no page errors on the artist list");
      await context.close();
    }

    stage("the login name is not reused (en, desktop)");
    {
      const { context, page } = await openStaff("en", "desktop");
      await page.getByRole("button", { name: "New staff account" }).click();
      await page.locator("#staff-login-name").fill("mina.park");
      await page.locator("#staff-display-name").fill("Mina Again");
      await page.getByRole("button", { name: "Create account" }).click();
      await page.getByText("That login name is already in use.").waitFor();
      check(true, "a deleted account's login name cannot be taken again");
      await context.close();
    }

    stage("keyboard and reduced motion (ja, phone)");
    {
      const { context, page } = await openStaff("ja", "phone", {
        reducedMotion: "reduce",
      });
      await rowOf(page, "rui.tanaka").locator("[data-staff-delete]").focus();
      await page.keyboard.press("Enter");
      await panelOf(page).waitFor();
      check(await focusedOnName(page), "the keyboard lands in the name field");
      check(
        (await page.locator("[data-staff-delete-artists]").count()) === 0,
        "a broker without artists gets no artist line",
      );
      check(
        await panelOf(page).evaluate((panel) =>
          [panel, ...panel.querySelectorAll("*")].every((node) => {
            const style = globalThis.getComputedStyle(node);
            return (
              style.transitionDuration
                .split(",")
                .every((value) => parseFloat(value) === 0) &&
              style.animationName === "none"
            );
          }),
        ),
        "nothing animates under reduced motion",
      );
      await page.keyboard.type("rui.tanaka");
      await page.keyboard.press("Enter");
      await rowOf(page, "rui.tanaka").waitFor({ state: "detached" });
      const notice = await page.locator(".staff-notice--done").innerText();
      check(
        notice.includes("rui.tanaka") && !notice.includes("0"),
        "the notice mentions no artists when there were none",
      );
      check(await fitsWidth(page), "fits the phone");
      await shot(page, "deleted-phone-ja");
      await context.close();
    }
    check(
      (await api("account/context", {}, as(rui.session))).status === 401,
      "Rui's live session stopped working too",
    );

    stage("a change made elsewhere, then a suspended account (es, desktop)");
    {
      const { context, page } = await openStaff("es", "desktop");
      await rowOf(page, "night.shift").locator("[data-staff-delete]").click();
      await nameField(page).fill("night.shift");
      const current = await memberOf("night.shift");
      check(
        (
          await api(
            "staff/set-status",
            {
              accountId: current.accountId,
              expectedVersion: current.version,
              status: "SUSPENDED",
            },
            as(owner),
          )
        ).status === 200,
        "someone suspends the account in another window",
      );
      await confirmOf(page).click();
      await page
        .getByText(
          "Esta cuenta cambió en otra ventana. La lista ya muestra el estado actual.",
        )
        .waitFor();
      await rowOf(page, "night.shift")
        .locator('[data-status="SUSPENDED"]')
        .waitFor();
      check(
        (await panelOf(page).count()) === 0,
        "the stale deletion is refused and the list reloads",
      );
      await rowOf(page, "night.shift").locator("[data-staff-delete]").click();
      await nameField(page).fill("night.shift");
      await confirmOf(page).click();
      await rowOf(page, "night.shift").waitFor({ state: "detached" });
      check(
        (
          await q(
            "SELECT i.status FROM admin_identities i JOIN admin_local_accounts a ON a.admin_identity_id=i.id WHERE a.login_name='night.shift'",
          )
        )[0].status === "ARCHIVED" &&
          (await signIn("night.shift", night.password)).code ===
            "INVALID_CREDENTIALS",
        "a suspended account can be deleted, and stays unable to sign in",
      );
      await context.close();
    }
    check(
      (await deletions()) === 3,
      "each deletion was audited once (two brokers and an operator)",
    );
    check(
      (await members())
        .map((m) => m.loginName)
        .sort()
        .join() === "day.shift,studio.owner",
      "only the remaining people are listed",
    );
  },
  { item: "l3-14" },
);
