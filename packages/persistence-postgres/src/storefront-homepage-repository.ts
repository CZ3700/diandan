import {
  publishedContentReadCommandSchema,
  storefrontHomepageReadCommandSchema,
  storefrontHomepageContextResponseSchema,
  type PublishedContentContextResponse,
  type StorefrontHomepageContextResponse,
} from "@fan-support/contracts";
import { projectPublishedContent } from "@fan-support/content";
import type { StorefrontHomepageRepository } from "@fan-support/persistence-port";
import { loadPublishedContentContext } from "./published-content-repository.js";
import { draftRows } from "./content-draft-data.js";
import { createResourceRun } from "./resource-management-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

const unavailable = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "CONTENT_UNAVAILABLE",
} as const;

/** Reads only the current homepage's bounded references in the caller's consistent transaction. */
export function createStorefrontHomepageRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): StorefrontHomepageRepository {
  const run = createResourceRun(client, scope);
  return {
    load(input) {
      const command = storefrontHomepageReadCommandSchema.safeParse(input);
      if (!command.success)
        return Promise.resolve({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "INVALID_QUERY",
        });
      return run(async (): Promise<StorefrontHomepageContextResponse> => {
        const homepage = await loadPublishedContentContext(
          client,
          scope,
          {
            schemaVersion: 1,
            locator: { kind: "HOMEPAGE" },
            locale: command.data.locale,
          },
          publicMediaBaseUrl,
        );
        if (homepage.outcome === "FAILURE") return homepage;
        const projected = projectPublishedContent(homepage.context);
        if (
          projected.outcome !== "SUCCESS" ||
          projected.content.kind !== "HOMEPAGE"
        )
          return unavailable;
        const slots = projected.content.view.slots.filter(
          (row) => row.kind !== "POLICY_LINK",
        );
        const idolIds = [
          ...new Set(
            slots.flatMap((row) =>
              row.kind === "FEATURED_GIFT" ? [] : [row.idolId.toLowerCase()],
            ),
          ),
        ];
        const giftIds = [
          ...new Set(
            slots.flatMap((row) =>
              row.kind === "FEATURED_GIFT" ? [row.giftId.toLowerCase()] : [],
            ),
          ),
        ];
        const rows = await draftRows(
          client,
          `SELECT 'IDOL' AS kind,id,handle,status='archived' AS deleted FROM public.idols WHERE id=ANY($1::uuid[]) AND (status='archived' OR (status IN ('active','paused') AND published_revision_id IS NOT NULL))
          UNION ALL SELECT 'GIFT' AS kind,id,handle,false AS deleted FROM public.gifts WHERE id=ANY($2::uuid[]) AND status IN ('active','paused') AND published_revision_id IS NOT NULL`,
          [idolIds, giftIds],
        );
        const identities = new Map<string, string>();
        // Artists deleted (archived) by operators; only these may leave the hero without an artist.
        const deleted = new Set<string>();
        for (const row of rows) {
          const kind = row["kind"];
          if (row["deleted"] === true && kind === "IDOL") {
            if (
              typeof row["id"] !== "string" ||
              !idolIds.includes(row["id"].toLowerCase())
            )
              return unavailable;
            deleted.add(`IDOL:${row["id"].toLowerCase()}`);
            continue;
          }
          const locator = publishedContentReadCommandSchema.parse({
            schemaVersion: 1,
            locale: command.data.locale,
            locator: { kind, handle: row["handle"] },
          }).locator;
          if (
            (kind !== "IDOL" && kind !== "GIFT") ||
            (locator.kind !== "IDOL" && locator.kind !== "GIFT") ||
            typeof row["id"] !== "string"
          )
            return unavailable;
          const id = row["id"].toLowerCase();
          if (
            !(kind === "IDOL" ? idolIds : giftIds).includes(id) ||
            identities.has(`${kind}:${id}`)
          )
            return unavailable;
          identities.set(`${kind}:${id}`, locator.handle);
        }
        const loaded = new Map<string, PublishedContentContextResponse>();
        const hydrated = [];
        for (const slot of slots) {
          const kind = slot.kind === "FEATURED_GIFT" ? "GIFT" : "IDOL";
          const id = slot.kind === "FEATURED_GIFT" ? slot.giftId : slot.idolId;
          const key = `${kind}:${id.toLowerCase()}`;
          const reference =
            slot.kind === "FEATURED_GIFT"
              ? { slotKey: slot.slotKey, kind: slot.kind, giftId: slot.giftId }
              : { slotKey: slot.slotKey, kind: slot.kind, idolId: slot.idolId };
          const handle = identities.get(key);
          if (handle !== undefined && !loaded.has(key))
            loaded.set(
              key,
              await loadPublishedContentContext(
                client,
                scope,
                publishedContentReadCommandSchema.parse({
                  schemaVersion: 1,
                  locator: { kind, handle },
                  locale: command.data.locale,
                }),
                publicMediaBaseUrl,
              ),
            );
          const content = loaded.get(key);
          if (content?.outcome !== "SUCCESS") {
            // Any other hero failure still fails closed: the poster must never show unverified content.
            if (slot.kind === "HERO_IDOL" && !deleted.has(key))
              return unavailable;
            hydrated.push({ ...reference, status: "UNAVAILABLE" });
          } else
            hydrated.push({
              ...reference,
              status: "AVAILABLE",
              context: content.context,
            });
        }
        return storefrontHomepageContextResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          homepage: homepage.context,
          slots: hydrated,
        });
      });
    },
  };
}
