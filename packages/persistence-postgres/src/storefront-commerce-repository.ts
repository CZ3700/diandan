import {
  DEFAULT_LOCALE,
  publishedContentReadCommandSchema,
  storefrontContextReadCommandSchema,
  storefrontContextResponseSchema,
  storefrontGiftReadCommandSchema,
  storefrontGiftContextResponseSchema,
  type StorefrontGiftContextResponse,
} from "@fan-support/contracts";
import {
  projectPublishedContent,
  projectPublishedGiftCommerce,
} from "@fan-support/content";
import type { StorefrontCommerceRepository } from "@fan-support/persistence-port";
import { draftRows } from "./content-draft-data.js";
import { loadPublishedContentContext } from "./published-content-repository.js";
import { readGiftPublicationProfile } from "./gift-commerce-gift-profile.js";
import { createResourceRun } from "./resource-management-data.js";
import {
  readStorefrontMarkets,
  hasStorefrontMarket,
  readStorefrontVariantFacts,
  type StorefrontRecipientWitness,
} from "./storefront-commerce-data.js";
import type {
  TransactionClient,
  TransactionScopeControl,
} from "./transaction-runner.js";

export async function verifyStorefrontRecipientWitnesses(
  witnesses: readonly StorefrontRecipientWitness[],
  load: (witness: StorefrontRecipientWitness) => Promise<boolean>,
): Promise<Set<string>> {
  const verified = new Set<string>();
  const variants = new Set<string>();
  for (const witness of witnesses) {
    const id = witness.idolId.toLowerCase();
    if (!verified.has(id)) {
      if (!(await load(witness)))
        throw new Error("STOREFRONT_RECIPIENT_PROOF_UNAVAILABLE");
      verified.add(id);
    }
    variants.add(witness.variantId.toLowerCase());
  }
  return variants;
}

/** Content proofs, current operating facts and commerce scopes share one SERIALIZABLE snapshot. */
export function createStorefrontCommerceRepository(
  client: TransactionClient,
  scope: TransactionScopeControl,
  publicMediaBaseUrl: string,
): StorefrontCommerceRepository {
  const run = createResourceRun(client, scope);
  const load = (
    kind: "IDOL" | "GIFT" | "POLICY",
    key: string,
    locale: string,
  ) =>
    loadPublishedContentContext(
      client,
      scope,
      publishedContentReadCommandSchema.parse({
        schemaVersion: 1,
        locale,
        locator:
          kind === "POLICY" ? { kind, policyKey: key } : { kind, handle: key },
      }),
      publicMediaBaseUrl,
    );
  return {
    readContext(input) {
      if (!storefrontContextReadCommandSchema.safeParse(input).success)
        return Promise.resolve({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "INVALID_QUERY",
        });
      return run(async () => {
        const markets = await readStorefrontMarkets(client);
        const keys = await draftRows(
          client,
          `SELECT policy.policy_key FROM public.policies policy
          JOIN public.policy_publication_heads head ON head.policy_key=policy.policy_key
          ORDER BY policy.policy_key COLLATE "C" LIMIT 501`,
        );
        if (keys.length > 500)
          return {
            schemaVersion: 1,
            outcome: "FAILURE",
            code: "COMMERCE_UNAVAILABLE",
          } as const;
        const policies = [];
        for (const key of keys) {
          const loaded = await load(
            "POLICY",
            String(key["policy_key"]),
            DEFAULT_LOCALE,
          );
          if (loaded.outcome !== "SUCCESS") continue;
          const projected = projectPublishedContent(loaded.context);
          if (
            projected.outcome === "SUCCESS" &&
            projected.content.kind === "POLICY"
          )
            policies.push({
              policyKey: projected.content.view.policyKey,
              kind: projected.content.view.kind,
            });
        }
        return storefrontContextResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "STOREFRONT_CONTEXT",
          markets,
          policies,
        });
      });
    },
    loadGift(input) {
      const parsed = storefrontGiftReadCommandSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve({
          schemaVersion: 1,
          outcome: "FAILURE",
          code: "INVALID_QUERY",
        });
      return run(async (): Promise<StorefrontGiftContextResponse> => {
        const command = parsed.data;
        const loaded = await load("GIFT", command.handle, command.locale);
        if (loaded.outcome !== "SUCCESS") return loaded;
        const context = loaded.context;
        const publication = context.publication;
        let gift;
        if (context.schemaVersion === 3) {
          if (context.current.document.kind !== "GIFT")
            return {
              schemaVersion: 1,
              outcome: "FAILURE",
              code: "CONTENT_UNAVAILABLE",
            };
          gift = { ...loaded, profileVersion: 3 as const, profile: null };
        } else {
          const owner = context.publication.target.owner;
          if (owner.kind !== "GIFT")
            return {
              schemaVersion: 1,
              outcome: "FAILURE",
              code: "CONTENT_UNAVAILABLE",
            };
          const profile = await readGiftPublicationProfile(client, {
            publicationId: publication.publicationId,
            giftId: owner.giftId,
            giftRevisionId: context.publication.target.revisionId,
            manifestHash: publication.manifestHash,
          });
          gift = {
            ...loaded,
            profileVersion: profile === null ? (1 as const) : (2 as const),
            profile,
          };
        }
        const projected = projectPublishedGiftCommerce(gift);
        if (projected.outcome !== "SUCCESS") return projected;
        if (
          !(await hasStorefrontMarket(client, command.market, command.currency))
        )
          return {
            schemaVersion: 1,
            outcome: "FAILURE",
            code: "MARKET_UNAVAILABLE",
          };
        const recipientId =
          "wish" in projected.content.view
            ? (projected.content.view.wish?.artistId ?? command.idolId)
            : command.idolId;
        let recipient: Extract<
          StorefrontGiftContextResponse,
          { outcome: "SUCCESS" }
        >["recipient"] = { kind: "NONE" };
        if (recipientId !== undefined) {
          recipient = { kind: "UNAVAILABLE", idolId: recipientId };
          const rows = await draftRows(
            client,
            `SELECT handle FROM public.idols WHERE id=$1`,
            [recipientId],
          );
          if (rows.length === 1) {
            const artist = await load(
              "IDOL",
              String(rows[0]?.["handle"]),
              command.locale,
            );
            if (artist.outcome === "SUCCESS") {
              const publicArtist = projectPublishedContent(artist.context);
              if (
                publicArtist.outcome === "SUCCESS" &&
                publicArtist.content.kind === "IDOL" &&
                publicArtist.content.view.id.toLowerCase() ===
                  recipientId.toLowerCase()
              )
                recipient = { kind: "PUBLISHED", context: artist.context };
            }
          }
        }
        const current = await readStorefrontVariantFacts(client, {
          giftId: projected.content.view.id,
          variantIds: projected.content.view.variants.map(
            (variant) => variant.id,
          ),
          market: command.market,
          currency: command.currency,
          idolId: recipientId ?? null,
        });
        const proven = await verifyStorefrontRecipientWitnesses(
          current.witnesses,
          async (witness) => {
            const artist = await load("IDOL", witness.handle, command.locale);
            if (artist.outcome !== "SUCCESS") return false;
            const content = projectPublishedContent(artist.context);
            return (
              content.outcome === "SUCCESS" &&
              content.content.kind === "IDOL" &&
              content.content.view.id.toLowerCase() ===
                witness.idolId.toLowerCase() &&
              content.content.view.status === "active" &&
              content.content.view.acceptingGifts &&
              content.content.view.localeContext.requestedLocale ===
                command.locale &&
              (content.content.view.localeContext.schemaVersion === 2 ||
                (content.content.view.localeContext.resolvedLocale ===
                  command.locale &&
                  !content.content.view.localeContext.fallbackUsed))
            );
          },
        );
        return storefrontGiftContextResponseSchema.parse({
          schemaVersion: 1,
          outcome: "SUCCESS",
          command,
          gift,
          recipient,
          variants: current.facts.map((fact) => ({
            ...fact,
            hasEligibleRecipient: proven.has(fact.giftVariantId.toLowerCase()),
          })),
        });
      });
    },
  };
}
