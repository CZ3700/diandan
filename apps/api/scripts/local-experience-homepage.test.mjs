import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import {
  buildLocalHomepageContent,
  localHomepagePlanSchema,
  createLocalHomepageLoop,
  startLocalHomepageBootstrap,
} from "./local-experience-homepage.mjs";

const source = () => ({
  idolId: randomUUID(),
  idolRevisionId: randomUUID(),
  displayName: "Local Artist",
  desktopMediaAssetId: randomUUID(),
  desktopMediaMetadataRevisionId: randomUUID(),
  mobileMediaAssetId: randomUUID(),
  mobileMediaMetadataRevisionId: randomUUID(),
});
test("homepage SEO bounds long ASCII names while keeping ordinary persisted fields unchanged", () => {
  for (const length of [59, 60, 61, 80]) {
    const artist = { ...source(), displayName: "A".repeat(length) };
    const content = buildLocalHomepageContent(artist);
    for (const { fields } of content.translations) {
      assert.equal(fields.seoTitle, "A".repeat(Math.min(length, 60)));
      assert.equal(fields.heroTitle, artist.displayName);
      assert.equal(fields.slotLabels[0].label, artist.displayName);
    }
    assert.ok(
      localHomepagePlanSchema.safeParse({
        schemaVersion: 1,
        testOnly: true,
        source: artist,
        content,
        sessionIds: [],
      }).success,
    );
  }
});
test("homepage SEO truncates Unicode at intact grapheme boundaries within the canonical UTF-16 limit", () => {
  const cases = [
    ["星".repeat(80), "星".repeat(60)],
    ["🎁".repeat(40), "🎁".repeat(30)],
    ["A".repeat(59) + "🎁".repeat(10), "A".repeat(59)],
    ["A".repeat(59) + "e\u0301".repeat(10), "A".repeat(59)],
    ["👨‍👩‍👧‍👦".repeat(7), "👨‍👩‍👧‍👦".repeat(5)],
    ["A" + "\u0301".repeat(70), "A"],
    [" ".repeat(70) + "Artist", "Artist"],
  ];
  for (const [displayName, expected] of cases) {
    const content = buildLocalHomepageContent({ ...source(), displayName });
    for (const { fields } of content.translations) {
      assert.equal(fields.seoTitle, expected);
      assert.ok(fields.seoTitle.length <= 60);
      assert.ok(fields.seoTitle.isWellFormed());
      assert.equal(fields.heroTitle, displayName);
      assert.equal(fields.slotLabels[0].label, displayName);
    }
  }
});
test("first homepage uses only the actual artist, distinct current heroes and delivery policy in all seven locales", () => {
  const artist = source(),
    content = buildLocalHomepageContent(artist);
  assert.equal(content.kind, "HOMEPAGE");
  assert.deepEqual(
    content.structure.slots.map((slot) => slot.kind),
    ["HERO_IDOL", "FEATURED_IDOL", "POLICY_LINK"],
  );
  assert.equal(
    content.structure.slots[0].desktopMediaAssetId,
    artist.desktopMediaAssetId,
  );
  assert.equal(
    content.structure.slots[0].mobileMediaAssetId,
    artist.mobileMediaAssetId,
  );
  assert.deepEqual(
    content.translations.map((row) => row.locale),
    [...SUPPORTED_LOCALES],
  );
  assert.ok(
    content.translations.every((row) => row.fields.slotLabels.length === 3),
  );
  assert.throws(() =>
    buildLocalHomepageContent({
      ...artist,
      mobileMediaAssetId: artist.desktopMediaAssetId,
    }),
  );
});
test("persisted homepage plan rejects unrelated content and inconsistent original artist identity", () => {
  const artist = source(),
    content = buildLocalHomepageContent(artist);
  const plan = {
    schemaVersion: 1,
    testOnly: true,
    source: artist,
    content,
    sessionIds: [],
  };
  assert.ok(localHomepagePlanSchema.safeParse(plan).success);
  assert.equal(
    localHomepagePlanSchema.safeParse({ ...plan, source: source() }).success,
    false,
  );
  assert.equal(
    localHomepagePlanSchema.safeParse({ ...plan, content: { kind: "IDOL" } })
      .success,
    false,
  );
});
test("homepage polling drains an in-flight request, never overlaps, and stops after preservation or creation", async () => {
  let release,
    calls = 0;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const loop = createLocalHomepageLoop({
    intervalMs: 2,
    run: async () => {
      calls++;
      await waiting;
      return { done: true, outcome: "PRESERVED" };
    },
  });
  const running = loop.runOnce();
  assert.equal(loop.runOnce(), running);
  let stopped = false;
  const stopping = loop.stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await stopping;
  assert.equal(calls, 1);
  assert.equal((await loop.runOnce()).outcome, "STOPPED");
});
test("homepage bootstrap refuses non-TEST context before any connection", async () => {
  await assert.rejects(
    startLocalHomepageBootstrap({
      config: { environment: "PRODUCTION" },
      database: { host: "127.0.0.1" },
      own: () => undefined,
    }),
  );
});

test("an existing homepage is preserved without any authoring request", async () => {
  const { publishLocalHomepage } =
    await import("./local-experience-homepage-publish.mjs");
  let httpCalls = 0;
  const result = await publishLocalHomepage({
    client: { query: async () => ({ rowCount: 1 }) },
    content: {
      request: () => {
        httpCalls++;
      },
    },
  });
  assert.equal(result.outcome, "PRESERVED");
  assert.equal(httpCalls, 0);
});
test("a concurrently published homepage stops bootstrap at the normal publication preflight without overwrite", async () => {
  const { publishLocalHomepage } =
    await import("./local-experience-homepage-publish.mjs");
  const contentValue = buildLocalHomepageContent(source()),
    writes = [];
  const result = await publishLocalHomepage({
    client: { query: async () => ({ rowCount: 0 }) },
    plan: { content: contentValue, revisionId: randomUUID() },
    content: {
      request: async (route) => {
        if (route.endsWith("content-authoring/read"))
          return {
            snapshot: {
              content: contentValue,
              lifecycle: { status: "VALIDATED" },
            },
          };
        if (route.endsWith("content-review/read"))
          return { context: { audit: { review: { status: "APPROVED" } } } };
        return { headVersion: 1, ready: true };
      },
      write: async (...args) => {
        writes.push(args);
      },
    },
  });
  assert.equal(result.outcome, "PRESERVED");
  assert.deepEqual(writes, []);
});
test("validated homepage recovery publishes with version-zero CAS and never reauthors or rereviews", async () => {
  const { publishLocalHomepage } =
    await import("./local-experience-homepage-publish.mjs");
  const contentValue = buildLocalHomepageContent(source()),
    writes = [],
    revisionId = randomUUID();
  const result = await publishLocalHomepage({
    client: { query: async () => ({ rowCount: 0 }) },
    plan: { content: contentValue, revisionId },
    content: {
      request: async (route) => {
        if (route.endsWith("content-authoring/read"))
          return {
            snapshot: {
              content: contentValue,
              lifecycle: { status: "VALIDATED" },
            },
          };
        if (route.endsWith("content-review/read"))
          return { context: { audit: { review: { status: "APPROVED" } } } };
        return { headVersion: 0, ready: true, contentHash: "current" };
      },
      write: async (...args) => {
        writes.push(args);
      },
    },
  });
  assert.equal(result.outcome, "CREATED");
  assert.equal(writes.length, 1);
  assert.ok(writes[0][0].endsWith("/publish"));
  assert.equal(writes[0][1].expectedVersion, 0);
  assert.equal(writes[0][1].target.revisionId, revisionId);
});

test("temporary homepage sessions are recorded before creation and revoked when HTTP work fails", async () => {
  const { withLocalHomepageSessions } =
    await import("./local-experience-homepage-sessions.mjs");
  const { randomBytes } = await import("node:crypto");
  const events = [],
    recorded = [];
  const config = {
    environment: "LOCAL_TEST",
    origins: { admin: "https://admin.example.invalid:45432" },
    secrets: { tokenPepper: randomBytes(32).toString("base64url") },
    services: {
      oidc: {
        actors: ["manager", "reviewer"].map((key) => ({
          key,
          id: randomUUID(),
        })),
      },
    },
  };
  await assert.rejects(
    withLocalHomepageSessions(
      {
        config,
        base: "http://127.0.0.1:45431",
        client: {
          query: async (sql, values) => {
            events.push(sql.startsWith("INSERT") ? "insert" : "revoke");
            if (sql.startsWith("UPDATE"))
              assert.deepEqual(values[0], recorded[0]);
          },
        },
        saveSessionIds: async (ids) => {
          recorded.push([...ids]);
          events.push(ids.length ? "record" : "clear");
        },
      },
      async () => {
        throw new Error("synthetic request failure");
      },
    ),
    /synthetic request/,
  );
  assert.deepEqual(events, ["record", "insert", "insert", "revoke", "clear"]);
  assert.equal(recorded[0].length, 2);
  assert.deepEqual(recorded[1], []);
});
