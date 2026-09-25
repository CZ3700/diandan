import { Buffer } from "node:buffer";
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { URL, URLSearchParams } from "node:url";
import { TextDecoder } from "node:util";
import {
  createLocalExperienceFetch,
  escapeHtml,
  htmlPage,
  readBody,
  secretEquals,
  startLocalTlsServer,
} from "./local-experience-services-common.mjs";

export async function readLocalOidcKey(path) {
  let pem;
  try {
    pem = await readFile(path, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const generated = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    }).privateKey.export({ format: "pem", type: "pkcs8" });
    try {
      await writeFile(path, generated, { mode: 0o600, flag: "wx" });
    } catch (writeError) {
      if (writeError.code !== "EEXIST") throw writeError;
    }
    pem = await readFile(path, "utf8");
  }
  const privateKey = createPrivateKey(pem),
    publicKey = createPublicKey(privateKey);
  if (
    privateKey.asymmetricKeyType !== "rsa" ||
    privateKey.asymmetricKeyDetails.modulusLength < 2048
  )
    throw new TypeError("Invalid local OIDC key");
  await chmod(path, 0o600);
  const material = publicKey.export({ format: "jwk" });
  const kid = createHash("sha256")
    .update(JSON.stringify(material))
    .digest("base64url");
  return { privateKey, jwk: { ...material, kid, use: "sig", alg: "RS256" } };
}

function matchesClientAuthentication(header, settings) {
  try {
    const encoded = /^Basic ([A-Za-z0-9+/]+={0,2})$/iu.exec(header ?? "")?.[1];
    if (!encoded) return false;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) return false;
    const fields = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .split(":");
    if (fields.length !== 2) return false;
    // OAuth Basic credentials are individually form-encoded; SDKs may escape unreserved characters.
    const [clientId, clientSecret] = fields.map((field) =>
      decodeURIComponent(field.replaceAll("+", " ")),
    );
    return (
      secretEquals(clientId, settings.clientId) &&
      secretEquals(clientSecret, settings.clientSecret)
    );
  } catch {
    return false;
  }
}

/** Browser-visible synthetic identity selection; platform grants remain in the business database. */
export async function startLocalExperienceOidc({ config }) {
  const settings = config.services.oidc,
    issuer = config.origins.oidc;
  if (
    !settings.clientId ||
    !settings.clientSecret ||
    !Array.isArray(settings.actors) ||
    !settings.actors.length ||
    !settings.acr ||
    !Array.isArray(settings.amr)
  )
    throw new TypeError("Invalid local OIDC settings");
  const actors = new Map(settings.actors.map((actor) => [actor.key, actor]));
  if (
    actors.size !== settings.actors.length ||
    settings.actors.some(
      (actor) => !actor.key || !actor.subject || !actor.label,
    )
  )
    throw new TypeError("Invalid local OIDC actors");
  const key = await readLocalOidcKey(settings.signingPrivateKeyPath),
    tickets = new Map(),
    codes = new Map();
  const callback = `${config.origins.admin}/api/admin/auth/callback`;
  const tokenFor = (ticket) =>
    createHmac("sha256", settings.clientSecret)
      .update(`local-oidc-choice:${ticket}`)
      .digest("base64url");
  const sweep = () => {
    for (const map of [tickets, codes])
      for (const [id, value] of map)
        if (value.expiresAt <= Date.now()) map.delete(id);
  };
  const fail = (response, code = "invalid_request", status = 400) =>
    response
      .writeHead(status, { "content-type": "application/json" })
      .end(JSON.stringify({ error: code }));
  const server = await startLocalTlsServer({
    origin: issuer,
    tls: config.tls,
    async handle(request, response) {
      const url = new URL(request.url, issuer);
      sweep();
      if (
        request.method === "GET" &&
        url.pathname === "/.well-known/openid-configuration"
      ) {
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["client_secret_basic"],
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/jwks") {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ keys: [key.jwk] }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/authorize") {
        const params = url.searchParams;
        if (
          params.get("client_id") !== settings.clientId ||
          params.get("redirect_uri") !== callback ||
          params.get("response_type") !== "code" ||
          params.get("code_challenge_method") !== "S256" ||
          !/^[A-Za-z0-9_-]{43}$/u.test(params.get("code_challenge") ?? "") ||
          !params.get("state") ||
          !params.get("nonce") ||
          [...params.keys()].some((name) => params.getAll(name).length !== 1) ||
          tickets.size >= 1000
        ) {
          fail(response);
          return;
        }
        const ticket = randomUUID();
        tickets.set(ticket, {
          state: params.get("state"),
          nonce: params.get("nonce"),
          challenge: params.get("code_challenge"),
          expiresAt: Date.now() + 300000,
        });
        response
          .writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "referrer-policy": "strict-origin",
            "content-security-policy": `default-src 'none'; form-action 'self' ${config.origins.admin}; base-uri 'none'; frame-ancestors 'none'`,
          })
          .end(
            htmlPage(
              "Local TEST identity",
              `<p>This local simulator uses synthetic identities and simulated MFA. No account password is required.</p><form method="post" action="/authorize"><input type="hidden" name="ticket" value="${ticket}"><input type="hidden" name="csrf" value="${tokenFor(ticket)}"><p><label for="actor">Test identity</label> <select id="actor" name="actor">${settings.actors.map((actor) => `<option value="${escapeHtml(actor.key)}">${escapeHtml(actor.label)}</option>`).join("")}</select></p><button type="submit">Continue to management center</button></form>`,
            ),
          );
        return;
      }
      if (request.method === "POST" && url.pathname === "/authorize") {
        const body = new URLSearchParams(await readBody(request)),
          ticket = body.get("ticket"),
          pending = tickets.get(ticket),
          actor = actors.get(body.get("actor"));
        if (
          request.headers.origin !== issuer ||
          !pending ||
          !actor ||
          !secretEquals(body.get("csrf"), tokenFor(ticket)) ||
          [...body.keys()].sort().join(",") !== "actor,csrf,ticket"
        ) {
          fail(response);
          return;
        }
        tickets.delete(ticket);
        const code = randomUUID();
        codes.set(code, { ...pending, subject: actor.subject });
        const location = new URL(callback);
        location.searchParams.set("state", pending.state);
        location.searchParams.set("code", code);
        location.searchParams.set("iss", issuer);
        response.writeHead(303, { location: location.href }).end();
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/token") {
        response.writeHead(404).end();
        return;
      }
      if (
        !matchesClientAuthentication(request.headers.authorization, settings)
      ) {
        request.resume();
        fail(response, "invalid_client", 401);
        return;
      }
      const body = new URLSearchParams(await readBody(request)),
        code = body.get("code"),
        issued = codes.get(code);
      codes.delete(code);
      if (
        !issued ||
        body.get("grant_type") !== "authorization_code" ||
        body.get("redirect_uri") !== callback ||
        createHash("sha256")
          .update(body.get("code_verifier") ?? "")
          .digest("base64url") !== issued.challenge
      ) {
        fail(response, "invalid_grant");
        return;
      }
      const now = Math.floor(Date.now() / 1000),
        claims = {
          iss: issuer,
          sub: issued.subject,
          aud: settings.clientId,
          iat: now,
          exp: now + 60,
          auth_time: now - 1,
          nonce: issued.nonce,
          acr: settings.acr,
          amr: settings.amr,
        };
      const signingInput = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: key.jwk.kid })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
      const idToken = `${signingInput}.${sign("RSA-SHA256", Buffer.from(signingInput), key.privateKey).toString("base64url")}`;
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          token_type: "Bearer",
          access_token: randomUUID(),
          id_token: idToken,
          expires_in: 60,
        }),
      );
    },
  });
  return {
    issuer,
    ca: await readFile(config.tls.caCertificatePath),
    fetch: await createLocalExperienceFetch({
      origins: [issuer],
      caCertificatePath: config.tls.caCertificatePath,
    }),
    close: async () => {
      tickets.clear();
      codes.clear();
      await server.close();
    },
  };
}
