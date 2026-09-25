import assert from "node:assert/strict";
import { fileURLToPath, URL } from "node:url";
import { Client } from "pg";
import { z } from "zod";
import {
  SUPPORTED_LOCALES,
  contentAuthoringContentSchema,
} from "@fan-support/contracts";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";
import { withLocalHomepageSessions } from "./local-experience-homepage-sessions.mjs";
import {
  buildLocalHomepageMediaContent,
  ensureLocalReviewedMedia,
} from "./local-experience-homepage-media.mjs";

const stateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  testOnly: z.literal(true),
  sourceAssetId: z.uuid(),
  stage: z.enum([
    "AUTHOR_PENDING",
    "AUTHOR_INTERRUPTED",
    "REVIEW_INTERRUPTED",
    "READY",
  ]),
  sessionIds: z.array(z.uuid()).max(2),
  item: z.strictObject({
    content: contentAuthoringContentSchema.refine(
      (value) => value.kind === "MEDIA_METADATA",
    ),
    baseRevisionNumber: z.number().int().nonnegative(),
    baseHeadVersion: z.literal(0),
    revisionId: z.uuid().optional(),
  }),
});

/** Real HTTP interruption recovery on an unpublished TEST source revision; published homepage and media heads are preserved. */
export async function verifyLocalHomepageRecovery({ workspaceRoot, instance }) {
  const { config } = await loadLocalState(workspaceRoot, instance);
  const client = new Client({
    host: "127.0.0.1",
    port: config.ports.postgres,
    ...config.database,
    ssl: false,
  });
  await client.connect();
  let checks = 0;
  const check = (value, message) => {
    checks++;
    assert.ok(value, message);
  };
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('local-experience-homepage-recovery',0))",
    );
    const heads = async () =>
      (
        await client.query(
          "SELECT jsonb_build_object('homepage',(SELECT jsonb_agg(to_jsonb(h.*)) FROM homepage_publication_heads h),'media',(SELECT jsonb_agg(to_jsonb(m.*) ORDER BY m.media_asset_id) FROM media_metadata_publication_heads m)) value",
        )
      ).rows[0].value;
    const before = await heads();
    await client.query(
      "CREATE TABLE IF NOT EXISTS local_experience.homepage_recovery(id integer PRIMARY KEY CHECK(id=1),instance_id uuid NOT NULL,state jsonb NOT NULL)",
    );
    const previous = (
      await client.query(
        "SELECT instance_id,state FROM local_experience.homepage_recovery WHERE id=1",
      )
    ).rows[0];
    if (previous)
      check(
        previous.instance_id === config.instanceId,
        "Recovery evidence belongs to this local instance",
      );
    let state;
    if (previous) state = stateSchema.parse(previous.state);
    else {
      const sourceAssetId = (
        await client.query(
          "SELECT state#>>'{posterAssets,desktop,sourceAssetId}' id FROM local_experience.homepage_bootstrap WHERE id=1",
        )
      ).rows[0]?.id;
      check(
        Boolean(sourceAssetId),
        "A real uploaded TEST original is available",
      );
      const base = (
        await client.query(
          "SELECT coalesce(max(revision)::int,0) revision FROM media_metadata_revisions WHERE media_asset_id=$1",
          [sourceAssetId],
        )
      ).rows[0];
      state = stateSchema.parse({
        schemaVersion: 1,
        testOnly: true,
        sourceAssetId,
        stage: "AUTHOR_PENDING",
        sessionIds: [],
        item: {
          content: buildLocalHomepageMediaContent(
            "Local TEST recovery source",
            0,
          ),
          baseRevisionNumber: base.revision,
          baseHeadVersion: 0,
        },
      });
      await client.query(
        "INSERT INTO local_experience.homepage_recovery(id,instance_id,state) VALUES(1,$1,$2)",
        [config.instanceId, state],
      );
    }
    const save = async () => {
      stateSchema.parse(state);
      await client.query(
        "UPDATE local_experience.homepage_recovery SET state=$1 WHERE id=1 AND instance_id=$2",
        [state, config.instanceId],
      );
    };
    if (state.sessionIds.length) {
      await client.query(
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND revoked_at IS NULL",
        [state.sessionIds],
      );
      state.sessionIds = [];
      await save();
    }
    const capturedSessions = [];
    const run = async (failRoute, ordinal = 1) => {
      let seen = 0;
      return withLocalHomepageSessions(
        {
          client,
          config,
          base: `http://127.0.0.1:${config.ports.api}`,
          saveSessionIds: async (ids) => {
            state.sessionIds = ids;
            capturedSessions.push(...ids);
            await save();
          },
        },
        async (content) => {
          const interrupted = {
            ...content,
            write: async (...args) => {
              const result = await content.write(...args);
              if (args[0].endsWith(failRoute) && ++seen === ordinal)
                throw new Error("TEST committed HTTP response lost");
              return result;
            },
          };
          await ensureLocalReviewedMedia({
            client,
            content: failRoute ? interrupted : content,
            item: state.item,
            mediaAssetId: state.sourceAssetId,
            save,
            publish: false,
          });
        },
      );
    };
    if (state.stage === "AUTHOR_PENDING") {
      await assert.rejects(
        run("/content-authoring/create"),
        /TEST committed HTTP response lost/,
      );
      check(
        !state.item.revisionId,
        "The lost author response did not invent a revision ID",
      );
      state.stage = "AUTHOR_INTERRUPTED";
      await save();
    }
    if (state.stage === "AUTHOR_INTERRUPTED") {
      await assert.rejects(
        run("/content-review/approve", 3),
        /TEST committed HTTP response lost/,
      );
      check(
        Boolean(state.item.revisionId),
        "Author receipt recovery found the actual committed revision",
      );
      const approved = (
        await client.query(
          "SELECT count(*)::int n FROM media_metadata_translation_reviews r JOIN media_metadata_revision_translations t ON t.id=r.media_metadata_translation_id WHERE t.media_metadata_revision_id=$1 AND r.status='APPROVED'",
          [state.item.revisionId],
        )
      ).rows[0].n;
      check(
        approved === 3,
        "The real partial review stopped after three approvals",
      );
      state.stage = "REVIEW_INTERRUPTED";
      await save();
    }
    await run();
    state.stage = "READY";
    await save();
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM media_metadata_revisions WHERE media_asset_id=$1 AND revision>$2",
          [state.sourceAssetId, state.item.baseRevisionNumber],
        )
      ).rows[0].n === 1,
      "Recovery never duplicates the authored source revision",
    );
    const reviews = (
      await client.query(
        "SELECT count(DISTINCT t.locale)::int n,bool_and(r.reviewer_id<>t.editor_id) independent FROM media_metadata_translation_reviews r JOIN media_metadata_revision_translations t ON t.id=r.media_metadata_translation_id WHERE t.media_metadata_revision_id=$1 AND r.status='APPROVED'",
        [state.item.revisionId],
      )
    ).rows[0];
    check(
      reviews.n === SUPPORTED_LOCALES.length && reviews.independent,
      "All seven actual source translations finish independent approval",
    );
    await run();
    check(
      JSON.stringify(await heads()) === JSON.stringify(before),
      "HTTP recovery does not alter any published homepage or media head",
    );
    check(
      (
        await client.query(
          "SELECT count(*)::int n FROM admin_sessions WHERE id=ANY($1::uuid[]) AND revoked_at IS NOT NULL",
          [capturedSessions],
        )
      ).rows[0].n === capturedSessions.length,
      "Every temporary recovery session is revoked, including interrupted requests",
    );
    return {
      schemaVersion: 1,
      status: "PASS",
      checks,
      realPostgres: true,
      realHttp: true,
      authorResponseRecovery: true,
      partialReviewRecovery: true,
      publishedHeadsPreserved: true,
    };
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const instance = process.argv[2];
  if (!instance)
    throw new Error("Pass the explicitly running local TEST instance");
  console.log(
    JSON.stringify(
      await verifyLocalHomepageRecovery({
        workspaceRoot: fileURLToPath(new URL("../../../", import.meta.url)),
        instance,
      }),
    ),
  );
}
