#!/usr/bin/env node
// ADR-022 / L3-11: brokers and artist assignment in a real browser, on real PostgreSQL and the
// production API composition. Artists are replica-seeded without photographs (this stack has no
// object storage), so adding an artist with its image is verified on the deployed TEST instance.
import { randomBytes, randomUUID } from "node:crypto";
import {
  SUPPORTED_LOCALES,
  adminStandardRolePermissions,
} from "@fan-support/contracts";
import { runLocalAccountBrowserAcceptance } from "./admin-local-browser-harness.mjs";

/** The wording seen per language, to show each language has its own (the exact copy is unit-tested). */
const wording = {
  all: new Set(),
  none: new Set(),
  broker: new Set(),
  role: new Set(),
};

await runLocalAccountBrowserAcceptance(
  "brokers-browser",
  async (t) => {
    const { check, secret, stage, api, as, signIn, open, audit, fitsWidth } = t;
    const owner = await signIn("studio.owner", t.ownerPassword);
    const mutate = (route, body, session) =>
      api(
        route,
        { schemaVersion: 1, ...body },
        { ...as(session), "idempotency-key": `l3-11-${randomUUID()}` },
      );
    const read = (route, body, session) =>
      api(route, { schemaVersion: 1, ...body }, as(session));
    /** Creates a staff account and signs it in past the temporary password. */
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
      return { session: done, member: created.member };
    }
    const listOf = async (session, assignment) => {
      const result = (
        await read(
          "management/list",
          {
            section: "ARTISTS",
            page: 1,
            pageSize: 50,
            ...(assignment ? { assignment } : {}),
          },
          session,
        )
      ).data;
      return result.items ?? result.code;
    };
    const names = (items) => items.map((item) => item.handle).sort();

    stage("seed");
    // The fixture's daily-operations role is deliberately thin; give it what the server command grants.
    await t.client.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.permission_key=ANY($1::text[]) WHERE r.role_key='studio:operator' ON CONFLICT DO NOTHING",
      [adminStandardRolePermissions("studio:operator")],
    );
    const mina = await staff("mina.park", "Mina Park", "studio:broker");
    const rui = await staff("rui.tanaka", "Rui Tanaka", "studio:broker");
    const night = await staff("night.shift", "Night Shift", "studio:operator");
    const artists = {};
    await t.client.query("BEGIN");
    await t.client.query("SET LOCAL session_replication_role=replica");
    for (const [index, handle] of [
      "aria-lin",
      "bo-chen",
      "cleo-ward",
      "dara-moon",
    ].entries()) {
      artists[handle] = randomUUID();
      await t.client.query(
        "INSERT INTO idols(id,handle,status,accepting_gifts,version,created_at,updated_at) VALUES($1,$2,'active',true,2,clock_timestamp()-make_interval(mins=>$3),clock_timestamp())",
        [artists[handle], handle, 10 - index],
      );
    }
    await t.client.query("COMMIT");
    const directory = (await read("management/context", {}, owner)).data
      .artists;
    check(
      directory.scope === "ALL" && directory.canAssign === true,
      "the administrator manages every artist and may assign",
    );
    const broker = Object.fromEntries(
      directory.brokers.map((row) => [row.displayName, row.brokerId]),
    );
    check(
      Object.keys(broker).sort().join() === "Mina Park,Rui Tanaka",
      "the directory lists the two brokers and nobody else",
    );
    const assign = async (
      handle,
      brokerId,
      expectedBrokerId,
      session = owner,
    ) =>
      mutate(
        "management/artists/assign",
        { artistId: artists[handle], brokerId, expectedBrokerId },
        session,
      );
    check(
      (await assign("aria-lin", broker["Mina Park"], null)).data.kind ===
        "ARTIST_ASSIGNED" &&
        (await assign("bo-chen", broker["Rui Tanaka"], null)).data.kind ===
          "ARTIST_ASSIGNED",
      "two artists assigned, two left to the studio",
    );
    const items = (page) => page.locator("[data-management-item]");
    async function openArtists(locale, viewport, session, options = {}) {
      const opened = await open(locale, viewport, { session, ...options });
      await opened.page
        .locator('[data-management-list="ARTISTS"]')
        .waitFor({ timeout: 180_000 });
      return opened;
    }
    const sections = (page) =>
      page
        .locator("[data-management-section]")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-management-section")),
        );

    stage("the administrator: seven languages on phone and desktop");
    for (const viewport of ["phone", "desktop"])
      for (const locale of SUPPORTED_LOCALES) {
        const { context, page, errors } = await openArtists(
          locale,
          viewport,
          owner,
        );
        check(
          (await items(page).count()) === 4,
          `${locale} ${viewport}: four artists`,
        );
        const options = await page
          .locator("#management-assignment-filter option")
          .allInnerTexts();
        const [all, none] = options;
        check(
          options.length === 4 &&
            options.slice(2).join("|") === "Mina Park|Rui Tanaka",
          `${locale} ${viewport}: the filter offers all, unassigned and each broker`,
        );
        const lines = await page
          .locator("[data-management-assignment]")
          .allInnerTexts();
        const label = lines
          .find((line) => line.endsWith(" · Mina Park"))
          ?.slice(0, -" · Mina Park".length);
        check(
          lines.length === 4 &&
            lines.filter((line) => line === none).length === 2 &&
            Boolean(label) &&
            lines.includes(`${label} · Rui Tanaka`),
          `${locale} ${viewport}: each artist shows its broker, or the filter's word for unassigned`,
        );
        wording.all.add(all);
        wording.none.add(none);
        wording.broker.add(label);
        check(
          await fitsWidth(page),
          `${locale} ${viewport}: no horizontal overflow`,
        );
        await audit(page, `administrator list ${locale} ${viewport}`);
        await t.shot(page, `owner-list-${viewport}-${locale}`);
        check(errors.length === 0, `${locale} ${viewport}: no page errors`);
        await context.close();
      }

    check(
      [wording.all, wording.none, wording.broker].every(
        (seen) => seen.size === SUPPORTED_LOCALES.length,
      ),
      "every language has its own wording for all, unassigned and broker",
    );

    stage("filtering by assignment with the keyboard (en, desktop)");
    {
      const { context, page } = await openArtists("en", "desktop", owner);
      const filter = page.locator("#management-assignment-filter");
      await filter.focus();
      await page.keyboard.press("ArrowDown");
      await page.waitForFunction(
        () =>
          globalThis.document.querySelectorAll("[data-management-item]")
            .length === 2,
      );
      check(
        (await filter.inputValue()) === "UNASSIGNED" &&
          (
            await page.locator("[data-management-assignment]").allInnerTexts()
          ).every((line) => line === "Unassigned"),
        "one key press narrows the list to the two unassigned artists",
      );
      check(
        await page.evaluate(
          () =>
            globalThis.document.activeElement?.id ===
            "management-assignment-filter",
        ),
        "the filter keeps keyboard focus while the list reloads",
      );
      await filter.selectOption({ label: "Mina Park" });
      await page.waitForFunction(
        () =>
          globalThis.document.querySelectorAll("[data-management-item]")
            .length === 1,
      );
      check(
        (await items(page).getAttribute("data-management-item")) ===
          artists["aria-lin"],
        "choosing a broker lists that broker's artist",
      );
      await filter.selectOption({ label: "Rui Tanaka" });
      await page
        .locator(`[data-management-item="${artists["bo-chen"]}"]`)
        .waitFor();
      await filter.selectOption({ label: "All artists" });
      await page.waitForFunction(
        () =>
          globalThis.document.querySelectorAll("[data-management-item]")
            .length === 4,
      );
      check(true, "back to all four");
      await context.close();
    }

    stage("assigning from the artist's page (zh-CN, desktop)");
    {
      const { context, page } = await openArtists("zh-CN", "desktop", owner);
      await page
        .locator(`[data-management-item="${artists["cleo-ward"]}"]`)
        .click();
      const select = page.locator("#management-assignment");
      await select.waitFor();
      check(
        (await select.locator("option").allInnerTexts()).join("|") ===
          "未分配（超管直管）|Mina Park|Rui Tanaka" &&
          (await select.inputValue()) === "",
        "the editor offers unassigned and both brokers, and starts unassigned",
      );
      check(
        (
          await page.locator("#management-assignment-description").innerText()
        ).includes("立即生效"),
        "it says the change applies at once",
      );
      await select.selectOption({ label: "Mina Park" });
      await page
        .locator('.mc-assignment [role="status"]')
        .getByText("归属已更新。")
        .waitFor();
      check(
        names(await listOf(mina.session)).join() === "aria-lin,cleo-ward",
        "the broker lists the artist at once, without saving the form",
      );
      await t.shot(page, "owner-assigned-desktop-zh-CN");
      await audit(page, "administrator editor zh-CN desktop");
      // Someone else reassigns the artist while this editor is open.
      check(
        (await assign("cleo-ward", broker["Rui Tanaka"], broker["Mina Park"]))
          .data.kind === "ARTIST_ASSIGNED",
        "reassigned elsewhere",
      );
      await select.selectOption({ value: "" });
      await page.getByRole("alert").getByText("归属已被其他人修改").waitFor();
      check(
        (await select.inputValue()) === broker["Mina Park"] &&
          names(await listOf(rui.session)).join() === "bo-chen,cleo-ward",
        "a stale editor changes nothing and says so",
      );
      await context.close();
      check(
        (await assign("cleo-ward", null, broker["Rui Tanaka"])).data
          .assignment === null,
        "the artist returns to the studio",
      );
    }
    {
      const { context, page } = await openArtists("ja", "phone", owner);
      await page
        .locator(`[data-management-item="${artists["dara-moon"]}"]`)
        .click();
      const select = page.locator("#management-assignment");
      await select.waitFor();
      await select.focus();
      await page.keyboard.press("ArrowDown");
      await page
        .locator('.mc-assignment [role="status"]')
        .getByText("担当を更新しました。")
        .waitFor();
      check(
        names(await listOf(mina.session)).join() === "aria-lin,dara-moon",
        "on a phone, one key press on the focused field assigns the artist",
      );
      check(await fitsWidth(page), "the editor fits the phone");
      await t.shot(page, "owner-assigned-phone-ja");
      await audit(page, "administrator editor ja phone");
      await context.close();
      await assign("dara-moon", null, broker["Mina Park"]);
    }

    stage("daily operations see assignment but cannot change it (pt, desktop)");
    {
      const { context, page } = await openArtists(
        "pt",
        "desktop",
        night.session,
      );
      check(
        (await items(page).count()) === 4 &&
          (await page.locator("[data-management-assignment]").count()) === 4 &&
          (await page.locator("#management-assignment-filter").count()) === 1,
        "every artist, its broker and the filter are shown",
      );
      await page
        .locator(`[data-management-item="${artists["aria-lin"]}"]`)
        .click();
      await page.locator("[data-management-editor]").waitFor();
      check(
        (await page.locator("#management-assignment").count()) === 0,
        "the editor offers no broker choice",
      );
      check(
        (await assign("cleo-ward", broker["Mina Park"], null, night.session))
          .status === 403,
        "and the API refuses the assignment",
      );
      await context.close();
    }

    stage("a broker: seven languages on phone and desktop");
    for (const viewport of ["phone", "desktop"])
      for (const locale of SUPPORTED_LOCALES) {
        const { context, page, errors } = await openArtists(
          locale,
          viewport,
          mina.session,
        );
        check(
          (await sections(page)).join() === "ARTISTS,ACCOUNT",
          `${locale} ${viewport}: the sidebar is artists and account settings only`,
        );
        check(
          (await items(page).count()) === 1 &&
            (await items(page).getAttribute("data-management-item")) ===
              artists["aria-lin"],
          `${locale} ${viewport}: only the broker's own artist`,
        );
        check(
          (await page.locator("[data-management-assignment]").count()) === 0 &&
            (await page.locator("#management-assignment-filter").count()) === 0,
          `${locale} ${viewport}: no broker line and no filter`,
        );
        check(
          await page.locator("[data-management-new]").isEnabled(),
          `${locale} ${viewport}: can add an artist`,
        );
        check(
          await fitsWidth(page),
          `${locale} ${viewport}: no horizontal overflow`,
        );
        await audit(page, `broker list ${locale} ${viewport}`);
        await t.shot(page, `broker-list-${viewport}-${locale}`);
        check(errors.length === 0, `${locale} ${viewport}: no page errors`);
        await context.close();
      }

    stage("a broker's artist page and reduced motion (zh-CN, phone)");
    {
      const { context, page } = await openArtists(
        "zh-CN",
        "phone",
        mina.session,
        { reducedMotion: "reduce" },
      );
      check(
        await page
          .locator(".mc-item-action")
          .first()
          .evaluate((node) =>
            globalThis
              .getComputedStyle(node)
              .transitionDuration.split(",")
              .every((value) => Number.parseFloat(value) === 0),
          ),
        "reduced motion: the list has no transition",
      );
      await page.keyboard.press("Tab");
      await items(page).focus();
      await page.keyboard.press("Enter");
      await page.locator("[data-management-editor]").waitFor();
      check(
        (await page.locator("#management-assignment").count()) === 0 &&
          (await page.getByText("永久删除").count()) === 0,
        "opened by keyboard: no broker choice and no delete",
      );
      check(
        (await page.locator("#management-name").inputValue()) === "aria-lin",
        "its own artist is editable",
      );
      await t.shot(page, "broker-editor-phone-zh-CN");
      await audit(page, "broker editor zh-CN phone");
      await context.close();
    }

    stage("what a broker's session is refused");
    {
      const refused = async (result) => (await result).status;
      const gift = {
        kind: "SAVE_GIFT",
        sourceLocale: "en",
        id: null,
        expectedVersion: 0,
        name: "Gift",
        description: "Description",
        image: { uploadId: randomUUID() },
        giftKind: "VIRTUAL",
        category: "OTHER",
        price: { market: "TEST", currency: "USD", amountMinor: 1000 },
        inventory: { policy: "PROCURE_ON_DEMAND" },
        eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
      };
      const edit = (handle) => ({
        kind: "SAVE_ARTIST",
        sourceLocale: "en",
        id: artists[handle],
        expectedVersion: 2,
        name: "Renamed",
        description: "Description",
        image: null,
      });
      const list = (section, extra = {}) =>
        read(
          "management/list",
          { section, page: 1, pageSize: 12, ...extra },
          mina.session,
        );
      const statuses = [
        await refused(list("GIFTS")),
        await refused(list("POSTERS")),
        await refused(list("ARTISTS", { assignment: { kind: "UNASSIGNED" } })),
        await refused(
          list("ARTISTS", {
            assignment: { kind: "BROKER", brokerId: broker["Rui Tanaka"] },
          }),
        ),
        await refused(
          mutate("management/submit", { intent: gift }, mina.session),
        ),
        await refused(
          mutate(
            "management/submit",
            { intent: edit("bo-chen") },
            mina.session,
          ),
        ),
        await refused(
          mutate(
            "management/submit",
            { intent: edit("cleo-ward") },
            mina.session,
          ),
        ),
        await refused(
          read(
            "management/images/read",
            {
              target: {
                kind: "ARTIST",
                id: artists["bo-chen"],
                expectedVersion: 2,
              },
            },
            mina.session,
          ),
        ),
        await refused(
          assign("cleo-ward", broker["Mina Park"], null, mina.session),
        ),
        await refused(api("staff/context", {}, as(mina.session))),
        await refused(
          read(
            "orders/list",
            {
              page: 1,
              pageSize: 10,
              query: "",
              fulfillment: "ALL",
              moderation: "ALL",
            },
            mina.session,
          ),
        ),
        await refused(
          mutate(
            "catalog/idols/status",
            {
              idolId: artists["aria-lin"],
              status: "archived",
              acceptingGifts: false,
              expectedBaseVersion: 2,
              reasonCode: "DAILY_CENTER_DELETE",
            },
            mina.session,
          ),
        ),
      ];
      check(
        statuses.every((status) => status === 403),
        `gifts, posters, other brokers' and unassigned artists, assigning, staff, orders and deleting its own artist are all refused (${statuses.join()})`,
      );
      const orders = (await read("orders/context", {}, mina.session)).data;
      check(
        Array.isArray(orders.permissions) && orders.permissions.length === 0,
        "the order context tells a broker it holds no order permission",
      );
      check(
        (
          await mutate(
            "management/submit",
            { intent: edit("aria-lin") },
            mina.session,
          )
        ).data.kind === "OPERATION",
        "an edit of its own artist is accepted",
      );
    }

    stage("reassignment and a suspended broker (en, desktop)");
    {
      const { context, page } = await openArtists(
        "en",
        "desktop",
        mina.session,
      );
      check(
        (await assign("aria-lin", broker["Rui Tanaka"], broker["Mina Park"]))
          .data.kind === "ARTIST_ASSIGNED",
        "the administrator moves the artist to the other broker",
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .locator('[data-management-list="ARTISTS"]')
        .waitFor({ timeout: 180_000 });
      check(
        (await items(page).count()) === 0 &&
          (await page.getByText("Add your first artist.").count()) === 1,
        "the former broker's list is empty on the next load",
      );
      await context.close();
      const suspended = (
        await api("staff/list", {}, as(owner))
      ).data.members.find((member) => member.loginName === "rui.tanaka");
      check(
        (
          await api(
            "staff/set-status",
            {
              accountId: suspended.accountId,
              expectedVersion: suspended.version,
              status: "SUSPENDED",
            },
            as(owner),
          )
        ).status === 200,
        "the other broker is suspended",
      );
      const again = await openArtists("en", "desktop", owner);
      const lines = await again.page
        .locator("[data-management-assignment]")
        .allInnerTexts();
      check(
        lines.filter((line) => line === "Broker · Rui Tanaka (inactive)")
          .length === 2,
        "its two artists keep their broker, marked inactive",
      );
      check(
        (
          await again.page
            .locator("#management-assignment-filter option")
            .allInnerTexts()
        ).includes("Rui Tanaka (inactive)"),
        "and can still be found with the filter",
      );
      await again.page
        .locator(`[data-management-item="${artists["cleo-ward"]}"]`)
        .click();
      const select = again.page.locator("#management-assignment");
      await select.waitFor();
      check(
        (await select.locator("option").allInnerTexts()).join("|") ===
          "Unassigned (managed by the studio)|Mina Park",
        "a suspended broker is not offered for another artist",
      );
      await again.page.locator(".mc-back").click();
      await again.page
        .locator(`[data-management-item="${artists["bo-chen"]}"]`)
        .click();
      await select.waitFor();
      check(
        (await select.inputValue()) === broker["Rui Tanaka"] &&
          (await select.locator("option:checked").innerText()) ===
            "Rui Tanaka (inactive)",
        "its own artist still shows it, so the administrator can reassign",
      );
      await select.selectOption({ label: "Mina Park" });
      await again.page
        .locator('.mc-assignment [role="status"]')
        .getByText("Broker updated.")
        .waitFor();
      check(
        names(await listOf(mina.session)).join() === "bo-chen",
        "and the reassignment works",
      );
      await t.shot(again.page, "owner-suspended-desktop-en");
      await again.context.close();
    }

    stage("the staff page names the third role (seven languages, desktop)");
    for (const locale of SUPPORTED_LOCALES) {
      const { context, page } = await open(locale, "desktop", {
        session: owner,
      });
      await page
        .locator('[data-management-section="STAFF"]')
        .click({ timeout: 180_000 });
      await page.locator(".staff-list").waitFor();
      const row = await page
        .locator('[data-staff-member="mina.park"]')
        .innerText();
      await page.locator(".staff-heading button").click();
      await page.locator("#staff-login-name").waitFor();
      const role = (
        await page
          .locator('label[for="staff-role-studio-broker"] strong')
          .innerText()
      ).trim();
      check(
        (await page.locator(".staff-roles input[type=checkbox]").count()) ===
          3 && role.length > 0,
        `${locale}: a new account can be given one of three roles, the broker among them`,
      );
      check(
        row.includes(role) && !row.includes("studio:broker"),
        `${locale}: the broker's row names the role as the form does, never by its key`,
      );
      wording.role.add(role);
      check(await fitsWidth(page), `${locale}: no horizontal overflow`);
      await audit(page, `staff create ${locale} desktop`);
      await t.shot(page, `staff-roles-desktop-${locale}`);
      await context.close();
    }
    check(
      wording.role.size === SUPPORTED_LOCALES.length,
      "every language has its own name for the broker role",
    );
  },
  { item: "l3-11" },
);
