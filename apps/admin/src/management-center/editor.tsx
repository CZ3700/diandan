"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  currencySchema,
  marketSchema,
  minorAmountSchema,
  type ManagementCenterListItem,
  type ManagementCenterOperation,
  type SupportedLocale,
} from "@fan-support/contracts";
import type { DeletableItem, ManagementApi, ManagementContext } from "./api";
import { ContentForm } from "./content-form";
import { DeletePanel } from "./delete-panel";
import { PosterForm } from "./poster-form";
import { OperationProgress } from "./operation-progress";
import {
  createManagementSubmission,
  type SubmissionIntent,
  type SubmissionPhase,
} from "./submission";
import { managementCopy } from "./copy";
import { managementError } from "./errors";
import type { ContentDraft, EditableItem } from "./form-model";
import type { PhotoEdit } from "./focal-model";
import { giftCommerceEdit } from "./gift-commerce-edit";
import { parseManagementPrice } from "./inputs";

export type EditorSelection =
  | { kind: "SAVE_ARTIST" | "SAVE_GIFT"; item: EditableItem | null }
  | {
      kind: "REPLACE_POSTER";
      item: Extract<ManagementCenterListItem, { kind: "POSTER" }> | null;
    };

export function ManagementEditor({
  api,
  locale,
  context,
  selection,
  onPublished,
  onDeleted,
  canDelete = false,
  onBusy,
  onDirtyChange,
}: {
  api: ManagementApi;
  locale: SupportedLocale;
  context: ManagementContext;
  selection: EditorSelection;
  onPublished: (operation: ManagementCenterOperation) => void;
  onDeleted?: ((item: DeletableItem) => void) | undefined;
  canDelete?: boolean;
  onBusy: (busy: boolean) => void;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
}) {
  const copy = managementCopy(locale);
  const loadOriginal = useMemo(
    () =>
      selection.item
        ? () =>
            api.readImageSource({
              kind: selection.item!.kind,
              id: selection.item!.id,
              expectedVersion:
                selection.kind === "REPLACE_POSTER"
                  ? context.poster.version
                  : selection.item!.version,
            })
        : undefined,
    [api, selection, context.poster.version],
  );
  useLayoutEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const attempt = useMemo(() => createManagementSubmission(api), [api]);
  const [phase, setPhase] = useState<SubmissionPhase | null>(null);
  const [operation, setOperation] = useState<ManagementCenterOperation | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const [deleting, setDeleting] = useState(false);
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const change = useCallback(
    (next: ManagementCenterOperation) => {
      setOperation(next);
      if (next.status === "PUBLISHED") {
        onDirtyChange?.(false);
        onPublished(next);
      }
    },
    [onPublished, onDirtyChange],
  );
  async function submit(intent: SubmissionIntent, file: File | null) {
    if (active.current || operation) return;
    active.current = true;
    onBusy(true);
    setError(null);
    try {
      const next = await attempt.submit(intent, file, (value) => {
        if (mounted.current) setPhase(value);
      });
      if (mounted.current) change(next);
    } catch (failure) {
      if (mounted.current) setError(failure);
    } finally {
      active.current = false;
      if (mounted.current) {
        setPhase(null);
        onBusy(false);
      }
    }
  }
  async function remove(item: DeletableItem) {
    if (active.current || operation) return;
    active.current = true;
    setDeleting(true);
    onBusy(true);
    setError(null);
    try {
      await api.remove(item);
      if (mounted.current) onDeleted?.(item);
    } catch (failure) {
      if (mounted.current) setError(failure);
    } finally {
      active.current = false;
      if (mounted.current) {
        setDeleting(false);
        onBusy(false);
      }
    }
  }
  function submitContent(
    draft: ContentDraft,
    file: File | null,
    image: PhotoEdit | null,
  ) {
    if (selection.kind === "REPLACE_POSTER") return;
    const base = {
      sourceLocale: draft.sourceLocale,
      id: selection.item?.id ?? null,
      expectedVersion: selection.item?.version ?? 0,
      name: draft.name.trim(),
      description: draft.description.trim(),
      image,
    };
    try {
      const intent: SubmissionIntent =
        selection.kind === "SAVE_ARTIST"
          ? { kind: "SAVE_ARTIST", ...base }
          : {
              kind: "SAVE_GIFT",
              ...base,
              giftKind: draft.giftKind,
              category: draft.category,
              price: {
                market: marketSchema.parse(draft.market),
                currency: currencySchema.parse(draft.currency),
                amountMinor: minorAmountSchema.parse(
                  parseManagementPrice(draft.price, locale, draft.currency),
                ),
              },
              inventory:
                draft.policy === "TRACKED"
                  ? {
                      policy: "TRACKED",
                      locationId: draft.locationId,
                      quantity: Number(draft.quantity),
                    }
                  : { policy: draft.policy },
              eligibility: { rule: "ALL_ACTIVE_ARTISTS" },
            };
      const guarded =
        intent.kind === "SAVE_GIFT" && selection.item?.kind === "GIFT"
          ? {
              ...intent,
              commerceEdit: giftCommerceEdit(selection.item, intent),
            }
          : intent;
      void submit(guarded, file);
    } catch (failure) {
      setError(failure);
    }
  }
  const deletable: DeletableItem | null =
    selection.kind === "REPLACE_POSTER" ? null : selection.item;
  return (
    <section className="mc-editor" data-management-editor>
      {phase ? (
        <p className="mc-progress" data-management-phase={phase} role="status">
          {phase === "UPLOADING" ? copy.uploading : copy.processing}
        </p>
      ) : null}
      {error ? (
        <p className="mc-error" role="alert" data-management-error>
          {managementError(error, copy)}
        </p>
      ) : null}
      {operation ? (
        <OperationProgress
          api={api}
          locale={locale}
          operation={operation}
          onChange={change}
        />
      ) : null}
      {selection.kind === "REPLACE_POSTER" ? (
        <PosterForm
          locale={locale}
          current={selection.item?.image}
          loadOriginal={loadOriginal}
          onDirtyChange={onDirtyChange}
          busy={phase !== null || operation !== null}
          onSubmit={(file, sourceLocale, image) => {
            void submit(
              {
                kind: "REPLACE_POSTER",
                sourceLocale,
                expectedVersion: context.poster.version,
                image,
              },
              file,
            );
          }}
        />
      ) : (
        <ContentForm
          locale={locale}
          context={context}
          kind={selection.kind}
          item={selection.item}
          busy={phase !== null || operation !== null}
          onSubmit={submitContent}
          loadOriginal={loadOriginal}
          onDirtyChange={onDirtyChange}
        />
      )}
      {deletable && canDelete ? (
        <DeletePanel
          locale={locale}
          name={deletable.name}
          nameLocale={deletable.sourceLocale}
          disabled={phase !== null || operation !== null || deleting}
          onDelete={() => {
            void remove(deletable);
          }}
        />
      ) : null}
    </section>
  );
}
