import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { expect, test } from "vitest";

const exampleUrl = new URL("../../../.env.example", import.meta.url);

function readExample(): {
  keys: string[];
  values: ReturnType<typeof parseEnv>;
} {
  const text = readFileSync(exampleUrl, "utf8");
  const keys = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line, index) => {
      const separator = line.indexOf("=");

      if (separator <= 0) {
        throw new Error(`Invalid .env.example syntax at entry ${index + 1}`);
      }

      const key = line.slice(0, separator);
      if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) {
        throw new Error(`Invalid .env.example key at entry ${index + 1}`);
      }

      return key;
    });

  try {
    return { keys, values: parseEnv(text) };
  } catch {
    throw new Error("Invalid .env.example syntax");
  }
}

test("documents every runtime environment variable once", () => {
  expect(existsSync(exampleUrl), "root .env.example must exist").toBe(true);
  if (!existsSync(exampleUrl)) {
    return;
  }

  const { keys, values } = readExample();

  const expectedKeys = [
    "NODE_ENV",
    "FAN_SUPPORT_DEPLOYMENT_ENV",
    "FAN_SUPPORT_SITE_ORIGIN",
    "FAN_SUPPORT_DATABASE_URL",
  ];

  if (keys.length !== new Set(keys).size) {
    throw new Error(".env.example contains a duplicate key");
  }
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !keys.includes(key))
  ) {
    throw new Error(
      ".env.example runtime keys do not match the config contract",
    );
  }
  expect(Object.keys(values)).toHaveLength(keys.length);
});

test("leaves credential-bearing example values empty", () => {
  expect(existsSync(exampleUrl), "root .env.example must exist").toBe(true);
  if (!existsSync(exampleUrl)) {
    return;
  }

  const { values } = readExample();

  expect(values["FAN_SUPPORT_DATABASE_URL"]).toBe("");
});
