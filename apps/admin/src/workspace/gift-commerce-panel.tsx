"use client";
import { useEffect, useId, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import type { GiftCommerceVariant } from "@fan-support/contracts";
import { CatalogPicker } from "./catalog-picker";
import { Select, Status } from "./components";
import { callCommerce } from "./gift-commerce-client";
import { GiftPrices } from "./gift-prices";
import { GiftInventory } from "./gift-inventory";
import { GiftEligibility } from "./gift-eligibility";
import {
  policyLabels,
  policyHints,
  type CommercePanelProps,
} from "./gift-commerce-shared";
export function GiftCommercePanel(props: CommercePanelProps) {
  const { gift, client, context, t, busy, reason, run, refresh, onDirty } =
    props;
  const [tab, setTab] = useState<"variants" | "prices" | "inventory">(
    "variants",
  );
  const [dirty, setDirty] = useState(false);
  const [generation, setGeneration] = useState(0);
  const changed = (value: boolean) => {
    setDirty(value);
    onDirty(value);
  };
  return (
    <details className="admin-commerce" open={gift.variants.length === 0}>
      <summary>
        {t("variants")} · {t("prices")} · {t("inventory")}
      </summary>
      <p className="admin-muted">{t("studioDelivery")}</p>
      <div className="admin-actions" role="group" aria-label={t("status")}>
        <Status value={gift.gift.status} t={t} />
        {(["active", "paused", "archived"] as const).map((status) => (
          <Button
            key={status}
            variant="quiet"
            disabled={
              busy ||
              dirty ||
              gift.gift.status === status ||
              gift.gift.status === "archived" ||
              !context.permissions.includes("gift.manage")
            }
            onClick={() =>
              run(async () => {
                await callCommerce(client, {
                  schemaVersion: 1,
                  action: "SET_GIFT_STATUS",
                  giftId: gift.gift.id,
                  expectedBaseVersion: gift.gift.version,
                  status,
                  reasonCode: reason,
                });
                refresh();
              }, t("savedCommercial"))
            }
          >
            {t(status)}
          </Button>
        ))}
      </div>
      <div className="admin-commerce-tabs" role="group" aria-label={t("gifts")}>
        {(["variants", "prices", "inventory"] as const).map((value) => (
          <Button
            key={value}
            variant={tab === value ? "secondary" : "quiet"}
            aria-pressed={tab === value}
            disabled={busy}
            onClick={() => {
              if (value === tab || (dirty && !window.confirm(t("discard"))))
                return;
              changed(false);
              setGeneration((i) => i + 1);
              setTab(value);
            }}
          >
            {t(value)}
          </Button>
        ))}
      </div>
      {tab === "variants" ? (
        <GiftVariants
          key={`variants-${generation}`}
          {...props}
          onDirty={changed}
        />
      ) : tab === "prices" ? (
        <GiftPrices key={`prices-${generation}`} {...props} onDirty={changed} />
      ) : (
        <GiftInventory
          key={`inventory-${generation}`}
          {...props}
          onDirty={changed}
        />
      )}
    </details>
  );
}

function GiftVariants({
  gift,
  client,
  context,
  locale,
  t,
  busy,
  reason,
  run,
  refresh,
  onDirty,
}: CommercePanelProps) {
  const id = useId();
  const [selected, setSelected] = useState<GiftCommerceVariant | null>(null);
  const [sku, setSku] = useState("");
  const [policy, setPolicy] =
    useState<GiftCommerceVariant["inventoryPolicy"]>("TRACKED");
  const [status, setStatus] = useState<GiftCommerceVariant["status"]>("draft");
  const [eligible, setEligible] = useState<{ id: string; label: string }[]>([]);
  const [pick, setPick] = useState(false);
  const [dirty, setDirty] = useState(false);
  const canEdit =
    !busy &&
    context.permissions.includes("gift.manage") &&
    gift.gift.status !== "archived";
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const select = (variant: GiftCommerceVariant | null) => {
    if (dirty && !window.confirm(t("discard"))) return;
    setSelected(variant);
    setSku(variant?.sku ?? "");
    setPolicy(variant?.inventoryPolicy ?? "TRACKED");
    setStatus(variant?.status ?? "draft");
    setEligible(
      variant?.eligibleIdolIds.map((id) => ({ id, label: id })) ?? [],
    );
    setDirty(false);
    setPick(false);
  };
  return (
    <section className="admin-fields" aria-label={t("variants")}>
      <div className="admin-variant-list">
        {gift.variants.map((variant) => (
          <button
            type="button"
            className="admin-picker-row"
            aria-pressed={selected?.id === variant.id}
            key={variant.id}
            disabled={busy}
            onClick={() => select(variant)}
          >
            <span>{variant.sku}</span>
            <span>{t(policyLabels[variant.inventoryPolicy])}</span>
            <Status value={variant.status} t={t} />
          </button>
        ))}
      </div>
      <Button
        variant="secondary"
        disabled={!canEdit || gift.variants.length >= 64}
        onClick={() => select(null)}
      >
        {t("addVariant")}
      </Button>
      <fieldset className="admin-fields" disabled={!canEdit}>
        <div className="admin-form-grid">
          <Field
            id={`${id}-sku`}
            label={t("sku")}
            value={sku}
            pattern="[A-Z0-9]+(-[A-Z0-9]+)*"
            maxLength={64}
            onChange={(e) => {
              setSku(e.target.value);
              setDirty(true);
            }}
          />
          <Select
            label={t("inventoryPolicy")}
            value={policy}
            disabled={!canEdit || selected?.policyLocked === true}
            onChange={(value) => {
              setPolicy(value as typeof policy);
              setDirty(true);
            }}
          >
            {Object.entries(policyLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </Select>
          <Select
            label={t("status")}
            value={status}
            disabled={!canEdit || !selected}
            onChange={(value) => {
              setStatus(value as typeof status);
              setDirty(true);
            }}
          >
            {(["draft", "active", "paused", "archived"] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ),
            )}
          </Select>
        </div>
        <p className="admin-notice">{t(policyHints[policy])}</p>
        {selected?.policyLocked && (
          <p className="admin-muted">{t("policyLocked")}</p>
        )}
        <h3>{t("eligibleArtists")}</h3>
        <GiftEligibility
          client={client}
          locale={locale}
          t={t}
          artists={eligible}
          onRemove={(id) => {
            setEligible(eligible.filter((row) => row.id !== id));
            setDirty(true);
          }}
        />
        <Button
          variant="secondary"
          disabled={!canEdit || eligible.length >= 2000}
          onClick={() => setPick(!pick)}
        >
          {t("eligibleArtists")}
        </Button>
        {pick && (
          <CatalogPicker
            client={client}
            locale={locale}
            kind="IDOL"
            t={t}
            onChoose={(owner) => {
              if (owner.target.kind !== "IDOL") return;
              const artistId = owner.target.idolId;
              if (!eligible.some((row) => row.id === artistId)) {
                setEligible([
                  ...eligible,
                  {
                    id: artistId,
                    label: owner.label ?? owner.handle ?? artistId,
                  },
                ]);
                setDirty(true);
              }
              setPick(false);
            }}
          />
        )}
        <div className="admin-actions">
          <Button
            disabled={!canEdit || !sku || !dirty}
            onClick={() =>
              run(async () => {
                await callCommerce(client, {
                  schemaVersion: 1,
                  action: "SAVE_VARIANT",
                  giftId: gift.gift.id,
                  giftVariantId: selected?.id ?? null,
                  expectedBaseVersion: gift.gift.version,
                  expectedVariantVersion: selected?.version ?? 0,
                  sku,
                  status,
                  inventoryPolicy: policy,
                  eligibleIdolIds: eligible.map((row) => row.id),
                  reasonCode: reason,
                });
                setDirty(false);
                setSelected(null);
                setSku("");
                setEligible([]);
                refresh();
              }, t("savedCommercial"))
            }
          >
            {t("saveVariant")}
          </Button>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => select(selected)}
          >
            {t("cancel")}
          </Button>
        </div>
      </fieldset>
    </section>
  );
}
