import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

test("pins the Drizzle query layer to the reviewed version", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as Readonly<{
    dependencies?: Readonly<Record<string, string>>;
  }>;

  expect(manifest.dependencies?.["drizzle-orm"]).toBe("0.45.2");
});

test("depends on the supplier-free persistence port boundary", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as Readonly<{
    dependencies?: Readonly<Record<string, string>>;
  }>;

  expect(manifest.dependencies?.["@fan-support/persistence-port"]).toBe(
    "workspace:*",
  );
});

test("declares every workspace package imported by the runtime adapter", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as Readonly<{
    dependencies?: Readonly<Record<string, string>>;
  }>;

  expect(manifest.dependencies?.["@fan-support/contracts"]).toBe("workspace:*");
});

test("keeps the repository harness in the PostgreSQL integration gate", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as Readonly<{
    scripts?: Readonly<Record<string, string>>;
  }>;

  expect(manifest.scripts?.["test:postgres"]).toContain(
    "node ./scripts/postgres-repositories.mjs",
  );
});

test("keeps the key-version migration harness in the PostgreSQL integration gate", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as Readonly<{
    scripts?: Readonly<Record<string, string>>;
  }>;

  expect(manifest.scripts?.["test:postgres"]).toContain(
    "node ./scripts/postgres-key-version-upgrade.mjs",
  );
});

test("keeps the media-object-key migration harness in the PostgreSQL integration gate", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as Readonly<{
    scripts?: Readonly<Record<string, string>>;
  }>;

  expect(manifest.scripts?.["test:postgres"]).toContain(
    "node ./scripts/postgres-media-object-key-upgrade.mjs",
  );
});

test("keeps the typed outbox-status migration harness in the PostgreSQL integration gate", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as Readonly<{
    scripts?: Readonly<Record<string, string>>;
  }>;

  expect(manifest.scripts?.["test:postgres"]).toContain(
    "node ./scripts/postgres-outbox-status-upgrade.mjs",
  );
});
