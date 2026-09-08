import { expect, test } from "vitest";
import {
  idolDirectoryRecordSchema,
  giftDirectoryRecordSchema,
} from "./catalog-directory.js";

test("daily directory records require their complete publication proof, never a claimed approval or bare public view", () => {
  for (const schema of [idolDirectoryRecordSchema, giftDirectoryRecordSchema]) {
    expect(
      schema.safeParse({ schemaVersion: 3, context: { approved: true } })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        schemaVersion: 3,
        source: { displayName: "Artist" },
        selection: {},
      }).success,
    ).toBe(false);
  }
});
