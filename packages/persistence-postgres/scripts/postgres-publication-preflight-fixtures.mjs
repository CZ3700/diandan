import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { seedResourceManagementFixtures } from "./postgres-resource-management-fixtures.mjs";

function success(result, label) {
  if (result.outcome !== "SUCCESS") throw new Error(`${label}: ${result.code}`);
  return result;
}

export async function approvePreflightBase(
  persistence,
  fixtures,
  owner,
  revisionId,
) {
  const run = (work) =>
    persistence.baseContentTransactionManager.runInBaseContentTransaction(work);
  for (const locale of SUPPORTED_LOCALES) {
    const target = { owner, revisionId, locale };
    for (const action of ["SUBMIT", "APPROVE"]) {
      const value = success(
        await run(({ baseContentReviews }) =>
          baseContentReviews.read({ schemaVersion: 1, target }),
        ),
        "base review read",
      );
      if (value.context.audit.review.status === "APPROVED") break;
      success(
        await run(({ baseContentReviews }) =>
          baseContentReviews.append({
            schemaVersion: 1,
            action,
            target,
            expectedVersion: value.context.audit.reviewSequence,
            expectedContentHash: value.context.audit.sourceHash,
            expectedSourceHash: value.context.currentEnglishSourceHash,
            actorId: action === "SUBMIT" ? fixtures.editor : fixtures.reviewer,
            requestId: randomUUID(),
            reasonCode: "PREFLIGHT_FIXTURE",
          }),
        ),
        "base review append",
      );
    }
  }
}

export async function approvePreflightExtension(persistence, fixtures, target) {
  const run = (work) =>
    persistence.adminContentTransactionManager.runInAdminContentTransaction(
      work,
    );
  for (const action of ["SUBMIT", "APPROVE"]) {
    const value = success(
      await run(({ contentReviews }) =>
        contentReviews.loadTarget({ schemaVersion: 1, target }),
      ),
      "extension review read",
    );
    success(
      await run(({ contentReviews }) =>
        contentReviews.append({
          schemaVersion: 1,
          action,
          target,
          expectedVersion: value.context.sequence,
          expectedContentHash: value.context.contentHash,
          expectedSourceHash: value.context.sourceHash,
          actorId: action === "SUBMIT" ? fixtures.editor : fixtures.reviewer,
          requestId: randomUUID(),
          reasonCode: "PREFLIGHT_FIXTURE",
        }),
      ),
      "extension review append",
    );
  }
}

/** Reuses real catalog, authoring, review and resource fixtures; never disables triggers. */
export async function seedPublicationPreflightFixtures(
  client,
  persistence,
  options = {},
) {
  const fixtures = await seedResourceManagementFixtures(client, options);
  const revisions = {},
    extensionTargets = [];
  const author = (work) =>
    persistence.contentAuthoringTransactionManager.runInContentAuthoringTransaction(
      work,
    );
  for (const [key, target] of Object.entries(fixtures.targets)) {
    const source = success(
      await author(({ contentAuthoring }) =>
        contentAuthoring.read({
          schemaVersion: 1,
          action: "READ",
          target,
          revisionId: fixtures.approvedSourceRevisionIds[key],
        }),
      ),
      "authoring source",
    );
    // COPY preserves exact independent base approval evidence. Homepage needs a real hero.
    let command = {
      schemaVersion: 1,
      action: "COPY",
      target,
      sourceRevisionId: source.snapshot.revisionId,
      expectedSourceHash: source.snapshot.contentHash,
      expectedVersion: source.snapshot.headVersion,
      reasonCode: "PREFLIGHT_FIXTURE",
      idempotencyKey: randomUUID(),
      changes: {
        kind: target.kind,
        ...(key === "idol" ? { aliases: fixtures.content.idol.aliases } : {}),
        ...(key === "gift" ? { details: fixtures.content.gift.details } : {}),
      },
    };
    if (key === "homepage") {
      const slots = [
        {
          slotKey: "featured",
          kind: "HERO_IDOL",
          idolId: fixtures.catalog.idols[0].id,
          desktopMediaAssetId: fixtures.catalog.media[1].assetId,
          desktopMediaMetadataRevisionId: fixtures.catalog.media[1].revisionId,
          mobileMediaAssetId: fixtures.catalog.media[2].assetId,
          mobileMediaMetadataRevisionId: fixtures.catalog.media[2].revisionId,
          sortOrder: 0,
        },
      ];
      command = {
        ...command,
        changes: { kind: target.kind, structure: { slots } },
      };
    }
    if (key === "policy") {
      const {
        rows: [clock],
      } = await client.query(
        "SELECT to_char((clock_timestamp()+interval '2 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS effective_at",
      );
      command = {
        ...command,
        changes: {
          kind: target.kind,
          structure: {
            ...source.snapshot.content.structure,
            effectiveAt: clock.effective_at,
          },
        },
      };
    }
    revisions[key] = success(
      await author(({ contentAuthoring }) =>
        contentAuthoring.write({
          schemaVersion: 1,
          command,
          actorId: fixtures.editor,
          requestId: randomUUID(),
        }),
      ),
      "authoring copy",
    ).resultId;
    if (key === "policy") {
      const deadline = performance.now() + 6000;
      for (;;) {
        const {
          rows: [state],
        } = await client.query(
          "SELECT clock_timestamp()>=effective_at AS effective,created_at<=effective_at AS valid FROM public.policy_revisions WHERE id=$1",
          [revisions[key]],
        );
        if (!state.valid)
          throw new Error("Policy fixture requires a causal effective time");
        if (state.effective) break;
        if (performance.now() >= deadline)
          throw new Error(
            "Policy fixture did not become effective within bounded wait",
          );
        await delay(20);
      }
    }
    await approvePreflightBase(persistence, fixtures, target, revisions[key]);
    const { snapshot } = success(
      await author(({ contentAuthoring }) =>
        contentAuthoring.read({
          schemaVersion: 1,
          action: "READ",
          target,
          revisionId: revisions[key],
        }),
      ),
      "authoring copied snapshot",
    );
    if (snapshot.extensions.aliases)
      extensionTargets.push({
        kind: "IDOL_ALIASES",
        revisionId: snapshot.revisionId,
      });
    if (snapshot.extensions.details)
      for (const translation of snapshot.extensions.details.translations)
        extensionTargets.push({
          kind: "GIFT_DETAILS",
          revisionId: snapshot.revisionId,
          locale: translation.locale,
        });
  }
  for (const target of extensionTargets)
    await approvePreflightExtension(persistence, fixtures, target);
  return {
    ...fixtures,
    revisions,
    extensionTargets,
    publicationHeadVersions: {
      idol: 1,
      gift: 1,
      media: 1,
      homepage: 0,
      policy: 0,
    },
  };
}
