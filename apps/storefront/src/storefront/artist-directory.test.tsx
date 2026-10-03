import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { StorefrontCopy } from "./copy";
import { directoryFixturePage } from "./directory-fixture";

const copy = new Proxy(
  {},
  { get: (_target, key) => String(key) },
) as StorefrontCopy;

it("places artist names and empty state immediately below the containing section heading", async () => {
  const { ArtistDirectory } = await import("./artist-directory");
  for (const headingLevel of [1, 2] as const) {
    const html = renderToStaticMarkup(
      <ArtistDirectory
        locale="en"
        copy={copy}
        initial={directoryFixturePage([1])}
        headingLevel={headingLevel}
      />,
    );
    expect(html).toContain(
      `<h${headingLevel + 1}>Fictional 1</h${headingLevel + 1}>`,
    );
    const empty = renderToStaticMarkup(
      <ArtistDirectory
        locale="en"
        copy={copy}
        initial={directoryFixturePage([])}
        headingLevel={headingLevel}
      />,
    );
    expect(empty).toContain(
      `<h${headingLevel + 1}>artistEmptyTitle</h${headingLevel + 1}>`,
    );
  }
});

// L2-15: the server cannot know the scroll position, so no card is raised before hydration.
it("server renders the artist track flat, ready for the wave", async () => {
  const { ArtistDirectory } = await import("./artist-directory");
  const html = renderToStaticMarkup(
    <ArtistDirectory
      locale="en"
      copy={copy}
      initial={directoryFixturePage([1, 2, 3])}
      headingLevel={2}
    />,
  );
  expect(html.match(/data-artist-card=/gu)?.length).toBe(3);
  expect(html).not.toContain("data-wave");
});

it("server renders a named search and explicit failure recovery without fake artist cards", async () => {
  const loaded = await import("./artist-directory").catch(() => undefined);
  expect(
    loaded,
    "artist directory must server render the real read state",
  ).toBeDefined();
  const { ArtistDirectory } = loaded!;
  const html = renderToStaticMarkup(
    <ArtistDirectory
      locale="en"
      copy={copy}
      initial={{
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CATALOG_UNAVAILABLE",
      }}
    />,
  );
  expect(html).toContain('role="combobox"');
  expect(html).toContain("artistSearchLabel");
  expect(html).toContain("artistLoadError");
  expect(html).toContain("artistRetry");
  expect(html).not.toContain('data-artist-card="');
});

it("retains crawlable paused artist details and real IDs with commercial query context", async () => {
  const loaded = await import("./artist-directory").catch(() => undefined);
  expect(
    loaded,
    "artist browsing must be available while gifting is paused",
  ).toBeDefined();
  const { ArtistDirectory } = loaded!;
  const initial = directoryFixturePage([1]);
  if (initial.outcome !== "SUCCESS") throw new Error("Invalid fixture");
  initial.items[0]!.status = "paused";
  initial.items[0]!.acceptingGifts = false;
  const html = renderToStaticMarkup(
    <ArtistDirectory
      locale="en"
      copy={copy}
      initial={initial}
      contextQuery="market=TEST&currency=USD"
    />,
  );
  expect(html).toContain('data-accepting="false"');
  expect(html).toContain(
    'href="/en/idols/fictional-1?market=TEST&amp;currency=USD"',
  );
  expect(html).toContain("artistPaused");
  expect(html).toContain('loading="lazy"');
  expect(html).toContain(
    'data-artist-card="a0000000-0000-4000-8000-000000000001"',
  );
});

it("renders a distinct empty state with no retry loop or invented artists", async () => {
  const loaded = await import("./artist-directory").catch(() => undefined);
  expect(
    loaded,
    "artist directory must implement an empty published catalog",
  ).toBeDefined();
  const { ArtistDirectory } = loaded!;
  const html = renderToStaticMarkup(
    <ArtistDirectory
      locale="ja"
      copy={copy}
      initial={{
        schemaVersion: 1,
        outcome: "SUCCESS",
        catalogVersion: "a".repeat(64),
        items: [],
        pageInfo: { schemaVersion: 1, hasNextPage: false, endCursor: null },
      }}
    />,
  );
  expect(html).toContain("artistEmptyTitle");
  expect(html).toContain("artistEmptyDescription");
  expect(html).not.toContain("artistLoadMore");
});

it("leaves the search to the homepage section title when asked", async () => {
  const { ArtistDirectory } = await import("./artist-directory");
  const html = renderToStaticMarkup(
    <ArtistDirectory
      locale="en"
      copy={copy}
      initial={directoryFixturePage([1])}
      search={false}
    />,
  );
  expect(html).not.toContain("data-artist-search");
  expect(html).toContain("Fictional 1");
});
