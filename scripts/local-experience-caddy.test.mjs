import assert from "node:assert/strict";
import test from "node:test";
import { renderLocalExperienceCaddyfile } from "./local-experience-caddy.mjs";

const hash = "$2a$14$" + "a".repeat(53);
const config = {
  instance: "stg",
  exposure: { mode: "PUBLIC", baseDomain: "stg.example.com" },
  origins: Object.fromEntries(
    ["storefront", "admin", "oidc", "psp", "mail", "media"].map((key) => [
      key,
      `https://${key === "psp" ? "payments" : key}.stg.example.com`,
    ]),
  ),
  ports: {
    storefront: 41001,
    admin: 41002,
    oidc: 41003,
    psp: 41004,
    mail: 41005,
    media: 41006,
    s3: 41007,
  },
};
const site = (text, host) =>
  text.slice(
    text.indexOf(`${host} {`),
    text.indexOf("\n}\n", text.indexOf(`${host} {`)),
  );

test("the edge guards only the TEST identity picker, admin and captured mail", () => {
  const text = renderLocalExperienceCaddyfile({
    config,
    authUser: "tester",
    authHash: hash,
    caPath: "/etc/caddy/fan-support-local-ca.crt",
  });
  for (const host of ["admin", "mail"])
    assert.match(site(text, `${host}.stg.example.com`), /basic_auth \{/u);
  assert.match(
    site(text, "oidc.stg.example.com"),
    /@picker path \/authorize\n\tbasic_auth @picker \{/u,
  );
  for (const host of ["storefront", "payments", "media", "s3"])
    assert.doesNotMatch(site(text, `${host}.stg.example.com`), /basic_auth/u);
  assert.match(
    site(text, "payments.stg.example.com"),
    /https:\/\/127\.0\.0\.1:41004[\s\S]*tls_server_name payments\.stg\.example\.com/u,
  );
  assert.match(
    site(text, "s3.stg.example.com"),
    /https:\/\/127\.0\.0\.1:41007[\s\S]*tls_server_name localhost/u,
  );
  assert.doesNotMatch(text, /password/iu);
});

test("the edge refuses loopback instances, plaintext secrets and odd paths", () => {
  const input = {
    config,
    authUser: "tester",
    authHash: hash,
    caPath: "/etc/caddy/ca.crt",
  };
  assert.throws(
    () =>
      renderLocalExperienceCaddyfile({
        ...input,
        config: { ...config, exposure: undefined },
      }),
    /publicly exposed/u,
  );
  assert.throws(
    () => renderLocalExperienceCaddyfile({ ...input, authHash: "hunter2" }),
    /bcrypt/u,
  );
  assert.throws(
    () => renderLocalExperienceCaddyfile({ ...input, caPath: "relative/ca" }),
    /CA path/u,
  );
});
