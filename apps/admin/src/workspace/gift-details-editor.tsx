"use client";
import { useId, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import {
  mediaMetadataRevisionIdSchema,
  type GiftDetailBlock,
  type GiftDetailTranslationFields,
  type SupportedLocale,
} from "@fan-support/contracts";
import { CatalogPicker } from "./catalog-picker";
import { Select, TextArea, type Translate } from "./components";
import type { AdminClient } from "./client";
import {
  alignDetailBlocks,
  replaceDetailTranslation,
  type GiftDetails,
} from "./gift-editor-model";

type TextBlock = GiftDetailTranslationFields["blocks"][number];
const labels = {
  HEADING: "heading",
  PARAGRAPH: "paragraph",
  LIST: "list",
  SPECIFICATIONS: "specifications",
  MEDIA: "media",
} as const;
const identity = () => `item-${crypto.randomUUID()}`;
export function GiftDetailsEditor({
  details,
  locale,
  client,
  t,
  disabled,
  onChange,
}: {
  details: GiftDetails | undefined;
  locale: SupportedLocale;
  client: AdminClient;
  t: Translate;
  disabled: boolean;
  onChange: (details: GiftDetails) => void;
}) {
  const id = useId();
  const [adding, setAdding] = useState<GiftDetailBlock["kind"]>("PARAGRAPH");
  const [pick, setPick] = useState(false);
  const blocks = details?.blocks ?? [];
  const translated = alignDetailBlocks(
    blocks,
    details?.translations.find((row) => row.locale === locale)?.blocks,
  );
  const canStructure = !disabled && locale === "en";
  const structure = (next: GiftDetailBlock[]) => {
    const english = details?.translations.find(
      (row) => row.locale === "en",
    )?.blocks;
    onChange({
      blocks: next,
      translations: [
        {
          locale: "en",
          origin: "HUMAN",
          blocks: alignDetailBlocks(next, english),
        },
      ],
    });
  };
  const text = (index: number, value: TextBlock) => {
    if (details)
      onChange(
        replaceDetailTranslation(
          details,
          locale,
          translated.map((row, i) => (i === index ? value : row)),
        ),
      );
  };
  const changeBlock = (index: number, value: GiftDetailBlock) =>
    structure(blocks.map((row, i) => (i === index ? value : row)));
  const move = (index: number, delta: number) => {
    const next = [...blocks];
    const other = next[index + delta];
    const current = next[index];
    if (!other || !current) return;
    next[index] = other;
    next[index + delta] = current;
    structure(next);
  };
  const add = () => {
    const blockId = identity();
    switch (adding) {
      case "HEADING":
        structure([...blocks, { id: blockId, kind: adding, level: 2 }]);
        break;
      case "PARAGRAPH":
        structure([...blocks, { id: blockId, kind: adding }]);
        break;
      case "LIST":
        structure([
          ...blocks,
          {
            id: blockId,
            kind: adding,
            style: "UNORDERED",
            itemIds: [identity()],
          },
        ]);
        break;
      case "SPECIFICATIONS":
        structure([
          ...blocks,
          { id: blockId, kind: adding, itemIds: [identity()] },
        ]);
        break;
      case "MEDIA":
        setPick(true);
        break;
    }
  };
  return (
    <section className="admin-fields" aria-label={t("details")}>
      <p className="admin-muted">{t("detailHint")}</p>
      {!blocks.length && <p>{t("emptyDetails")}</p>}
      {blocks.map((block, index) => {
        const row = translated[index]!;
        return (
          <fieldset
            className="admin-detail-block"
            disabled={disabled}
            key={block.id}
          >
            <legend>
              {index + 1} · {t(labels[block.kind])}
            </legend>
            {canStructure && (
              <div className="admin-actions">
                <Button
                  variant="quiet"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`${t("moveUp")} ${index + 1}`}
                >
                  {t("moveUp")}
                </Button>
                <Button
                  variant="quiet"
                  disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`${t("moveDown")} ${index + 1}`}
                >
                  {t("moveDown")}
                </Button>
                <Button
                  variant="quiet"
                  disabled={blocks.length === 1}
                  onClick={() =>
                    structure(blocks.filter((_, i) => i !== index))
                  }
                >
                  {t("remove")}
                </Button>
              </div>
            )}
            {block.kind === "HEADING" && (
              <Select
                label={t("level")}
                value={String(block.level)}
                disabled={!canStructure}
                onChange={(value) =>
                  changeBlock(index, { ...block, level: value === "2" ? 2 : 3 })
                }
              >
                <option value="2">H2</option>
                <option value="3">H3</option>
              </Select>
            )}
            {block.kind === "LIST" && (
              <Select
                label={t("listStyle")}
                value={block.style}
                disabled={!canStructure}
                onChange={(value) =>
                  changeBlock(index, {
                    ...block,
                    style: value as typeof block.style,
                  })
                }
              >
                <option value="ORDERED">{t("ordered")}</option>
                <option value="UNORDERED">{t("unordered")}</option>
              </Select>
            )}
            {(row.kind === "HEADING" || row.kind === "PARAGRAPH") && (
              <TextArea
                label={t("blockText")}
                disabled={disabled}
                maxLength={row.kind === "HEADING" ? 160 : 4000}
                value={row.text}
                onChange={(value) => text(index, { ...row, text: value })}
              />
            )}
            {(row.kind === "LIST" || row.kind === "SPECIFICATIONS") &&
              row.items.map((item, itemIndex) => (
                <div className="admin-fields" key={item.itemId}>
                  {row.kind === "LIST" && "text" in item && (
                    <TextArea
                      label={`${t("blockText")} ${itemIndex + 1}`}
                      maxLength={600}
                      value={item.text}
                      disabled={disabled}
                      onChange={(value) =>
                        text(index, {
                          ...row,
                          items: row.items.map((entry, i) =>
                            i === itemIndex ? { ...entry, text: value } : entry,
                          ),
                        })
                      }
                    />
                  )}
                  {row.kind === "SPECIFICATIONS" && "label" in item && (
                    <div className="admin-form-grid">
                      <Field
                        id={`${id}-${block.id}-${item.itemId}`}
                        label={t("specLabel")}
                        value={item.label}
                        disabled={disabled}
                        maxLength={160}
                        onChange={(e) =>
                          text(index, {
                            ...row,
                            items: row.items.map((entry, i) =>
                              i === itemIndex
                                ? { ...entry, label: e.target.value }
                                : entry,
                            ),
                          })
                        }
                      />
                      <TextArea
                        label={t("specValue")}
                        value={item.value}
                        maxLength={600}
                        disabled={disabled}
                        onChange={(value) =>
                          text(index, {
                            ...row,
                            items: row.items.map((entry, i) =>
                              i === itemIndex ? { ...entry, value } : entry,
                            ),
                          })
                        }
                      />
                    </div>
                  )}
                  {canStructure && "itemIds" in block && (
                    <Button
                      variant="quiet"
                      disabled={block.itemIds.length === 1}
                      onClick={() =>
                        changeBlock(index, {
                          ...block,
                          itemIds: block.itemIds.filter(
                            (_, i) => i !== itemIndex,
                          ),
                        })
                      }
                    >
                      {t("remove")} {itemIndex + 1}
                    </Button>
                  )}
                </div>
              ))}
            {"itemIds" in block && (
              <Button
                variant="secondary"
                disabled={!canStructure || block.itemIds.length >= 24}
                onClick={() =>
                  changeBlock(index, {
                    ...block,
                    itemIds: [...block.itemIds, identity()],
                  })
                }
              >
                {t("addItem")}
              </Button>
            )}
            {block.kind === "MEDIA" && (
              <>
                <small className="admin-muted">{block.mediaAssetId}</small>
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={block.captionEnabled}
                    disabled={!canStructure}
                    onChange={(e) =>
                      changeBlock(index, {
                        ...block,
                        captionEnabled: e.target.checked,
                      })
                    }
                  />
                  {t("captionEnabled")}
                </label>
                {row.kind === "MEDIA" && block.captionEnabled && (
                  <TextArea
                    label={t("caption")}
                    maxLength={300}
                    disabled={disabled}
                    value={row.caption ?? ""}
                    onChange={(caption) => text(index, { ...row, caption })}
                  />
                )}
              </>
            )}
          </fieldset>
        );
      })}
      {locale === "en" && (
        <div className="admin-actions">
          <Select
            label={t("addBlock")}
            value={adding}
            disabled={disabled}
            onChange={(value) => setAdding(value as GiftDetailBlock["kind"])}
          >
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            disabled={!canStructure || blocks.length >= 32}
            onClick={add}
          >
            {t("addBlock")}
          </Button>
        </div>
      )}
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
            structure([
              ...blocks,
              {
                id: identity(),
                kind: "MEDIA",
                mediaAssetId: owner.target.mediaAssetId,
                mediaMetadataRevisionId: mediaMetadataRevisionIdSchema.parse(
                  owner.publishedRevisionId,
                ),
                captionEnabled: false,
              },
            ]);
            setPick(false);
          }}
        />
      )}
    </section>
  );
}
