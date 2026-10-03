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
  type ManagementCenterListItem,
  type ManagementCenterOperation,
  type SupportedLocale,
} from "@fan-support/contracts";
import { AdminClientError } from "../workspace/client";
import type { DeletableItem, ManagementApi, ManagementContext } from "./api";
import { ArtistAssignment, type AssignmentState } from "./artist-assignment";
import { ContentForm } from "./content-form";
import { DeletePanel } from "./delete-panel";
import { ArtistPrivateNotes } from "../management-artist-notes/panel";
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
import { giftSubmissionFields } from "./gift-submission";

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
  /** `assignmentMissed`: the new artist is published but its broker could not be saved. */
  onPublished: (
    operation: ManagementCenterOperation,
    assignmentMissed?: boolean,
  ) => void;
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
  // ADR-022: only accounts holding `idols.assign` are offered the broker choice.
  const artist =
    selection.kind === "SAVE_ARTIST" && selection.item?.kind === "ARTIST"
      ? selection.item
      : null;
  const assignable =
    selection.kind === "SAVE_ARTIST" && context.artists.canAssign;
  const [brokerId, setBrokerId] = useState<string | null>(
    artist?.assignment?.brokerId ?? null,
  );
  const [assignmentState, setAssignmentState] =
    useState<AssignmentState>("IDLE");
  const pendingBroker = useRef<string | null>(null);
  async function chooseBroker(next: string | null) {
    if (!artist) {
      // A new artist has no id yet; the choice is applied once it is published.
      pendingBroker.current = next;
      setBrokerId(next);
      return;
    }
    const previous = brokerId;
    setBrokerId(next);
    setAssignmentState("SAVING");
    try {
      await api.assignArtist(artist.id, next, previous);
      if (mounted.current) setAssignmentState("SAVED");
    } catch (failure) {
      if (!mounted.current) return;
      setBrokerId(previous);
      setAssignmentState(
        failure instanceof AdminClientError &&
          failure.code === "TARGET_CONFLICT"
          ? "STALE"
          : "FAILED",
      );
    }
  }
  const change = useCallback(
    (next: ManagementCenterOperation) => {
      setOperation(next);
      if (next.status !== "PUBLISHED") return;
      onDirtyChange?.(false);
      const broker = pendingBroker.current;
      if (broker === null || !next.result) {
        onPublished(next);
        return;
      }
      pendingBroker.current = null;
      void api.assignArtist(next.result.targetId, broker, null).then(
        () => onPublished(next),
        () => onPublished(next, true),
      );
    },
    [api, onPublished, onDirtyChange],
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
              ...giftSubmissionFields(draft, locale),
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
          api={api}
          locale={locale}
          context={context}
          kind={selection.kind}
          item={selection.item}
          busy={phase !== null || operation !== null}
          onSubmit={submitContent}
          loadOriginal={loadOriginal}
          onDirtyChange={onDirtyChange}
          assignment={
            assignable ? (
              <ArtistAssignment
                copy={copy}
                brokers={context.artists.brokers}
                value={brokerId}
                state={assignmentState}
                existing={artist !== null}
                onChange={(next) => void chooseBroker(next)}
              />
            ) : undefined
          }
        />
      )}
      {artist ? (
        <ArtistPrivateNotes
          api={api.artistNotes}
          artistId={artist.id}
          locale={locale}
        />
      ) : null}
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
