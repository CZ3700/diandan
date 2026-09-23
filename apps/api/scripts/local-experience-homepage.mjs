import { Client } from "pg";
import { setTimeout, clearTimeout } from "node:timers";
import { localExperienceConfigSchema } from "./local-experience-config.mjs";
import {
  buildLocalHomepageContent,
  localHomepagePlanSchema,
  localHomepageSourceSchema,
  matchingLocalHomepage,
} from "./local-experience-homepage-plan.mjs";
import { prepareLocalHomepageAssets } from "./local-experience-homepage-assets.mjs";
import { withLocalHomepageSessions } from "./local-experience-homepage-sessions.mjs";
import { publishLocalHomepage } from "./local-experience-homepage-publish.mjs";
export {
  buildLocalHomepageContent,
  localHomepagePlanSchema,
} from "./local-experience-homepage-plan.mjs";

const sourceSql = `SELECT i.id AS "idolId",h.idol_revision_id AS "idolRevisionId",
 coalesce(d.document#>>'{source,fields,displayName}',t.display_name) AS "displayName",
 desktop.media_asset_id AS "desktopMediaAssetId",desktop.media_metadata_revision_id AS "desktopMediaMetadataRevisionId",
 mobile.media_asset_id AS "mobileMediaAssetId",mobile.media_metadata_revision_id AS "mobileMediaMetadataRevisionId"
 FROM idols i JOIN idol_publication_heads h ON h.idol_id=i.id AND h.idol_revision_id=i.published_revision_id
 JOIN content_publications p ON p.id=h.publication_id
 JOIN idol_revision_media desktop ON desktop.idol_revision_id=h.idol_revision_id AND desktop.role='HERO_DESKTOP'
 JOIN idol_revision_media mobile ON mobile.idol_revision_id=h.idol_revision_id AND mobile.role='HERO_MOBILE'
 LEFT JOIN daily_publication_revisions d ON d.revision_id=h.idol_revision_id
 LEFT JOIN idol_revision_translations t ON t.idol_revision_id=h.idol_revision_id AND t.locale='en'
 WHERE i.status='active' AND i.accepting_gifts
 AND EXISTS(SELECT 1 FROM policy_publication_heads WHERE policy_key='delivery')
 ORDER BY p.published_at,i.id LIMIT 1`;

export async function bootstrapLocalHomepageOnce({
  config: inputConfig,
  database,
  base,
  workspaceRoot = inputConfig.workspaceRoot,
}) {
  const config = localExperienceConfigSchema.parse(inputConfig);
  if (!["127.0.0.1", "::1", "localhost"].includes(database.host))
    throw new Error("Homepage bootstrap requires loopback PostgreSQL");
  const client = new Client(database);
  await client.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtextextended('local-experience-homepage',0))",
    );
    await client.query(
      "CREATE TABLE IF NOT EXISTS local_experience.homepage_bootstrap(id integer PRIMARY KEY CHECK(id=1),instance_id uuid NOT NULL,state jsonb NOT NULL)",
    );
    const existing = (
      await client.query(
        "SELECT instance_id,state FROM local_experience.homepage_bootstrap WHERE id=1",
      )
    ).rows[0];
    if (existing && existing.instance_id !== config.instanceId)
      throw new Error("Homepage bootstrap ownership mismatch");
    let plan = existing
      ? localHomepagePlanSchema.parse(existing.state)
      : undefined;
    const save = async () => {
      localHomepagePlanSchema.parse(plan);
      await client.query(
        "UPDATE local_experience.homepage_bootstrap SET state=$1 WHERE id=1 AND instance_id=$2",
        [plan, config.instanceId],
      );
    };
    if (plan?.sessionIds.length) {
      await client.query(
        "UPDATE admin_sessions SET revoked_at=clock_timestamp() WHERE id=ANY($1::uuid[]) AND revoked_at IS NULL",
        [plan.sessionIds],
      );
      plan.sessionIds = [];
      await save();
    }
    if (
      (await client.query("SELECT 1 FROM homepage_publication_heads")).rowCount
    )
      return { done: true, outcome: "PRESERVED" };
    if (
      !plan &&
      (await client.query("SELECT 1 FROM homepage_revisions LIMIT 1")).rowCount
    )
      return { done: true, outcome: "PRESERVED_DRAFT" };
    const candidate = (await client.query(sourceSql)).rows[0];
    if (!candidate) return { done: false, outcome: "WAITING_FOR_ARTIST" };
    const source = localHomepageSourceSchema.parse(candidate);
    if (!plan) {
      plan = localHomepagePlanSchema.parse({
        schemaVersion: 1,
        testOnly: true,
        source,
        content: buildLocalHomepageContent(source),
        sessionIds: [],
      });
      await client.query(
        "INSERT INTO local_experience.homepage_bootstrap(id,instance_id,state) VALUES(1,$1,$2)",
        [config.instanceId, plan],
      );
    } else if (JSON.stringify(plan.source) !== JSON.stringify(source)) {
      throw new Error(
        "Original homepage bootstrap artist or media changed; existing content was preserved",
      );
    }
    return await withLocalHomepageSessions(
      {
        client,
        config,
        base: base ?? `http://127.0.0.1:${config.ports.api}`,
        saveSessionIds: async (ids) => {
          plan.sessionIds = ids;
          await save();
        },
      },
      async (content) => {
        await prepareLocalHomepageAssets({
          workspaceRoot,
          client,
          content,
          plan,
          save,
        });
        const reviewed = buildLocalHomepageContent({
          ...plan.source,
          desktopMediaAssetId: plan.posterAssets.desktop.assetId,
          desktopMediaMetadataRevisionId:
            plan.posterAssets.desktop.metadata.revisionId,
          mobileMediaAssetId: plan.posterAssets.mobile.assetId,
          mobileMediaMetadataRevisionId:
            plan.posterAssets.mobile.metadata.revisionId,
        });
        if (!matchingLocalHomepage(plan.content, reviewed)) {
          if (plan.revisionId) {
            plan.retiredRevisionIds = [
              ...(plan.retiredRevisionIds ?? []),
              plan.revisionId,
            ];
            delete plan.revisionId;
          }
          plan.content = reviewed;
          await save();
        }
        return publishLocalHomepage({ client, content, plan, save });
      },
    );
  } finally {
    await client.end();
  }
}

export function createLocalHomepageLoop({
  run,
  intervalMs = 1000,
  onFailure = () => undefined,
  onComplete = () => undefined,
}) {
  let pending,
    timer,
    running = false,
    done = false,
    closing;
  function runOnce() {
    if (closing || done)
      return Promise.resolve({ done: true, outcome: "STOPPED" });
    pending ??= Promise.resolve()
      .then(run)
      .then((result) => {
        done = result.done;
        if (done) onComplete(result);
        return result;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  function tick() {
    if (!running || done || closing) return;
    void runOnce()
      .catch(() => onFailure("LOCAL_HOMEPAGE_BOOTSTRAP_UNAVAILABLE"))
      .finally(() => {
        if (running && !done && !closing) {
          timer = setTimeout(tick, intervalMs);
          timer.unref();
        }
      });
  }
  return {
    runOnce,
    start() {
      if (!running && !closing) {
        running = true;
        tick();
      }
    },
    stop() {
      closing ??= (async () => {
        running = false;
        clearTimeout(timer);
        await pending?.catch(() => undefined);
      })();
      return closing;
    },
  };
}

export async function startLocalHomepageBootstrap(context) {
  const config = localExperienceConfigSchema.parse(context.config);
  if (!["127.0.0.1", "::1", "localhost"].includes(context.database.host))
    throw new Error("Homepage bootstrap requires loopback PostgreSQL");
  const loop = createLocalHomepageLoop({
    run: () => bootstrapLocalHomepageOnce({ ...context, config }),
    onFailure: (code) => context.progress?.(code),
    onComplete: (result) =>
      context.progress?.("local TEST homepage " + result.outcome.toLowerCase()),
  });
  context.own("local TEST initial homepage", () => loop.stop());
  loop.start();
  return loop;
}
