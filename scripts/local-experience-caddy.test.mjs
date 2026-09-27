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
    bindAddresses: ["172.26.5.34"],
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
  for (const host of [
    "storefront",
    "admin",
    "oidc",
    "payments",
    "mail",
    "media",
    "s3",
  ])
    assert.match(
      site(text, `${host}.stg.example.com`),
      /reverse_proxy https:\/\/127\.0\.0\.\d:\d+ \{\n\t\theader_up Host \{host\}\n/u,
      `${host} keeps the public Host`,
    );
  // Web servers own 443 on their loopback addresses; the edge binds only explicit addresses.
  assert.match(text, /^\{\n\tdefault_bind 127\.0\.0\.1 172\.26\.5\.34\n\}/mu);
  assert.match(
    site(text, "storefront.stg.example.com"),
    /reverse_proxy https:\/\/127\.0\.0\.2:443 /u,
  );
  assert.match(
    site(text, "admin.stg.example.com"),
    /reverse_proxy https:\/\/127\.0\.0\.3:443 /u,
  );
  // The admin root placeholder sends operators to the management center.
  assert.match(
    site(text, "admin.stg.example.com"),
    /basic_auth \{[\s\S]*\}\n\t@root path \/\n\tredir @root \/en 302\n/u,
  );
  assert.doesNotMatch(text, /password/iu);
});

test("bare domains redirect temporarily to the storefront, keeping the path", () => {
  const text = renderLocalExperienceCaddyfile({
    config,
    authUser: "tester",
    authHash: hash,
    caPath: "/etc/caddy/ca.crt",
    bindAddresses: ["172.26.5.34"],
    redirectHosts: ["example.com"],
  });
  assert.match(
    text,
    /\nexample\.com \{\n\tredir https:\/\/storefront\.stg\.example\.com\{uri\} 302\n\}\n/u,
  );
  assert.throws(
    () =>
      renderLocalExperienceCaddyfile({
        config,
        authUser: "tester",
        authHash: hash,
        caPath: "/etc/caddy/ca.crt",
        bindAddresses: ["172.26.5.34"],
        redirectHosts: ["bad host"],
      }),
    /redirect host/u,
  );
});

test("the edge refuses loopback instances, plaintext secrets and odd paths", () => {
  const input = {
    config,
    authUser: "tester",
    authHash: hash,
    caPath: "/etc/caddy/ca.crt",
    bindAddresses: ["172.26.5.34"],
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
  for (const bindAddresses of [[], ["0.0.0.0"], ["127.0.0.2"], ["::"]])
    assert.throws(
      () => renderLocalExperienceCaddyfile({ ...input, bindAddresses }),
      /explicit non-loopback/u,
    );
});
