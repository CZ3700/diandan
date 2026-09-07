import assert from "node:assert/strict";
import test from "node:test";
import { collectAcceptanceSeoIndex } from "./storefront-acceptance-seo.mjs";

const check = (condition, label) => assert.ok(condition, label);
test("sitemap traversal rejects duplicate owners across otherwise valid shard descriptors", async () => {
  const entity = { locator: { kind: "HOMEPAGE" } };
  const read = async (route) =>
    route.includes("catalog")
      ? {
          outcome: "SUCCESS",
          catalogVersion: "v",
          shards: [
            { cursor: "a", itemCount: 1 },
            { cursor: "b", itemCount: 1 },
          ],
          pageInfo: { endCursor: null },
        }
      : { outcome: "SUCCESS", catalogVersion: "v", items: [entity] };
  await assert.rejects(collectAcceptanceSeoIndex(read, check), /duplicate/);
});
test("sitemap traversal cannot silently skip a descriptor with a wrong item count", async () => {
  const read = async (route) =>
    route.includes("catalog")
      ? {
          outcome: "SUCCESS",
          catalogVersion: "v",
          shards: [{ cursor: "a", itemCount: 2 }],
          pageInfo: { endCursor: null },
        }
      : {
          outcome: "SUCCESS",
          catalogVersion: "v",
          items: [{ locator: { kind: "HOMEPAGE" } }],
        };
  await assert.rejects(collectAcceptanceSeoIndex(read, check), /count/);
});
test("sitemap traversal checks one version and visits every descriptor", async () => {
  const pages = {
    "/catalog": {
      outcome: "SUCCESS",
      catalogVersion: "v",
      shards: [{ cursor: "a", itemCount: 1 }],
      pageInfo: { endCursor: "c" },
    },
    "/catalog?cursor=c": {
      outcome: "SUCCESS",
      catalogVersion: "v",
      shards: [{ cursor: "b", itemCount: 1 }],
      pageInfo: { endCursor: null },
    },
    "/index?cursor=a": {
      outcome: "SUCCESS",
      catalogVersion: "v",
      items: [{ locator: { kind: "HOMEPAGE" } }],
    },
    "/index?cursor=b": {
      outcome: "SUCCESS",
      catalogVersion: "v",
      items: [{ locator: { kind: "POLICY", policyKey: "delivery" } }],
    },
  };
  const result = await collectAcceptanceSeoIndex(
    async (route) => pages[route],
    check,
  );
  assert.equal(result.entities.length, 2);
  assert.equal(result.descriptors.length, 2);
});
