"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { Button, Field } from "@fan-support/ui";
import type { SupportedLocale } from "@fan-support/contracts";
import type { OriginalImage, ManagementContext } from "./api";
import {
  contentDraftErrors,
  initialContentDraft,
  type FormErrors,
  type ContentDraft,
  type EditableItem,
} from "./form-model";
import type { PhotoEdit } from "./focal-model";
import { managementCopy } from "./copy";
import { PhotoInput } from "./photo-input";
import { ContentOptions, giftKindLabel, ManagementSelect } from "./form-fields";
export type ContentFormProps = {
  locale: SupportedLocale;
  context: ManagementContext;
  kind: "SAVE_ARTIST" | "SAVE_GIFT";
  item: EditableItem | null;
  busy: boolean;
  onSubmit: (
    draft: ContentDraft,
    file: File | null,
    image: PhotoEdit | null,
  ) => void;
  loadOriginal?: (() => Promise<OriginalImage>) | undefined;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
};
export function ContentForm({
  locale,
  context,
  kind,
  item,
  busy,
  onSubmit,
  loadOriginal,
  onDirtyChange,
}: ContentFormProps) {
  const copy = managementCopy(locale);
  const [draft, setDraft] = useState(() =>
    initialContentDraft(locale, context, item),
  );
  const initial = useRef(draft);
  const [image, setImage] = useState<PhotoEdit | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const dirty =
    file !== null ||
    image !== null ||
    JSON.stringify(draft) !== JSON.stringify(initial.current);
  useLayoutEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const form = useRef<HTMLFormElement>(null);
  const update = (patch: Partial<ContentDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const gift = kind === "SAVE_GIFT";
  return (
    <form
      ref={form}
      data-management-form={gift ? "gift" : "artist"}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const issues = contentDraftErrors(
          kind,
          draft,
          locale,
          item === null && file === null,
        );
        if (errors.image && !file) issues.image = errors.image;
        setErrors(issues);
        if (Object.keys(issues).length) {
          requestAnimationFrame(() =>
            form.current
              ?.querySelector<HTMLElement>('[aria-invalid="true"]')
              ?.focus(),
          );
          return;
        }
        onSubmit(draft, file, image);
      }}
    >
      <fieldset className="mc-form-layout" disabled={busy}>
        <PhotoInput
          copy={copy}
          kind={kind}
          loadOriginal={loadOriginal}
          onImageEdit={setImage}
          current={item?.image}
          file={file}
          onChange={setFile}
          error={errors.image ? copy[errors.image] : undefined}
          onError={(error) =>
            setErrors((current) => ({ ...current, image: error ?? undefined }))
          }
        />
        <div className="mc-form-fields">
          <Field
            id="management-name"
            data-management-field="name"
            label={copy.name}
            value={draft.name}
            maxLength={gift ? 100 : 40}
            required
            autoComplete="off"
            error={errors.name ? copy[errors.name] : undefined}
            onChange={(event) => update({ name: event.currentTarget.value })}
          />
          <div className="mc-field">
            <label htmlFor="management-description">{copy.description}</label>
            <textarea
              id="management-description"
              data-management-field="description"
              value={draft.description}
              maxLength={600}
              rows={5}
              required
              aria-invalid={Boolean(errors.description)}
              aria-describedby={
                errors.description ? "management-description-error" : undefined
              }
              onChange={(event) =>
                update({ description: event.currentTarget.value })
              }
            />
            {errors.description ? (
              <p
                id="management-description-error"
                className="mc-error"
                role="alert"
              >
                {copy[errors.description]}
              </p>
            ) : null}
          </div>
          {gift ? (
            <div className="mc-field-pair">
              <Field
                id="management-price"
                data-management-field="price"
                label={`${copy.price}${draft.currency ? ` · ${draft.currency}` : ""}`}
                value={draft.price}
                inputMode="decimal"
                required
                error={errors.price ? copy[errors.price] : undefined}
                onChange={(event) =>
                  update({ price: event.currentTarget.value })
                }
              />
              <ManagementSelect
                name="giftKind"
                label={copy.kind}
                value={draft.giftKind}
                onChange={(value) =>
                  update({ giftKind: value as ContentDraft["giftKind"] })
                }
              >
                {context.giftKinds.map((type) => (
                  <option key={type} value={type}>
                    {giftKindLabel(type, copy)}
                  </option>
                ))}
              </ManagementSelect>
            </div>
          ) : null}
          <ContentOptions
            draft={draft}
            update={update}
            copy={copy}
            context={context}
            gift={gift}
            errors={errors}
            inventoryPolicyLocked={
              item?.kind === "GIFT" && item.inventoryPolicyLocked
            }
            commerceScopeLocked={item?.kind === "GIFT"}
          />
          <div className="mc-submit">
            <p className="mc-hint">{copy.rightsNotice}</p>
            <Button type="submit" data-management-submit disabled={busy}>
              {item ? copy.save : copy.addAndPublish}
            </Button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
