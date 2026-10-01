import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  LOCAL_DEFAULT_LOCATION_CODE,
  applyLocalDefaultInventoryLocation,
  ensureLocalDefaultInventoryLocation,
} from "./local-experience-default-location.mjs";

const defaults = (locationId = null) => ({
  id: randomUUID(),
  version: 1,
  market: "GLOBAL",
  currency: "USD",
  inventory_location_id: locationId,
  eligibility_rule: "ALL_ACTIVE_ARTISTS",
  artist_presentation: { themeAccent: "#CCAE7F", heroTextTone: "light" },
});
function fakeClient({ published, location, superseded = 1 }) {
  const statements = [];
  return {
    statements,
    async query(sql, values = []) {
      statements.push({ sql, values });
      if (sql.includes("FROM public.management_defaults d"))
        return { rows: published, rowCount: published.length };
      if (sql.includes("FROM public.inventory_locations"))
        return { rows: location ? [location] : [], rowCount: location ? 1 : 0 };
      if (sql.includes("lifecycle='SUPERSEDED'"))
        return { rows: [], rowCount: superseded };
      return { rows: [], rowCount: 1 };
    },
  };
}
const managerId = randomUUID();

test("defaults that already name a location are kept without a session or a new version", async () => {
  const locationId = randomUUID(),
    client = fakeClient({ published: [defaults(locationId)] });
  let created = 0;
  const result = await applyLocalDefaultInventoryLocation({
    client,
    managerId,
    createLocation: async () => {
      created++;
    },
  });
  assert.deepEqual(result, { outcome: "PRESERVED", locationId });
  assert.equal(created, 0);
  assert.equal(client.statements.length, 1);
});

test("an instance without a default creates the studio location once and publishes the next defaults version", async () => {
  const current = defaults(),
    locationId = randomUUID(),
    client = fakeClient({ published: [current] }),
    codes = [];
  const result = await applyLocalDefaultInventoryLocation({
    client,
    managerId,
    createLocation: async (code) => {
      codes.push(code);
      return locationId;
    },
  });
  assert.deepEqual(result, { outcome: "CONFIGURED", locationId });
  assert.deepEqual(codes, [LOCAL_DEFAULT_LOCATION_CODE]);
  const writes = client.statements.slice(2);
  assert.deepEqual(
    writes.map(({ sql }) => sql.split(" ").slice(0, 3).join(" ")),
    [
      "BEGIN",
      "INSERT INTO public.config_versions(id,config_kind,version,lifecycle,created_by)",
      "INSERT INTO public.management_defaults(config_version_id,market,currency,inventory_policy,inventory_location_id,eligibility_rule,artist_presentation)",
      "UPDATE public.config_versions SET",
      "UPDATE public.config_versions SET",
      "UPDATE public.config_versions SET",
      "COMMIT",
    ],
  );
  const next = writes[1].values[0];
  assert.deepEqual(writes[1].values, [next, 2, managerId]);
  assert.match(writes[2].sql, /'TRACKED'/u);
  assert.deepEqual(writes[2].values, [
    next,
    "GLOBAL",
    "USD",
    locationId,
    "ALL_ACTIVE_ARTISTS",
    current.artist_presentation,
  ]);
  // The old version leaves PUBLISHED before the new one enters it (one published version per kind).
  assert.match(writes[3].sql, /lifecycle='VALIDATED'/u);
  assert.deepEqual(writes[3].values, [next]);
  assert.match(
    writes[4].sql,
    /lifecycle='SUPERSEDED' WHERE id=\$1 AND lifecycle='PUBLISHED'/u,
  );
  assert.deepEqual(writes[4].values, [current.id]);
  assert.match(
    writes[5].sql,
    /lifecycle='PUBLISHED',published_at=clock_timestamp\(\)/u,
  );
  assert.deepEqual(writes[5].values, [next]);
});

test("an existing active studio location is reused without another commerce request", async () => {
  const locationId = randomUUID(),
    client = fakeClient({
      published: [defaults()],
      location: { id: locationId, status: "ACTIVE" },
    });
  const result = await applyLocalDefaultInventoryLocation({
    client,
    managerId,
    createLocation: async () => assert.fail("must not create a duplicate"),
  });
  assert.deepEqual(result, { outcome: "CONFIGURED", locationId });
});

test("a paused studio location stops before any defaults version is written", async () => {
  const client = fakeClient({
    published: [defaults()],
    location: { id: randomUUID(), status: "PAUSED" },
  });
  await assert.rejects(
    applyLocalDefaultInventoryLocation({
      client,
      managerId,
      createLocation: async () => assert.fail("must not create"),
    }),
    /LOCAL_DEFAULT_LOCATION_INACTIVE/u,
  );
  assert.ok(!client.statements.some(({ sql }) => sql === "BEGIN"));
});

test("defaults replaced concurrently roll the new version back", async () => {
  const client = fakeClient({ published: [defaults()], superseded: 0 });
  await assert.rejects(
    applyLocalDefaultInventoryLocation({
      client,
      managerId,
      createLocation: async () => randomUUID(),
    }),
    /LOCAL_MANAGEMENT_DEFAULTS_CHANGED/u,
  );
  assert.equal(client.statements.at(-1).sql, "ROLLBACK");
  assert.ok(!client.statements.some(({ sql }) => sql === "COMMIT"));
});

test("missing published defaults are an error, not a silent skip", async () => {
  await assert.rejects(
    applyLocalDefaultInventoryLocation({
      client: fakeClient({ published: [] }),
      managerId,
      createLocation: async () => assert.fail("must not create"),
    }),
    /LOCAL_MANAGEMENT_DEFAULTS_UNAVAILABLE/u,
  );
});

test("the startup step refuses a non-TEST instance before any connection", async () => {
  await assert.rejects(
    ensureLocalDefaultInventoryLocation({
      config: { environment: "PRODUCTION" },
      database: { host: "127.0.0.1", port: 1 },
      business: { managerId },
    }),
    /requires local TEST/u,
  );
});
