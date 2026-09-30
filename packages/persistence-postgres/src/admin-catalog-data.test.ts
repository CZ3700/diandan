import { expect, test, vi } from "vitest";
import type { AdminCatalogWriteCommand } from "@fan-support/contracts";
import { identityEventTime, mapCatalogOwner } from "./admin-catalog-data.js";

const id = "e95a65da-d2d0-420c-a1ba-f6921c45c741";
const artist = {
  owner: {
    id,
    handle: "idol-generated",
    status: "active",
    version: 1,
    draft_revision_id: null,
    accepting_gifts: true,
    created_at: "2026-09-07T00:00:00.000001Z",
  },
  latest: { id },
  head: { version: 1, idol_revision_id: id },
  label: "原语言艺人",
  authoring_version: "1",
  portrait_object_key: "public/portrait.webp",
};

test("artist summaries expose only the safe public portrait with its resolved name", () => {
  const owner = mapCatalogOwner(
    "IDOL",
    artist,
    "ja",
    "https://media.example.test/assets",
  );
  expect(owner).toMatchObject({
    label: artist.label,
    image: {
      url: "https://media.example.test/assets/public/portrait.webp",
      alt: artist.label,
    },
  });
  expect(owner).not.toHaveProperty("portrait_object_key");
});

test("missing or unsafe portrait metadata leaves a usable artist summary without leaking the source", () => {
  for (const key of [
    null,
    "../private/source.webp",
    "https://evil.example.test/a.webp",
  ])
    expect(
      mapCatalogOwner(
        "IDOL",
        { ...artist, portrait_object_key: key },
        "en",
        "https://media.example.test/assets",
      ).image,
    ).toBeNull();
  expect(mapCatalogOwner("IDOL", artist, "en").image).toBeNull();
  expect(
    mapCatalogOwner(
      "IDOL",
      { ...artist, label: null },
      "en",
      "https://media.example.test",
    ).image,
  ).toBeNull();
});

test("other catalog owner summaries do not acquire artist-only image fields", () => {
  expect(
    mapCatalogOwner("GIFT", artist, "en", "https://media.example.test"),
  ).not.toHaveProperty("image");
});

test("identity event time preserves database microseconds and exact prior history without reusing a prior wall-clock observation", async () => {
  const at = "2026-09-07T01:02:03.123456Z";
  const prior = "2026-09-07T01:02:03.123455Z";
  const query = vi.fn(async (...arguments_: unknown[]) => {
    void arguments_;
    return {
      rows: [
        {
          id: "receipt",
          audit_id: "audit",
          idol_id: "idol",
          redirect_id: "redirect",
          at,
        },
      ],
    };
  });
  const input = {
    principal: {
      sessionId: "session",
      authorizedAt: "2026-09-07T01:02:05.123456Z",
    },
  } as AdminCatalogWriteCommand;
  const result = await identityEventTime({ query, release: vi.fn() }, input, {
    updated_at: prior,
  });
  expect(result.at).toBe(at);
  expect(query.mock.calls[0]?.[1]).toEqual(["session", prior]);
});

test("missing canonical session cannot manufacture an identity event timestamp", async () => {
  const query = vi.fn(async () => ({ rows: [] }));
  await expect(
    identityEventTime(
      { query, release: vi.fn() },
      { principal: { sessionId: "missing" } } as AdminCatalogWriteCommand,
      undefined,
    ),
  ).rejects.toThrow("Missing canonical session");
});
