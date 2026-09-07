import { expect, test } from "vitest";
test("restores an anchor on both home and directory while refusing duplicate or invalid identifiers", async () => {
  const loaded = await import("./directory-query.js").catch(() => undefined);
  expect(loaded).toBeDefined();
  if (!loaded) return;
  const id = "8e640170-7d4f-4e3d-b9a8-4a51d30ef123";
  expect(loaded.prepareDirectoryQuery("ja", id)).toEqual({
    valid: true,
    query: `locale=ja&anchorId=${id}`,
    anchor: id,
  });
  expect(loaded.prepareDirectoryQuery("en", [id, id]).valid).toBe(false);
  expect(loaded.prepareDirectoryQuery("en", "not-an-id").valid).toBe(false);
  expect(loaded.prepareDirectoryQuery("en", undefined)).toEqual({
    valid: true,
    query: "locale=en",
  });
});
test("links after search keep the selected anchor and every commerce value, including duplicates", async () => {
  const loaded = (await import("./directory-query.js")) as unknown as Record<
    string,
    (query: string, anchor?: string) => string
  >;
  expect(typeof loaded["directoryContextQuery"]).toBe("function");
  const update = loaded["directoryContextQuery"];
  if (!update) return;
  const id = "8e640170-7d4f-4e3d-b9a8-4a51d30ef123";
  const query = `cart=a&cart=b&currency=USD&market=test&attempt=t&q=old&after=old&anchorId=old`;
  expect(update(query, id)).toBe(
    `cart=a&cart=b&currency=USD&market=test&attempt=t&anchorId=${id}`,
  );
  expect(update(query)).toBe(
    "cart=a&cart=b&currency=USD&market=test&attempt=t",
  );
});
