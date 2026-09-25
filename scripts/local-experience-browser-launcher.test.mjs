import test from "node:test";
import assert from "node:assert/strict";
import { URL, URLSearchParams } from "node:url";
import { localBrowserUrls } from "./local-experience-browser-launcher.mjs";

test("the user launcher passes the mail token in the same fragment parameter as the authenticated inbox", () => {
  const config = {
    origins: {
      storefront: "https://storefront.example.invalid:1234",
      admin: "https://admin.example.invalid:1235",
      mail: "https://mail.example.invalid:1236",
    },
    services: { mail: { viewerToken: "test+token/value" } },
  };
  const urls = localBrowserUrls(config);
  assert.deepEqual(urls.slice(0, 2), [
    config.origins.storefront + "/en",
    config.origins.admin,
  ]);
  const mail = new URL(urls[2]);
  assert.equal(mail.origin, config.origins.mail);
  assert.equal(mail.search, "", "Viewer credentials never enter an HTTP query");
  assert.equal(
    new URLSearchParams(mail.hash.slice(1)).get("token"),
    config.services.mail.viewerToken,
  );
});
