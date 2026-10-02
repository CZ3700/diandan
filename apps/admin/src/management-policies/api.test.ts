import { expect, test } from "vitest";
import { createAdminClient } from "../workspace/client";
import { policyFixture, owner, revision } from "./fixture";
const subject = await import("./api").catch(() => undefined);
function api(transport: typeof fetch) {
  expect(subject?.createPoliciesApi).toBeTypeOf("function");
  return subject!.createPoliciesApi(
    createAdminClient(
      () => "csrf",
      () => {},
      transport,
    ),
  );
}
test("listing uses actual catalog policy targets and rejects a foreign kind", async () => {
  const calls: string[] = [];
  const client = api(async (_, init) => {
    calls.push(String(init?.body));
    return Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "OWNERS",
      page: 1,
      pageSize: 50,
      totalItems: 1,
      items: [owner],
    });
  });
  expect((await client.list("en"))[0]?.target).toEqual(owner.target);
  expect(JSON.parse(calls[0]!)).toMatchObject({ kind: "POLICY", locale: "en" });
  await expect(
    api(async () =>
      Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "OWNERS",
        page: 1,
        pageSize: 50,
        totalItems: 1,
        items: [{ ...owner, target: { kind: "HOMEPAGE" } }],
      }),
    ).list("en"),
  ).rejects.toThrow("INVALID_RESPONSE");
});
test("read validates canonical owner, revision and locale in workspace replies", async () => {
  const fixture = policyFixture();
  if (fixture.outcome !== "SUCCESS") throw new Error("fixture");
  const client = api(async (url) =>
    String(url).endsWith("catalog-owner")
      ? Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "OWNER",
          owner,
        })
      : Response.json({
          ...fixture,
          target: {
            ...fixture.target,
            owner: { kind: "POLICY", policyKey: "wrong" },
          },
          selected: null,
          cells: fixture.cells.map((cell) =>
            cell.locale === "en"
              ? { ...cell, status: "MISSING", reviewStatus: null }
              : cell,
          ),
        }),
  );
  await expect(client.read(owner.target, "en", revision)).rejects.toThrow(
    "INVALID_RESPONSE",
  );
});
test("review uses displayed review sequence and hashes without fabricating approvals", async () => {
  const fixture = policyFixture();
  if (fixture.outcome !== "SUCCESS") throw new Error("fixture");
  const requests: { url: string; body: unknown }[] = [];
  const client = api(async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: revision,
      replayed: false,
    });
  });
  await client.review(fixture, "submit");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toContain("review-submit");
  expect(requests[0]?.body).toMatchObject({
    expectedVersion: 1,
    expectedContentHash: "b".repeat(64),
    expectedSourceHash: "b".repeat(64),
    target: fixture.target,
  });
});
test("a registered policy without a revision reads its real kind for its first immutable revision", async () => {
  const requests: { url: string; body: unknown }[] = [];
  const client = api(async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    if (String(url).endsWith("catalog-owner"))
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "OWNER",
        owner: {
          ...owner,
          authoringVersion: 0,
          latestRevisionId: null,
          draftRevisionId: null,
        },
      });
    return Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "POLICY",
      policy: {
        schemaVersion: 1,
        policyKey: "custom-delivery",
        kind: "DELIVERY",
        createdAt: "2026-10-03T00:00:00Z",
      },
    });
  });
  const state = await client.read(owner.target, "en");
  expect(state.draft?.kind).toBe("DELIVERY");
  expect(state.workspace).toBeNull();
  expect(requests.map((row) => row.url)).toContain("/api/admin/policy-read");
});
test("a locale-only editor can begin a missing translation without access to the full revision", async () => {
  const fixture = policyFixture();
  if (fixture.outcome !== "SUCCESS") throw new Error("fixture");
  const client = api(async (url) => {
    if (String(url).endsWith("catalog-owner"))
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "OWNER",
        owner: { ...owner, locale: "es" },
      });
    if (String(url).endsWith("translation-read"))
      return Response.json({
        ...fixture,
        target: { ...fixture.target, locale: "es" },
        selected: null,
        editability: {
          canSave: true,
          reason: "ALLOWED",
          requiredLocales: ["es"],
        },
      });
    return Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "FORBIDDEN" },
      { status: 403 },
    );
  });
  const state = await client.read(owner.target, "es", revision);
  expect(state.workspace?.editability.canSave).toBe(true);
  expect(state.draft).toMatchObject({
    kind: null,
    effectiveAt: "",
    translations: [],
  });
});
test("default selection stays on the latest published revision when an older draft pointer remains", async () => {
  const fixture = policyFixture();
  if (fixture.outcome !== "SUCCESS" || !fixture.selected)
    throw new Error("fixture");
  const latest = "10000000-0000-4000-8000-000000000004";
  const targets: unknown[] = [];
  const client = api(async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (String(url).endsWith("catalog-owner"))
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "OWNER",
        owner: {
          ...owner,
          latestRevisionId: latest,
          publishedRevisionId: latest,
          draftRevisionId: revision,
        },
      });
    if (String(url).endsWith("translation-read")) {
      targets.push(body["target"]);
      const target = { ...fixture.target, revisionId: latest };
      return Response.json({
        ...fixture,
        target,
        selected: {
          ...fixture.selected,
          context: { ...fixture.selected!.context, target },
        },
      });
    }
    return Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "FORBIDDEN" },
      { status: 403 },
    );
  });
  await client.read(owner.target, "en");
  expect(targets[0]).toMatchObject({ revisionId: latest });
});
test("registration uses the operator supplied key and policy kind, never inferred keys", async () => {
  const calls: unknown[] = [];
  const client = api(async (_, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      resultId: revision,
      replayed: false,
    });
  });
  await client.register("seller-terms", "TERMS");
  expect(calls[0]).toMatchObject({
    policyKey: "seller-terms",
    kind: "TERMS",
    expectedVersion: 0,
  });
});

function savedTransport(
  title: string,
  locale = "en",
  mutation?: (body: Record<string, unknown>, key: string) => void,
): typeof fetch {
  const fixture = policyFixture();
  if (fixture.outcome !== "SUCCESS" || !fixture.selected)
    throw new Error("fixture");
  const id = "10000000-0000-4000-8000-000000000003";
  const target = { ...fixture.target, revisionId: id, locale };
  const updatedFields = { ...fixture.selected.content.fields, title };
  return async (url, init) => {
    const operation = String(url).split("/").at(-1);
    if (operation === "authoring-copy" || operation === "authoring-create") {
      mutation?.(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
        new Headers(init?.headers).get("idempotency-key") ?? "",
      );
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "MUTATION",
        resultId: id,
        replayed: false,
      });
    }
    if (operation === "catalog-owner")
      return Response.json({
        schemaVersion: 1,
        outcome: "SUCCESS",
        kind: "OWNER",
        owner: {
          ...owner,
          locale,
          authoringVersion: 2,
          latestRevisionId: id,
          draftRevisionId: id,
        },
      });
    if (operation === "translation-read")
      return Response.json({
        ...fixture,
        target,
        revisionNumber: 2,
        authoringHeadVersion: 2,
        contentHash: "c".repeat(64),
        cells: fixture.cells.map((cell) =>
          cell.locale === locale
            ? { ...cell, status: "DRAFT", reviewStatus: "DRAFT" }
            : cell,
        ),
        editability: {
          canSave: true,
          reason: "ALLOWED",
          requiredLocales: [locale],
        },
        source:
          locale === "en"
            ? { kind: "POLICY", fields: updatedFields }
            : fixture.source,
        selected: {
          ...fixture.selected,
          source:
            locale === "en"
              ? { kind: "POLICY", fields: updatedFields }
              : fixture.source,
          context: {
            ...fixture.selected!.context,
            target,
            audit: { ...fixture.selected!.context.audit, locale },
          },
          content: { ...fixture.selected!.content, fields: updatedFields },
        },
      });
    return Response.json(
      { schemaVersion: 1, outcome: "FAILURE", code: "FORBIDDEN" },
      { status: 403 },
    );
  };
}
test("copy retries retain the mutation key and use whole snapshot hash, then verify saved text", async () => {
  const workspace = policyFixture();
  if (
    workspace.outcome !== "SUCCESS" ||
    workspace.selected?.content.kind !== "POLICY"
  )
    throw new Error("fixture");
  const baseline = {
    ...workspace.selected.content.structure,
    translations: [
      {
        locale: "en" as const,
        origin: "MACHINE" as const,
        fields: workspace.selected.content.fields,
      },
    ],
  };
  const state = { owner, workspace, draft: baseline };
  const draft = {
    ...baseline,
    translations: [
      {
        ...baseline.translations[0]!,
        fields: { ...baseline.translations[0]!.fields, title: "Updated" },
      },
    ],
  };
  const keys: string[] = [],
    commands: Record<string, unknown>[] = [];
  const client = api(
    savedTransport("Updated", "en", (command, key) => {
      keys.push(key);
      commands.push(command);
      if (keys.length === 1) throw new Error("Network response lost");
    }),
  );
  await expect(client.save(state, draft, "en")).rejects.toThrow(
    "NETWORK_ERROR",
  );
  const saved = await client.save(state, draft, "en");
  expect(saved.draft?.translations[0]?.fields.title).toBe("Updated");
  expect(keys[0]).toBe(keys[1]);
  expect(commands[0]).toMatchObject({
    expectedVersion: 1,
    expectedSourceHash: "a".repeat(64),
    sourceRevisionId: revision,
    changes: { translations: [{ locale: "en", origin: "MACHINE" }] },
  });
});
test("first save uses authoring create with explicit source and effective time", async () => {
  const workspace = policyFixture();
  if (
    workspace.outcome !== "SUCCESS" ||
    workspace.selected?.content.kind !== "POLICY"
  )
    throw new Error("fixture");
  const commands: Record<string, unknown>[] = [];
  const draft = {
    ...workspace.selected.content.structure,
    translations: [
      {
        locale: "en" as const,
        origin: "MACHINE" as const,
        fields: { ...workspace.selected.content.fields, title: "Updated" },
      },
    ],
  };
  const client = api(
    savedTransport("Updated", "en", (command) => commands.push(command)),
  );
  await client.save(
    {
      owner: { ...owner, authoringVersion: 0 },
      workspace: null,
      draft: { ...draft, effectiveAt: "", translations: [] },
    },
    draft,
    "en",
  );
  expect(commands[0]).toMatchObject({
    expectedVersion: 0,
    content: {
      kind: "POLICY",
      structure: { kind: draft.kind, effectiveAt: draft.effectiveAt },
      translations: draft.translations,
    },
  });
});
test("a new scoped translation saves without sending unreadable structure and accepts its authoritative date", async () => {
  const workspace = policyFixture();
  if (
    workspace.outcome !== "SUCCESS" ||
    workspace.selected?.content.kind !== "POLICY"
  )
    throw new Error("fixture");
  const commands: Record<string, unknown>[] = [];
  const scoped = {
    ...workspace,
    target: { ...workspace.target, locale: "es" as const },
    selected: null,
  };
  const baseline = {
    kind: null,
    effectiveAt: "",
    translations: [],
  };
  const draft = {
    ...baseline,
    translations: [
      {
        locale: "es" as const,
        origin: "MACHINE" as const,
        fields: { ...workspace.selected.content.fields, title: "Actualizado" },
      },
    ],
  };
  const saved = await api(
    savedTransport("Actualizado", "es", (command) => commands.push(command)),
  ).save(
    { owner: { ...owner, locale: "es" }, workspace: scoped, draft: baseline },
    draft,
    "es",
  );
  expect(commands[0]?.["changes"]).toEqual({
    kind: "POLICY",
    translations: draft.translations,
  });
  expect(saved.draft?.effectiveAt).toBe("2027-01-01T00:00:00Z");
  expect(saved.draft?.translations[0]?.fields.title).toBe("Actualizado");
});
