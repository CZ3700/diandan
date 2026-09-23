import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { URL, URLSearchParams } from "node:url";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";
import { prepareLocalTls } from "./local-experience-infrastructure.mjs";
import { startLocalExperienceOidc } from "./local-experience-services-oidc.mjs";
import { createOidcIdentityProvider } from "../../../packages/identity-oidc/dist/index.js";

test("actual TLS OIDC selects a synthetic subject, verifies PKCE, consumes the code once and keeps signing identity after restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fan-local-oidc-"));
  let service;
  try {
    const state = await loadLocalState(root, "test");
    await prepareLocalTls(state);
    service = await startLocalExperienceOidc(state);
    const { config } = state,
      settings = config.services.oidc;
    const verifier = randomBytes(32).toString("base64url"),
      nonce = randomBytes(32).toString("base64url"),
      redirect = `${config.origins.admin}/api/admin/auth/callback`;
    const auth = new URL("/authorize", service.issuer);
    auth.search = new URLSearchParams({
      response_type: "code",
      client_id: settings.clientId,
      redirect_uri: redirect,
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      state: randomBytes(32).toString("base64url"),
      nonce,
    }).toString();
    const discovery = await (
      await service.fetch(`${service.issuer}/.well-known/openid-configuration`)
    ).json();
    assert.equal(discovery.issuer, service.issuer);
    const keys = await (await service.fetch(discovery.jwks_uri)).json();
    const page = await service.fetch(auth),
      html = await page.text();
    assert.equal(page.status, 200);
    assert(html.includes("simulated MFA"));
    const ticket = /name="ticket" value="([^"]+)"/u.exec(html)[1],
      csrf = /name="csrf" value="([^"]+)"/u.exec(html)[1];
    const selection = {
      method: "POST",
      headers: {
        origin: service.issuer,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ ticket, csrf, actor: "reviewer" }),
    };
    const selected = await service.fetch(
      `${service.issuer}/authorize`,
      selection,
    );
    assert.equal(selected.status, 303);
    const code = new URL(selected.headers.get("location")).searchParams.get(
      "code",
    );
    assert.equal(
      (await service.fetch(`${service.issuer}/authorize`, selection)).status,
      400,
    );
    const exchange = {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirect,
        code_verifier: verifier,
      }),
    };
    const rejected = await service.fetch(discovery.token_endpoint, {
      ...exchange,
      headers: {
        ...exchange.headers,
        authorization: `Basic ${Buffer.from(`${settings.clientId}:incorrect`).toString("base64")}`,
      },
    });
    assert.equal(
      rejected.status,
      401,
      "A wrong client secret does not consume or exchange the authorization code",
    );
    const tokens = await (
      await service.fetch(discovery.token_endpoint, exchange)
    ).json();
    const [header, payload, signature] = tokens.id_token.split(".");
    assert(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        createPublicKey({ key: keys.keys[0], format: "jwk" }),
        Buffer.from(signature, "base64url"),
      ),
    );
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.equal(
      claims.sub,
      settings.actors.find((actor) => actor.key === "reviewer").subject,
    );
    assert.equal(claims.nonce, nonce);
    assert.equal(claims.roles, undefined, "IdP cannot confer platform roles");
    assert.equal(
      (await service.fetch(discovery.token_endpoint, exchange)).status,
      400,
    );
    auth.searchParams.set(
      "redirect_uri",
      "https://outside.example.invalid/callback",
    );
    assert.equal((await service.fetch(auth)).status, 400);
    await assert.rejects(
      service.fetch("https://elsewhere.example.invalid:9443/"),
      /target/iu,
    );
    await service.close();
    service = await startLocalExperienceOidc(state);
    assert.deepEqual(
      await (await service.fetch(discovery.jwks_uri)).json(),
      keys,
    );
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical production OIDC adapter exchanges the local chooser authorization code", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fan-local-oidc-adapter-"));
  let service;
  try {
    const state = await loadLocalState(root, "test");
    await prepareLocalTls(state);
    service = await startLocalExperienceOidc(state);
    const settings = state.config.services.oidc;
    const redirectUri = `${state.config.origins.admin}/api/admin/auth/callback`;
    const provider = createOidcIdentityProvider(
      {
        issuer: service.issuer,
        clientId: settings.clientId,
        redirectUri,
        clientAuthentication: {
          method: "CLIENT_SECRET_BASIC",
          secret: settings.clientSecret,
        },
        mfa: {
          acceptedAcrValues: [settings.acr],
          requiredAmrValues: settings.amr,
        },
      },
      { fetch: service.fetch },
    );
    const verifier = randomBytes(32).toString("base64url");
    // Correlation values require an alphanumeric first character; raw base64url can begin '-' or '_'.
    const nonce = `n${randomBytes(32).toString("base64url")}`;
    const binding = `s${randomBytes(32).toString("base64url")}`;
    const created = await provider.createAuthorizationRequest({
      schemaVersion: 1,
      operation: "CREATE_AUTHORIZATION_REQUEST",
      issuer: service.issuer,
      clientId: settings.clientId,
      redirectUri,
      state: binding,
      nonce,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      requestedAt: new Date().toISOString(),
    });
    assert.equal(created.outcome, "SUCCESS", JSON.stringify(created.error));
    const html = await (
      await service.fetch(created.value.authorizationUrl)
    ).text();
    const response = await service.fetch(`${service.issuer}/authorize`, {
      method: "POST",
      headers: {
        origin: service.issuer,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        ticket: /name="ticket" value="([^"]+)"/u.exec(html)[1],
        csrf: /name="csrf" value="([^"]+)"/u.exec(html)[1],
        actor: "manager",
      }),
    });
    const callback = new URL(response.headers.get("location"));
    const exchanged = await provider.exchangeAuthorizationCode({
      schemaVersion: 1,
      operation: "EXCHANGE_AUTHORIZATION_CODE",
      issuer: service.issuer,
      clientId: settings.clientId,
      redirectUri,
      code: callback.searchParams.get("code"),
      state: binding,
      expectedState: binding,
      nonce,
      codeVerifier: verifier,
      receivedAt: new Date().toISOString(),
    });
    assert.equal(exchanged.outcome, "SUCCESS", JSON.stringify(exchanged.error));
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
