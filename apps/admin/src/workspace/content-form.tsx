"use client";
import { useId, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import {
  mediaMetadataRevisionIdSchema,
  type ContentAuthoringContent,
  type GiftTranslationFields,
  type SupportedLocale,
} from "@fan-support/contracts";
import { type AdminMessageKey } from "@fan-support/i18n";
import { type AdminClient } from "./client";
import { CatalogPicker } from "./catalog-picker";
import { Select, TextArea, type Translate } from "./components";
import { GiftStructureFields } from "./gift-structure";

const limits: Record<string, number> = {
  displayName: 40,
  shortBio: 160,
  fullBio: 600,
  seoTitle: 60,
  seoDescription: 155,
  heroTitle: 120,
  heroSubtitle: 240,
  ctaLabel: 80,
  announcement: 240,
  alt: 300,
  title: 160,
  caption: 300,
  subtitle: 80,
  shortDescription: 160,
  description: 600,
  fulfillmentDescription: 600,
  safetyNotice: 600,
};
const fieldKeys: Record<string, AdminMessageKey> = {
  displayName: "displayName",
  shortBio: "shortBio",
  fullBio: "fullBio",
  seoTitle: "seoTitle",
  seoDescription: "seoDescription",
  heroTitle: "heroTitle",
  heroSubtitle: "heroSubtitle",
  ctaLabel: "ctaLabel",
  announcement: "announcement",
  alt: "alt",
  title: "title",
  caption: "caption",
  subtitle: "subtitle",
  shortDescription: "shortDescription",
  description: "description",
  fulfillmentDescription: "fulfillmentDescription",
  safetyNotice: "safetyNotice",
};
const giftFieldOrder = [
  "title",
  "subtitle",
  "shortDescription",
  "description",
  "fulfillmentDescription",
  "safetyNotice",
  "variantLabels",
  "seoTitle",
  "seoDescription",
] as const satisfies readonly (keyof GiftTranslationFields)[];

export function ContentFields({
  fields,
  onChange,
  t,
  disabled = false,
  errors = [],
}: {
  fields: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  t: Translate;
  disabled?: boolean;
  errors?: readonly string[];
}) {
  const fieldId = useId();
  // Only gift fields have variantLabels. Keep optional source fields in place
  // so the editor and its English reference share the same reading order.
  const entries: [string, unknown][] = Array.isArray(fields["variantLabels"])
    ? giftFieldOrder.map((key) => [key, fields[key]])
    : Object.entries(fields);
  return (
    <div className="admin-fields">
      {entries.map(([key, value]) =>
        Array.isArray(value) ? (
          <div key={key} className="admin-fields">
            {value.map(
              (
                row: {
                  slotKey?: string;
                  giftVariantId?: string;
                  label: string;
                },
                index,
              ) => (
                <Field
                  key={row.giftVariantId ?? row.slotKey}
                  id={`${fieldId}-label-${index}`}
                  label={`${t(key === "variantLabels" ? "variantLabel" : "slotLabel")} · ${index + 1}`}
                  value={row.label}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange({
                      ...fields,
                      [key]: value.map((item: unknown, i: number) =>
                        i === index
                          ? { ...row, label: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              ),
            )}
          </div>
        ) : (
          <TextArea
            key={key}
            label={fieldKeys[key] ? t(fieldKeys[key]) : key}
            value={typeof value === "string" ? value : ""}
            maxLength={limits[key]}
            disabled={disabled}
            error={errors.includes(key) ? t("invalid") : undefined}
            onChange={(text) => onChange({ ...fields, [key]: text })}
          />
        ),
      )}
    </div>
  );
}
type IdolContent = Extract<ContentAuthoringContent, { kind: "IDOL" }>;
type HomepageContent = Extract<ContentAuthoringContent, { kind: "HOMEPAGE" }>;
type MediaContent = Extract<
  ContentAuthoringContent,
  { kind: "MEDIA_METADATA" }
>;
export function StructureFields({
  content,
  onChange,
  client,
  locale,
  t,
  disabled = false,
}: {
  content: ContentAuthoringContent;
  onChange: (value: ContentAuthoringContent) => void;
  client: AdminClient;
  locale: SupportedLocale;
  t: Translate;
  disabled?: boolean;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const selectProps = { client, locale, t };
  if (content.kind === "GIFT")
    return (
      <GiftStructureFields
        content={content}
        onChange={onChange}
        client={client}
        locale={locale}
        t={t}
        disabled={disabled}
      />
    );
  if (content.kind === "IDOL") {
    const structure = (value: Partial<IdolContent["structure"]>) =>
      onChange({ ...content, structure: { ...content.structure, ...value } });
    const roles = [
      { role: "PORTRAIT", label: "portrait" },
      { role: "HERO_DESKTOP", label: "heroDesktop" },
      { role: "HERO_MOBILE", label: "heroMobile" },
      { role: "GALLERY", label: "gallery" },
    ] as const;
    return (
      <fieldset disabled={disabled} className="admin-fields">
        <div className="admin-form-grid">
          <Field
            id="theme-accent"
            label={t("themeAccent")}
            type="color"
            value={content.structure.themeAccent}
            onChange={(e) => structure({ themeAccent: e.target.value })}
          />
          <Select
            label={t("heroTextTone")}
            value={content.structure.heroTextTone}
            onChange={(v) => structure({ heroTextTone: v as "light" | "dark" })}
          >
            <option value="light">{t("light")}</option>
            <option value="dark">{t("dark")}</option>
          </Select>
          <Field
            id="display-order"
            label={t("displayOrder")}
            type="number"
            min={0}
            step={1}
            value={content.structure.displayOrder}
            onChange={(e) =>
              structure({ displayOrder: Number(e.target.value) })
            }
          />
        </div>
        {roles.map(({ role, label }) => (
          <div className="admin-media-slot" key={role}>
            <strong>{t(label)}</strong>
            {content.media
              .filter((ref) => ref.role === role)
              .map((ref) => (
                <div key={ref.mediaAssetId} className="admin-actions">
                  <code>{ref.mediaAssetId.slice(0, 8)}</code>
                  <Button
                    variant="quiet"
                    onClick={() =>
                      onChange({
                        ...content,
                        media: content.media.filter((row) => row !== ref),
                      })
                    }
                  >
                    {t("remove")}
                  </Button>
                </div>
              ))}
            <Button
              variant="secondary"
              onClick={() => setPick(pick === role ? null : role)}
            >
              {t("chooseMedia")}
            </Button>
            {pick === role && (
              <CatalogPicker
                {...selectProps}
                kind="MEDIA_METADATA"
                onChoose={(owner) => {
                  if (owner.target.kind !== "MEDIA_METADATA") return;
                  const revisionId =
                    owner.publishedRevisionId ??
                    owner.draftRevisionId ??
                    owner.latestRevisionId;
                  if (!revisionId) return;
                  const assetId = owner.target.mediaAssetId;
                  onChange({
                    ...content,
                    media: [
                      ...content.media.filter((ref) =>
                        role === "GALLERY"
                          ? ref.mediaAssetId !== assetId
                          : ref.role !== role,
                      ),
                      {
                        role,
                        mediaAssetId: assetId,
                        mediaMetadataRevisionId:
                          mediaMetadataRevisionIdSchema.parse(revisionId),
                        sortOrder: content.media.filter(
                          (ref) => ref.role === role,
                        ).length,
                      },
                    ],
                  });
                  setPick(null);
                }}
              />
            )}
          </div>
        ))}
      </fieldset>
    );
  }
  if (content.kind === "MEDIA_METADATA") {
    const structure = (patch: Partial<MediaContent["structure"]>) =>
      onChange({ ...content, structure: { ...content.structure, ...patch } });
    return (
      <fieldset disabled={disabled} className="admin-form-grid">
        <Select
          label={t("presentationKind")}
          value={content.structure.presentationKind}
          onChange={(v) =>
            structure({ presentationKind: v as "INFORMATIVE" | "DECORATIVE" })
          }
        >
          <option value="INFORMATIVE">{t("informative")}</option>
          <option value="DECORATIVE">{t("decorative")}</option>
        </Select>
        {(["x", "y"] as const).map((axis) => (
          <Field
            key={axis}
            id={`focal-${axis}`}
            label={t(axis === "x" ? "focalX" : "focalY")}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={content.structure.focalPoint[axis]}
            onChange={(e) =>
              structure({
                focalPoint: {
                  ...content.structure.focalPoint,
                  [axis]: Number(e.target.value),
                },
              })
            }
          />
        ))}
      </fieldset>
    );
  }
  if (content.kind !== "HOMEPAGE") return null;
  const slots = content.structure.slots;
  const update = (next: HomepageContent["structure"]["slots"]) =>
    onChange({
      ...content,
      structure: {
        slots: next.map((slot, index) => ({ ...slot, sortOrder: index })),
      },
      translations: content.translations.map((row) => ({
        ...row,
        fields: {
          ...row.fields,
          slotLabels: next.map(
            (slot) =>
              row.fields.slotLabels.find(
                (label) => label.slotKey === slot.slotKey,
              ) ?? { slotKey: slot.slotKey, label: "" },
          ),
        },
      })),
    });
  const replace = (index: number, patch: Record<string, unknown>) =>
    update(
      slots.map((slot, i) =>
        i === index ? { ...slot, ...patch } : slot,
      ) as HomepageContent["structure"]["slots"],
    );
  return (
    <fieldset disabled={disabled} className="admin-fields">
      <legend>{t("slots")}</legend>
      {slots.map((slot, index) => (
        <div className="admin-slot" key={slot.slotKey}>
          <div className="admin-section-heading">
            <strong>{slot.slotKey}</strong>
            <div className="admin-actions">
              <Button
                variant="quiet"
                disabled={index === 0}
                aria-label={t("moveUp")}
                onClick={() => {
                  const next = [...slots];
                  [next[index - 1], next[index]] = [
                    next[index]!,
                    next[index - 1]!,
                  ];
                  update(next);
                }}
              >
                ↑
              </Button>
              <Button
                variant="quiet"
                disabled={index === slots.length - 1}
                aria-label={t("moveDown")}
                onClick={() => {
                  const next = [...slots];
                  [next[index + 1], next[index]] = [
                    next[index]!,
                    next[index + 1]!,
                  ];
                  update(next);
                }}
              >
                ↓
              </Button>
              <Button
                variant="quiet"
                onClick={() => update(slots.filter((_, i) => i !== index))}
              >
                {t("remove")}
              </Button>
            </div>
          </div>
          <Select
            label={t("role")}
            value={slot.kind}
            onChange={(kind) => {
              const base = { slotKey: slot.slotKey, sortOrder: index };
              const next =
                kind === "HERO_IDOL"
                  ? {
                      ...base,
                      kind,
                      idolId: "",
                      desktopMediaAssetId: "",
                      desktopMediaMetadataRevisionId: "",
                      mobileMediaAssetId: "",
                      mobileMediaMetadataRevisionId: "",
                    }
                  : kind === "FEATURED_IDOL"
                    ? { ...base, kind, idolId: "" }
                    : kind === "FEATURED_GIFT"
                      ? { ...base, kind, giftId: "" }
                      : { ...base, kind, policyKey: "" };
              update(
                slots.map((row, i) =>
                  i === index ? next : row,
                ) as HomepageContent["structure"]["slots"],
              );
            }}
          >
            <option value="HERO_IDOL">{t("heroTitle")}</option>
            <option value="FEATURED_IDOL">{t("featuredArtist")}</option>
            <option value="FEATURED_GIFT">{t("featuredGift")}</option>
            <option value="POLICY_LINK">{t("policyLink")}</option>
          </Select>
          <Button
            variant="secondary"
            onClick={() => setPick(pick === slot.slotKey ? null : slot.slotKey)}
          >
            {slot.kind === "POLICY_LINK"
              ? t("policyLink")
              : slot.kind === "FEATURED_GIFT"
                ? t("featuredGift")
                : t("artists")}
          </Button>
          {"idolId" in slot && <code>{slot.idolId.slice(0, 8)}</code>}
          {"giftId" in slot && <code>{slot.giftId.slice(0, 8)}</code>}
          {"policyKey" in slot && <code>{slot.policyKey}</code>}
          {pick === slot.slotKey && (
            <CatalogPicker
              {...selectProps}
              kind={
                slot.kind === "POLICY_LINK"
                  ? "POLICY"
                  : slot.kind === "FEATURED_GIFT"
                    ? "GIFT"
                    : "IDOL"
              }
              onChoose={(owner) => {
                const target = owner.target;
                replace(
                  index,
                  target.kind === "IDOL"
                    ? { idolId: target.idolId }
                    : target.kind === "GIFT"
                      ? { giftId: target.giftId }
                      : target.kind === "POLICY"
                        ? { policyKey: target.policyKey }
                        : {},
                );
                setPick(null);
              }}
            />
          )}
          {slot.kind === "HERO_IDOL" &&
            (["desktop", "mobile"] as const).map((viewport) => (
              <div key={viewport}>
                <Button
                  variant="secondary"
                  onClick={() => setPick(`${slot.slotKey}-${viewport}`)}
                >
                  {t(viewport === "desktop" ? "heroDesktop" : "heroMobile")}
                </Button>
                <code>{slot[`${viewport}MediaAssetId`].slice(0, 8)}</code>
                {pick === `${slot.slotKey}-${viewport}` && (
                  <CatalogPicker
                    {...selectProps}
                    kind="MEDIA_METADATA"
                    onChoose={(owner) => {
                      const revisionId =
                        owner.publishedRevisionId ??
                        owner.draftRevisionId ??
                        owner.latestRevisionId;
                      if (owner.target.kind !== "MEDIA_METADATA" || !revisionId)
                        return;
                      replace(index, {
                        [`${viewport}MediaAssetId`]: owner.target.mediaAssetId,
                        [`${viewport}MediaMetadataRevisionId`]: revisionId,
                      });
                      setPick(null);
                    }}
                  />
                )}
              </div>
            ))}
        </div>
      ))}
      <Button
        variant="secondary"
        disabled={slots.length >= 32}
        onClick={() =>
          update([
            ...slots,
            {
              slotKey: `section-${crypto.randomUUID().slice(0, 8)}`,
              kind: "FEATURED_IDOL",
              idolId: "",
              sortOrder: slots.length,
            },
          ] as HomepageContent["structure"]["slots"])
        }
      >
        {t("addSlot")}
      </Button>
    </fieldset>
  );
}
