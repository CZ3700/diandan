"use client";
import { useId, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import {
  mediaMetadataRevisionIdSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { CatalogPicker } from "./catalog-picker";
import { Select, type Translate } from "./components";
import type { AdminClient } from "./client";
import { orderGiftMedia, type GiftContent } from "./gift-editor-model";

export function GiftStructureFields({
  content,
  onChange,
  client,
  locale,
  t,
  disabled,
}: {
  content: GiftContent;
  onChange: (content: GiftContent) => void;
  client: AdminClient;
  locale: SupportedLocale;
  t: Translate;
  disabled: boolean;
}) {
  const id = useId();
  const [pick, setPick] = useState<"PRIMARY" | "GALLERY" | null>(null);
  const update = (change: Partial<GiftContent["structure"]>) =>
    onChange({ ...content, structure: { ...content.structure, ...change } });
  return (
    <fieldset disabled={disabled} className="admin-fields">
      <p className="admin-notice">{t("studioDelivery")}</p>
      <Select
        label={t("giftCategory")}
        value={content.structure.category}
        onChange={(value) =>
          update({ category: value as GiftContent["structure"]["category"] })
        }
      >
        {(
          [
            ["FLOWERS", "categoryFlowers"],
            ["FOOD", "categoryFood"],
            ["BEAUTY", "categoryBeauty"],
            ["ACCESSORY", "categoryAccessory"],
            ["OTHER", "categoryOther"],
          ] as const
        ).map(([value, label]) => (
          <option key={value} value={value}>
            {t(label)}
          </option>
        ))}
      </Select>
      <div className="admin-form-grid">
        {(
          [
            ["minimum", "deliveryMin"],
            ["maximum", "deliveryMax"],
          ] as const
        ).map(([key, label]) => (
          <Field
            key={key}
            id={`${id}-${key}`}
            label={t(label)}
            type="number"
            min={1}
            step={1}
            value={content.structure.deliveryEstimate[key]}
            onChange={(event) =>
              update({
                deliveryEstimate: {
                  ...content.structure.deliveryEstimate,
                  [key]: Number(event.target.value),
                },
              })
            }
          />
        ))}
        <Select
          label={t("unit")}
          value={content.structure.deliveryEstimate.unit}
          onChange={(unit) =>
            update({
              deliveryEstimate: {
                ...content.structure.deliveryEstimate,
                unit: unit as "DAY" | "WEEK",
              },
            })
          }
        >
          <option value="DAY">{t("days")}</option>
          <option value="WEEK">{t("weeks")}</option>
        </Select>
      </div>
      <label className="admin-checkbox">
        <input
          type="checkbox"
          checked={content.structure.requiresSafetyNotice}
          onChange={(e) => update({ requiresSafetyNotice: e.target.checked })}
        />
        {t("requiresSafetyNotice")}
      </label>
      <h3>{t("contents")}</h3>
      {content.structure.contents.map((component, index) => (
        <div className="admin-form-grid" key={index}>
          <Field
            id={`${id}-code-${index}`}
            label={t("componentCode")}
            value={component.componentCode}
            maxLength={64}
            onChange={(e) =>
              update({
                contents: content.structure.contents.map((row, i) =>
                  i === index ? { ...row, componentCode: e.target.value } : row,
                ),
              })
            }
          />
          <Field
            id={`${id}-quantity-${index}`}
            label={t("quantity")}
            type="number"
            min={1}
            step={1}
            value={component.quantity}
            onChange={(e) =>
              update({
                contents: content.structure.contents.map((row, i) =>
                  i === index
                    ? { ...row, quantity: Number(e.target.value) }
                    : row,
                ),
              })
            }
          />
          <Select
            label={t("unit")}
            value={component.unit}
            onChange={(unit) =>
              update({
                contents: content.structure.contents.map((row, i) =>
                  i === index ? { ...row, unit: unit as typeof row.unit } : row,
                ),
              })
            }
          >
            <option value="ITEM">{t("unitItem")}</option>
            <option value="GRAM">{t("unitGram")}</option>
            <option value="MILLILITER">{t("unitMilliliter")}</option>
          </Select>
          <Button
            variant="quiet"
            disabled={disabled || content.structure.contents.length === 1}
            onClick={() =>
              update({
                contents: content.structure.contents.filter(
                  (_, i) => i !== index,
                ),
              })
            }
          >
            {t("remove")}
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        disabled={disabled || content.structure.contents.length >= 32}
        onClick={() =>
          update({
            contents: [
              ...content.structure.contents,
              {
                componentCode: `ITEM_${content.structure.contents.length + 1}`,
                quantity: 1,
                unit: "ITEM",
              },
            ],
          })
        }
      >
        {t("addItem")}
      </Button>
      <h3>{t("media")}</h3>
      {content.media.map((media, index) => (
        <div className="admin-media-slot" key={`${media.role}-${index}`}>
          <strong>
            {t(media.role === "PRIMARY" ? "primaryImage" : "gallery")}
          </strong>
          <small className="admin-muted">{media.mediaAssetId}</small>
          <Button
            variant="quiet"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...content,
                media: orderGiftMedia(
                  content.media.filter((_, i) => i !== index),
                ),
              })
            }
          >
            {t("remove")}
          </Button>
        </div>
      ))}
      <div className="admin-actions">
        {(["PRIMARY", "GALLERY"] as const).map((role) => (
          <Button
            key={role}
            variant="secondary"
            disabled={
              disabled ||
              (role === "GALLERY" &&
                content.media.filter((m) => m.role === role).length >= 12)
            }
            onClick={() => setPick(role)}
          >
            {t(role === "PRIMARY" ? "primaryImage" : "gallery")}
          </Button>
        ))}
      </div>
      {pick && (
        <CatalogPicker
          client={client}
          locale={locale}
          kind="MEDIA_METADATA"
          t={t}
          onChoose={(owner) => {
            if (
              owner.target.kind !== "MEDIA_METADATA" ||
              owner.media?.processingStatus !== "READY" ||
              owner.media.rightsStatus !== "APPROVED" ||
              !owner.publishedRevisionId
            )
              return;
            const rows =
              pick === "PRIMARY"
                ? content.media.filter((m) => m.role !== "PRIMARY")
                : content.media;
            onChange({
              ...content,
              media: orderGiftMedia([
                ...rows,
                {
                  mediaAssetId: owner.target.mediaAssetId,
                  mediaMetadataRevisionId: mediaMetadataRevisionIdSchema.parse(
                    owner.publishedRevisionId,
                  ),
                  role: pick,
                  sortOrder:
                    pick === "PRIMARY"
                      ? 0
                      : rows.filter((m) => m.role === "GALLERY").length,
                },
              ]),
            });
            setPick(null);
          }}
        />
      )}
    </fieldset>
  );
}
