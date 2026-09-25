import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { URL, URLSearchParams } from "node:url";

/** Ephemeral material for a locally owned HTTPS fixture, never a production CA. */
export function createTestTlsMaterial(host) {
  if (typeof host !== "string" || !/^[a-z0-9.-]+$/u.test(host))
    throw new Error("Invalid test TLS hostname");
  const directory = mkdtempSync(join(tmpdir(), "fan-support-oidc-"));
  chmodSync(directory, 0o700);
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        `/CN=${host}`,
        "-addext",
        `subjectAltName=DNS:${host}`,
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" },
    );
    chmodSync(keyPath, 0o600);
    return {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
      keyPath,
      certPath,
      cleanup: () => rmSync(directory, { recursive: true, force: true }),
    };
  } catch {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Test TLS material creation failed");
  }
}

const modeAliases = {
  valid: "NORMAL",
  "no-mfa": "NO_MFA",
  "wrong-signature": "WRONG_SIGNATURE",
  disconnect: "DISCONNECT",
};
const modes = new Set([
  "NORMAL",
  "NO_MFA",
  "WRONG_SIGNATURE",
  "UNSIGNED",
  "MISSING_ID_TOKEN",
  "MALFORMED",
  "DISCONNECT",
  "SLOW",
  "OVERSIZED",
  "BODY_STALL",
  "INVALID_GRANT",
  "ACCESS_DENIED",
  "RATE_LIMIT",
  "REDIRECT",
]);

/** Real HTTPS discovery, browser authorization, one-time S256 exchange and JWKS. */
export async function startTestOidcProvider(options = {}) {
  const host = options.host ?? "oidc.example.invalid";
  const clientId = options.clientId ?? "local-admin-client";
  const clientSecret = options.clientSecret ?? "local-test-secret";
  const redirectOrigins = new Set(
    options.redirectOrigins ?? ["https://admin.example.invalid"],
  );
  const tls = createTestTlsMaterial(host);
  const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = {
    ...key.publicKey.export({ format: "jwk" }),
    kid: "local-key",
    alg: "RS256",
    use: "sig",
  };
  const codes = new Map();
  let issuer;
  let subject;
  let mode;
  let claimsPatch;
  let discoveryPatch;
  let tokenRequests;
  let discoveryRequests;
  let tokenBody;
  let tokenAuthorization;
  const reset = () => {
    subject = options.subject ?? "local-admin-subject";
    mode = "NORMAL";
    claimsPatch = {};
    discoveryPatch = {};
    tokenRequests = 0;
    discoveryRequests = 0;
    tokenBody = new URLSearchParams();
    tokenAuthorization = undefined;
    codes.clear();
  };
  reset();
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const oauthFailure = (res, error, status = 400) =>
    res.writeHead(status).end(
      JSON.stringify({
        error,
        error_description: "synthetic private provider detail",
      }),
    );
  async function handle(req, res) {
    const url = new URL(req.url ?? "/", issuer);
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    if (url.pathname === "/.well-known/openid-configuration") {
      discoveryRequests += 1;
      res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: [
            "none",
            "client_secret_basic",
          ],
          ...discoveryPatch,
        }),
      );
      return;
    }
    if (url.pathname === "/authorize") {
      const callback = new URL(
        url.searchParams.get("redirect_uri") ?? "https://invalid.example",
      );
      if (
        req.method !== "GET" ||
        !redirectOrigins.has(callback.origin) ||
        callback.protocol !== "https:" ||
        callback.username ||
        callback.password ||
        callback.hash ||
        url.searchParams.get("client_id") !== clientId ||
        url.searchParams.get("response_type") !== "code" ||
        url.searchParams.get("code_challenge_method") !== "S256" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(
          url.searchParams.get("code_challenge") ?? "",
        ) ||
        !url.searchParams.get("nonce") ||
        !url.searchParams.get("state")
      ) {
        oauthFailure(res, "invalid_request");
        return;
      }
      const code = randomUUID();
      codes.set(code, {
        subject,
        state: url.searchParams.get("state"),
        nonce: url.searchParams.get("nonce"),
        challenge: url.searchParams.get("code_challenge"),
        redirectUri: callback.href,
        createdAt: Date.now(),
      });
      callback.searchParams.set("state", url.searchParams.get("state"));
      callback.searchParams.set("code", code);
      callback.searchParams.set("iss", issuer);
      res.writeHead(302, { location: callback.href }).end();
      return;
    }
    if (url.pathname === "/jwks") {
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (url.pathname !== "/token" || req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    tokenRequests += 1;
    tokenAuthorization = req.headers.authorization;
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) {
        oauthFailure(res, "invalid_request");
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    tokenBody = new URLSearchParams(Buffer.concat(chunks).toString());
    const [basicClient, basicSecret] = tokenAuthorization?.startsWith("Basic ")
      ? Buffer.from(tokenAuthorization.slice(6), "base64")
          .toString()
          .split(":")
          .map(decodeURIComponent)
      : [];
    if (
      tokenAuthorization
        ? basicClient !== clientId || basicSecret !== clientSecret
        : tokenBody.get("client_id") !== clientId
    ) {
      oauthFailure(res, "invalid_client");
      return;
    }
    const code = tokenBody.get("code");
    const issued = codes.get(code);
    codes.delete(code);
    if (
      !issued ||
      mode === "INVALID_GRANT" ||
      tokenBody.get("grant_type") !== "authorization_code" ||
      Date.now() > issued.createdAt + 300000 ||
      createHash("sha256")
        .update(tokenBody.get("code_verifier") ?? "")
        .digest("base64url") !== issued.challenge ||
      tokenBody.get("redirect_uri") !== issued.redirectUri
    ) {
      oauthFailure(res, "invalid_grant");
      return;
    }
    if (mode === "ACCESS_DENIED") {
      oauthFailure(res, "access_denied");
      return;
    }
    if (mode === "RATE_LIMIT") {
      oauthFailure(res, "temporarily_unavailable", 429);
      return;
    }
    if (mode === "DISCONNECT") {
      req.socket.destroy();
      return;
    }
    if (mode === "SLOW") return;
    if (mode === "BODY_STALL") {
      res.write("{");
      return;
    }
    if (mode === "OVERSIZED") {
      res.end(" ".repeat(8192));
      return;
    }
    if (mode === "REDIRECT") {
      res.writeHead(307, { location: `${issuer}/token?followed=true` }).end();
      return;
    }
    if (mode === "MALFORMED") {
      res.end("synthetic private invalid json");
      return;
    }
    if (mode === "NORMAL")
      await options.beforeValidTokenResponse?.({ state: issued.state });
    const seconds = Math.floor(Date.now() / 1000);
    const payload = {
      iss: issuer,
      sub: issued.subject,
      aud: clientId,
      iat: seconds,
      exp: seconds + 60,
      auth_time: seconds - 1,
      nonce: issued.nonce,
      acr:
        mode === "NO_MFA"
          ? "urn:example:password"
          : (options.acr ?? "urn:example:mfa"),
      amr: mode === "NO_MFA" ? ["pwd"] : (options.amr ?? ["pwd", "otp"]),
      roles: ["ROOT"],
      ...claimsPatch,
    };
    const signingInput = `${Buffer.from(JSON.stringify({ alg: mode === "UNSIGNED" ? "none" : "RS256", kid: jwk.kid })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
    const signature =
      mode === "UNSIGNED"
        ? ""
        : sign(
            "RSA-SHA256",
            Buffer.from(signingInput),
            mode === "WRONG_SIGNATURE" ? otherKey.privateKey : key.privateKey,
          ).toString("base64url");
    res.end(
      JSON.stringify({
        access_token: "synthetic-private-token",
        token_type: "Bearer",
        ...(mode === "MISSING_ID_TOKEN"
          ? {}
          : { id_token: `${signingInput}.${signature}` }),
      }),
    );
  }
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch {
    tls.cleanup();
    throw new Error("Test OIDC listener failed");
  }
  issuer = `https://${host}:${server.address().port}`;
  const scopedFetch = async (input, init) => {
    const url = new URL(
      input instanceof globalThis.Request ? input.url : String(input),
    );
    // A test DNS override for exactly this locally owned origin, never arbitrary URLs.
    if (url.origin !== issuer)
      throw new Error("Test OIDC transport origin mismatch");
    return new Promise((resolve, reject) => {
      const outgoing = request(
        url,
        {
          ca: tls.cert,
          hostname: "127.0.0.1",
          servername: host,
          method: init?.method ?? "GET",
          headers: Object.fromEntries(
            new globalThis.Headers(init?.headers).entries(),
          ),
          ...(init?.signal ? { signal: init.signal } : {}),
        },
        (incoming) => {
          const headers = new globalThis.Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (value !== undefined)
              headers.set(
                name,
                Array.isArray(value) ? value.join(", ") : value,
              );
          resolve(
            new globalThis.Response(Readable.toWeb(incoming), {
              status: incoming.statusCode ?? 500,
              headers,
            }),
          );
        },
      );
      outgoing.on("error", reject);
      outgoing.end(
        init?.body instanceof URLSearchParams
          ? init.body.toString()
          : init?.body,
      );
    });
  };
  let stopped = false;
  return {
    issuer,
    fetch: scopedFetch,
    ca: tls.cert,
    reset,
    get tokenRequests() {
      return tokenRequests;
    },
    get discoveryRequests() {
      return discoveryRequests;
    },
    get tokenBody() {
      return new URLSearchParams(tokenBody);
    },
    get tokenAuthorization() {
      return tokenAuthorization;
    },
    setMode(value) {
      const next = modeAliases[value] ?? value;
      if (!modes.has(next)) throw new Error("Invalid test OIDC mode");
      mode = next;
    },
    setSubject(value) {
      if (typeof value !== "string" || value.length < 1)
        throw new Error("Invalid test subject");
      subject = value;
    },
    setClaims(value) {
      claimsPatch = { ...value };
    },
    setDiscovery(value) {
      discoveryPatch = { ...value };
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      codes.clear();
      server.closeAllConnections();
      try {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      } finally {
        tls.cleanup();
      }
    },
  };
}
