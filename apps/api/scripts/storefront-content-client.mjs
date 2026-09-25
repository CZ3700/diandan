import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as contract from "@fan-support/contracts";
import { digestAdminContentToken } from "@fan-support/application";
import { seedWorkspaceIdentities } from "./admin-workspace-fixtures.mjs";

/** Synthetic staff credentials never leave the isolated fixture process. */
export async function createStorefrontFixtureIdentity(client) {
  const tokenPepper = randomBytes(32).toString("hex");
  const credentials = Object.fromEntries(
    ["editor", "reviewer", "manager"].map((actor) => [
      actor,
      {
        token: randomBytes(32).toString("base64url"),
        csrf: randomBytes(32).toString("base64url"),
      },
    ]),
  );
  const identities = await seedWorkspaceIdentities(
    client,
    Object.entries(credentials).map(([name, value]) => ({
      name,
      actor: name,
      sessionTokenDigest: digestAdminContentToken({
        tokenPepper,
        purpose: "admin-session",
        token: value.token,
      }),
      csrfTokenDigest: digestAdminContentToken({
        tokenPepper,
        purpose: "admin-csrf",
        token: value.csrf,
      }),
      expiresInSeconds: 7200,
    })),
  );
  return { tokenPepper, credentials, identities };
}

function responseSchema(route) {
  if (route.includes("/gift-commerce/"))
    return contract.giftCommerceResponseSchema;
  if (route.includes("/catalog/")) return contract.adminCatalogResponseSchema;
  if (route.includes("/content-authoring/"))
    return contract.contentAuthoringResponseSchema;
  if (route.includes("/content-review/"))
    return contract.baseContentResponseSchema;
  if (route.includes("/resources/"))
    return contract.adminResourceResponseSchema;
  if (route.endsWith("/preflight"))
    return contract.publicationPreflightResponseSchema;
  if (route.includes("/publication/"))
    return contract.publicationRuntimeResponseSchema;
  return contract.adminContentResponseSchema;
}

/** All fixture content passes through the existing authenticated HTTP use cases. */
export function createStorefrontContentClient({
  base,
  origin,
  credentials,
  check,
}) {
  let requests = 0;
  async function request(
    route,
    body,
    { actor = "editor", write = false } = {},
  ) {
    requests++;
    const identity = credentials[actor];
    const response = await globalThis.fetch(base + route, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `__Host-fan-admin-session=${identity.token}`,
        "x-csrf-token": identity.csrf,
        ...(write ? { "idempotency-key": randomUUID() } : {}),
      },
      body: JSON.stringify({
        schemaVersion: 1,
        ...body,
        ...(write ? { reasonCode: "STOREFRONT_FIXTURE" } : {}),
      }),
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    const parsed = responseSchema(route).safeParse(await response.json());
    if (
      response.status !== 200 ||
      !parsed.success ||
      parsed.data.outcome === "FAILURE"
    )
      console.error(
        `Storefront fixture HTTP ${JSON.stringify({ route, ordinal: requests, status: response.status, code: parsed.success ? (parsed.data.code ?? "NONE") : "INVALID_RESPONSE", issues: parsed.success && "issues" in parsed.data ? parsed.data.issues.map(({ code, path }) => ({ code, path })) : [] })}`,
      );
    check(response.status === 200, `fixture ${route} HTTP succeeds`);
    check(
      parsed.success && parsed.data.outcome === "SUCCESS",
      "fixture response matches successful strict schema",
    );
    check(
      response.headers.get("cache-control") === "private, no-store",
      "private fixture authoring is never shared cached",
    );
    return parsed.data;
  }
  const write = (route, body, actor = "editor") =>
    request(route, body, { actor, write: true });
  const author = async (owner, content) =>
    (
      await write("/api/v1/admin/content-authoring/create", {
        target: owner,
        content,
        expectedVersion: 0,
      })
    ).resultId;
  async function approve(owner, revisionId) {
    for (const locale of contract.SUPPORTED_LOCALES) {
      for (const action of ["submit", "approve"]) {
        const target = { owner, revisionId, locale };
        const value = await request("/api/v1/admin/content-review/read", {
          target,
        });
        await write(
          `/api/v1/admin/content-review/${action}`,
          {
            target,
            expectedVersion: value.context.audit.reviewSequence,
            expectedContentHash: value.context.audit.sourceHash,
            expectedSourceHash: value.context.currentEnglishSourceHash,
          },
          action === "approve" ? "reviewer" : "editor",
        );
      }
    }
  }
  async function approveExtension(target) {
    for (const action of ["submit", "approve"]) {
      const draft = await request("/api/v1/admin/content/drafts/read", {
        target,
      });
      for (const context of draft.reviews)
        await write(
          `/api/v1/admin/content/reviews/${action}`,
          {
            target: context.target,
            expectedVersion: context.sequence,
            expectedContentHash: context.contentHash,
            expectedSourceHash: context.sourceHash,
          },
          action === "approve" ? "reviewer" : "editor",
        );
    }
  }
  async function publish(owner, revisionId) {
    const target = { owner, revisionId };
    const preflight = await request(
      "/api/v1/admin/content/publication/preflight",
      { target, action: "PUBLISH" },
      { actor: "manager" },
    );
    if (!preflight.ready)
      console.error(
        `Storefront preflight ${JSON.stringify({ kind: owner.kind, issues: preflight.issues.map(({ code, path }) => ({ code, path })) })}`,
      );
    assert.ok(
      preflight.ready,
      "fixture must satisfy the unmodified full publication gate",
    );
    const validated = await write(
      "/api/v1/admin/content/publication/validate",
      {
        target,
        expectedVersion: preflight.headVersion,
        expectedContentHash: preflight.contentHash,
      },
      "manager",
    );
    return write(
      "/api/v1/admin/content/publication/publish",
      {
        target,
        expectedVersion: validated.headVersion,
        expectedContentHash: validated.contentHash,
      },
      "manager",
    );
  }
  return {
    request,
    write,
    author,
    approve,
    approveExtension,
    publish,
    requestCount: () => requests,
  };
}
