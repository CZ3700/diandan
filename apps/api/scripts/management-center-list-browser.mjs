import { expect } from "@playwright/test";

const kinds = ["VIRTUAL", "PHYSICAL", "WISH", "MERCHANDISE"];
const kindButton = (kind) => `[data-management-gift-kind="${kind}"]`;
const sortButton = (sort) => `[data-management-price-sort="${sort}"]`;
const ids = (items) => items.map((item) => item.id).join();

/** Additional list journeys on the existing real PG/S3 management browser, never a mock page. */
export function createManagementListBrowser({
  page,
  client,
  observed,
  assert,
  settledResponses,
  section,
  back,
  tabTo,
}) {
  const list = (name) => observed.lists.get(name);
  async function change(name, action) {
    const response = page.waitForResponse((value) => {
      const url = new globalThis.URL(value.url());
      return (
        url.pathname === "/api/admin/management-list" &&
        value.request().postDataJSON()?.section === name
      );
    });
    const [result] = await Promise.all([response, action()]);
    assert(
      result.ok(),
      `${name} list change reads a successful real BFF response`,
    );
    await settledResponses();
    await expect(
      page.locator(`[data-management-list="${name}"]`),
    ).toBeVisible();
    await expect(page.locator("[data-management-list-pending]")).toHaveCount(0);
    const value = list(name);
    await expect
      .poll(() =>
        page
          .locator("[data-management-item]")
          .evaluateAll((nodes) =>
            nodes
              .map((node) => node.getAttribute("data-management-item"))
              .join(),
          ),
      )
      .toBe(ids(value.items));
    if (name === "GIFTS")
      for (const item of value.items) {
        const displayed =
          item.sortPrice === undefined ? item.price : item.sortPrice;
        const price = page.locator(
          `[data-management-item="${item.id}"] .fs-price`,
        );
        if (displayed) {
          await expect(price).toHaveAttribute(
            "value",
            String(displayed.amountMinor),
          );
          await expect(price).toHaveAttribute(
            "data-currency",
            displayed.currency,
          );
        } else await expect(price).toHaveCount(0);
      }
    return value;
  }
  async function kind(value) {
    const button = page.locator(kindButton(value));
    if ((await button.getAttribute("aria-pressed")) === "true") return;
    await change("GIFTS", () => button.click());
    await expect(button).toHaveAttribute("aria-pressed", "true");
    assert(
      list("GIFTS").page === 1,
      "changing the gift kind resets to page one",
    );
  }
  async function sort(value) {
    if (value === "NEWEST") {
      const active = page.locator(
        '[data-management-price-sort][aria-pressed="true"]',
      );
      if (await active.count()) await change("GIFTS", () => active.click());
    } else {
      const button = page.locator(sortButton(value));
      if ((await button.getAttribute("aria-pressed")) !== "true")
        await change("GIFTS", () => button.click());
      await expect(button).toHaveAttribute("aria-pressed", "true");
    }
    assert(
      list("GIFTS").page === 1,
      "changing the price order resets to page one",
    );
  }
  async function giftPage(target) {
    while (list("GIFTS").page !== target) {
      const direction = list("GIFTS").page < target ? "next" : "previous";
      await change("GIFTS", () =>
        page.locator(`[data-management-${direction}]`).click(),
      );
    }
  }
  async function allGiftPages() {
    await giftPage(1);
    const total = list("GIFTS").totalItems;
    const items = [...list("GIFTS").items];
    const pages = Math.ceil(total / list("GIFTS").pageSize);
    for (let number = 2; number <= pages; number++) {
      await giftPage(number);
      assert(
        list("GIFTS").totalItems === total,
        "filtered total stays constant across pages",
      );
      items.push(...list("GIFTS").items);
    }
    assert(
      items.length === total &&
        new Set(items.map((item) => item.id)).size === total,
      "all filtered pages contain exactly the matching gifts without duplicates",
    );
    return items;
  }
  async function search(value) {
    const input = page.locator("#management-artist-search");
    await input.fill(value);
    await change("ARTISTS", () => input.press("Enter"));
    assert(list("ARTISTS").page === 1, "artist name search resets to page one");
    return list("ARTISTS");
  }
  async function verifyGiftFilters(scope) {
    await section("GIFTS");
    const original = await allGiftPages();
    assert(
      original.length > 24,
      "real gift fixture spans at least three daily-list pages",
    );
    assert(
      original.some((item) => item.giftKind === "OTHER"),
      "all gifts retains legacy OTHER content",
    );
    assert(
      original.every((item) => !("sortPrice" in item)) &&
        !list("GIFTS").priceScope,
      "the default list preserves its original edit prices without comparison fields",
    );
    for (const value of kinds) {
      await kind(value);
      const expected = original.filter((item) => item.giftKind === value);
      const actual = await allGiftPages();
      assert(
        expected.some((item) => original.indexOf(item) >= 12) &&
          ids(actual) === ids(expected),
        `${value} filtering includes matches beyond the original first page in stable order`,
      );
    }
    await kind("ALL");
    // Independently read the currently published default-scope price for each representative
    // variant. All rows were created by the existing normal publication fixture; this is read-only.
    const canonical = await client.query(
      `SELECT v.gift_id,p.amount_minor::text AS amount
       FROM public.gift_variants v
       JOIN public.prices p ON p.gift_variant_id=v.id
       JOIN public.price_book_publication_heads h ON h.price_book_id=p.price_book_id AND h.price_book_revision=p.price_book_revision AND h.market=p.market AND h.currency=p.currency
       JOIN public.price_book_publications publication ON publication.id=h.publication_id
       JOIN public.price_books book ON book.id=h.price_book_id AND book.revision=h.price_book_revision
       JOIN public.markets market ON market.id=h.market_id AND market.status='ACTIVE'
       WHERE v.id=(SELECT chosen.id FROM public.gift_variants chosen WHERE chosen.gift_id=v.gift_id AND chosen.status<>'archived' ORDER BY chosen.created_at,chosen.id LIMIT 1)
       AND h.market=$1 AND h.currency=$2 AND v.gift_id=ANY($3::uuid[])
       AND book.valid_from<=transaction_timestamp() AND (book.valid_until IS NULL OR book.valid_until>transaction_timestamp())
       AND p.valid_from<=transaction_timestamp() AND (p.valid_to IS NULL OR p.valid_to>transaction_timestamp())
       AND ((publication.action='PUBLISH' AND p.status='PUBLISHED') OR (publication.action='ROLLBACK' AND p.status IN('PUBLISHED','SUPERSEDED')))`,
      [scope.market, scope.currency, original.map((item) => item.id)],
    );
    const amounts = new Map(
      canonical.rows.map((row) => [row.gift_id, Number(row.amount)]),
    );
    assert(
      amounts.size === canonical.rows.length,
      "each gift has one canonical comparison price at most",
    );
    assert(
      amounts.size < original.length,
      "the real fixture includes gifts without a comparison price",
    );
    assert(
      new Set(amounts.values()).size < amounts.size,
      "the real published book includes equal-price gifts to verify stable ties",
    );
    for (const direction of ["PRICE_ASC", "PRICE_DESC"]) {
      await sort(direction);
      const actual = await allGiftPages();
      const expected = [...original].sort((left, right) => {
        const a = amounts.get(left.id),
          b = amounts.get(right.id);
        if (a === undefined) return b === undefined ? 0 : 1;
        if (b === undefined) return -1;
        return direction === "PRICE_ASC" ? a - b : b - a;
      });
      assert(
        ids(actual) === ids(expected),
        `${direction} orders the entire result, keeps newest-first ties and puts missing prices last`,
      );
      assert(
        list("GIFTS").priceScope?.market === scope.market &&
          list("GIFTS").priceScope.currency === scope.currency,
        `${direction} states the actual management default price scope`,
      );
      for (const item of actual) {
        const amount = amounts.get(item.id);
        assert(
          amount === undefined
            ? item.sortPrice === null
            : item.sortPrice?.amountMinor === amount &&
                item.sortPrice.market === scope.market &&
                item.sortPrice.currency === scope.currency,
          `${direction} comparison price matches the current canonical book`,
        );
        assert(
          JSON.stringify(item.price) ===
            JSON.stringify(original.find((old) => old.id === item.id).price),
          "price sorting preserves the original edit price and currency",
        );
      }
      const repeated = await allGiftPages();
      assert(
        ids(repeated) === ids(actual),
        `${direction} repeats across pages without changing equal-price order`,
      );
    }
    await sort("PRICE_ASC");
    await giftPage(2);
    const before = list("GIFTS");
    const editable = before.items.find((item) => item.canEdit);
    assert(
      Boolean(editable),
      "a normally published editable gift is present on sorted page two",
    );
    await page.locator(`[data-management-item="${editable.id}"]`).click();
    await page.locator("[data-management-form]").waitFor();
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency: editable.price.currency,
    }).resolvedOptions().maximumFractionDigits;
    assert(
      Number(
        await page.locator('[data-management-field="price"]').inputValue(),
      ) *
        10 ** digits ===
        editable.price.amountMinor,
      "opening a sorted gift edits its original scoped price, not a substituted comparison price",
    );
    await back();
    assert(
      list("GIFTS").page === 2 &&
        ids(list("GIFTS").items) === ids(before.items),
      "returning from a gift editor preserves the second page and exact sorted results",
    );
    await expect(page.locator(sortButton("PRICE_ASC"))).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await sort("NEWEST");
    const restored = await allGiftPages();
    assert(
      ids(restored) === ids(original),
      "turning price order off restores the default complete order",
    );
    await giftPage(1);
  }
  async function verifyMatrix({ locale, sectionName, artistId, artistName }) {
    if (sectionName === "GIFTS") {
      for (const value of ["ALL", ...kinds]) {
        const button = page.locator(kindButton(value));
        await expect(button).toBeVisible();
        assert(
          Boolean((await button.innerText()).trim()),
          `${locale} gift filter has a visible label`,
        );
      }
      await kind("WISH");
      assert(
        list("GIFTS").items.length > 0 &&
          list("GIFTS").items.every((item) => item.giftKind === "WISH"),
        `${locale} wish filter displays real matching gifts`,
      );
      await sort("PRICE_ASC");
      await expect(page.locator("[data-management-gift-sort]")).toContainText(
        list("GIFTS").priceScope.currency,
      );
      await sort("NEWEST");
      await kind("ALL");
    } else if (sectionName === "ARTISTS") {
      const found = await search(artistName);
      assert(
        found.totalItems === 1 && found.items[0].id === artistId,
        `${locale} finds the original-language artist by name`,
      );
      await page.locator(`[data-management-item="${artistId}"]`).click();
      await page.locator("[data-management-form]").waitFor();
      await back();
      await expect(page.locator("#management-artist-search")).toHaveValue(
        artistName,
      );
      assert(
        list("ARTISTS").totalItems === 1 &&
          list("ARTISTS").items[0].id === artistId,
        `${locale} artist editor back retains the name search`,
      );
      const empty = await search(`no-match-${artistId}`);
      assert(
        empty.totalItems === 0 && empty.items.length === 0,
        `${locale} absent artist returns a real empty result`,
      );
      await expect(page.locator(".mc-empty")).toHaveAttribute("role", "status");
      await search("");
      assert(
        list("ARTISTS").totalItems > 1,
        `${locale} clearing the search restores the full artist list`,
      );
    }
  }
  async function verifyKeyboard() {
    await tabTo(kindButton("VIRTUAL"));
    await change("GIFTS", () => page.keyboard.press("Enter"));
    await expect(page.locator(kindButton("VIRTUAL"))).toBeFocused();
    assert(
      list("GIFTS").items.every((item) => item.giftKind === "VIRTUAL"),
      "keyboard gift filter reads the actual virtual gifts",
    );
    await tabTo(sortButton("PRICE_ASC"));
    await change("GIFTS", () => page.keyboard.press("Enter"));
    await expect(page.locator(sortButton("PRICE_ASC"))).toBeFocused();
    await sort("NEWEST");
    await kind("ALL");
  }
  return { verifyGiftFilters, verifyMatrix, verifyKeyboard };
}
