import assert from "node:assert/strict";
import test from "node:test";
import {
  selectAcceptanceSitemapShard,
  waitForAcceptanceVisibility,
} from "./storefront-acceptance-visibility.mjs";

test("visibility cannot bypass stale root or locale indexes using an API-derived shard URL", () => {
  const origin = "https://test.invalid";
  const current = `${origin}/ja/sitemap.xml?cursor=current`;
  const stale = `${origin}/ja/sitemap.xml?cursor=old`;
  const index = (url) => ({ root: "sitemapindex", errors: 0, sitemaps: [url] });
  const query = { origin, locale: "ja", cursor: "current" };
  assert.equal(
    selectAcceptanceSitemapShard({
      ...query,
      root: index(stale),
      localeIndex: index(current),
    }),
    null,
  );
  assert.equal(
    selectAcceptanceSitemapShard({
      ...query,
      root: index(current),
      localeIndex: index(stale),
    }),
    null,
  );
  assert.equal(
    selectAcceptanceSitemapShard({
      ...query,
      root: index(current),
      localeIndex: index(current),
    }),
    current,
  );
  assert.equal(
    selectAcceptanceSitemapShard({
      ...query,
      root: index(current),
      localeIndex: { ...index(current), sitemaps: [current, current] },
    }),
    null,
  );
});

test("publication visibility retains stale observations before all representations converge", async () => {
  let clock = 0;
  const result = await waitForAcceptanceVisibility({
    started: 0,
    now: () => clock,
    pause: async () => {
      clock += 1000;
    },
    probe: async () => ({
      ready: clock >= 2000,
      api: true,
      html: clock >= 2000,
    }),
  });
  assert.equal(result.pass, true);
  assert.equal(result.elapsedMs, 2000);
  assert.equal(result.observations.length, 3);
  assert.equal(result.observations[0].html, false);
});

test("a representation still stale at sixty seconds fails without extending the budget", async () => {
  let clock = 0;
  const result = await waitForAcceptanceVisibility({
    started: 0,
    now: () => clock,
    pause: async () => {
      clock += 10000;
    },
    probe: async () => ({ ready: false }),
  });
  assert.equal(result.pass, false);
  assert.equal(result.elapsedMs, 60000);
  assert.equal(result.observations.length, 6);
});
