"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ADMIN_ARTIST_NOTE_LIMITS,
  type AdminArtistNoteContent,
  type AdminArtistNoteVersion,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { AdminClientError } from "../workspace/client";
import type { ArtistNotesApi, ArtistNotesContext } from "./api";
import { artistNotesCopy, type ArtistNotesCopy } from "./copy";
import "./notes.css";

// ADR-022 / L3-13: private notes at the bottom of the artist editor. Plaintext lives only in this mounted
// panel while it is open: closing it, hiding the tab or leaving the page drops it.

type Field = keyof AdminArtistNoteContent;
const FIELDS: readonly Field[] = ["realName", "contact", "identity", "other"];
const BLANK: AdminArtistNoteContent = {
  realName: "",
  contact: "",
  identity: "",
  other: "",
};
export type Shown = Readonly<{
  note: AdminArtistNoteVersion;
  content: AdminArtistNoteContent;
}>;
type View =
  | { kind: "IDLE" }
  | { kind: "LOADING" }
  | { kind: "SHOW"; shown: Shown | null }
  | { kind: "EDIT"; base: Shown | null; draft: AdminArtistNoteContent };
type Notice = "saved" | "stale" | "expired" | "failed" | null;

const code = (failure: unknown) =>
  failure instanceof AdminClientError ? failure.code : "UNEXPECTED_FAILURE";
const tooLong = (field: Field, value: string) =>
  Array.from(value).length > ADMIN_ARTIST_NOTE_LIMITS[field];
function fill(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}

export function ArtistPrivateNotes({
  api,
  artistId,
  locale,
}: {
  api: ArtistNotesApi;
  artistId: string;
  locale: SupportedLocale;
}) {
  const copy = artistNotesCopy(locale);
  const id = useId();
  const [context, setContext] = useState<ArtistNotesContext | "HIDDEN" | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "IDLE" });
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const epoch = useRef(0);
  const attempt = useRef<string | null>(null);
  const time = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)),
    [locale],
  );

  /** Accounts without idols.private never see the section; the API refuses them as well. */
  const refresh = useCallback(async () => {
    try {
      const next = await api.context(artistId);
      setContext(next);
      return next;
    } catch {
      setContext("HIDDEN");
      return null;
    }
  }, [api, artistId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const close = useCallback(() => {
    epoch.current += 1;
    attempt.current = null;
    setOpen(false);
    setView({ kind: "IDLE" });
    setNotice(null);
  }, []);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== "visible") close();
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", close);
    return () => {
      epoch.current += 1;
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", close);
    };
  }, [close]);

  const reveal = useCallback(
    async (noteId: string | null, after: Notice = null) => {
      const request = ++epoch.current;
      setNotice(after);
      if (noteId === null) {
        setView({ kind: "SHOW", shown: null });
        return;
      }
      setView({ kind: "LOADING" });
      try {
        const note = await api.read(artistId, noteId);
        if (request === epoch.current)
          setView({
            kind: "SHOW",
            shown: { note: note.note, content: note.content },
          });
      } catch (failure) {
        if (request !== epoch.current) return;
        const reason = code(failure);
        if (reason === "SECOND_FACTOR_REQUIRED" || reason === "NOT_FOUND") {
          close();
          await refresh();
          return;
        }
        setView({ kind: "IDLE" });
        setNotice(reason === "PRIVATE_ACCESS_EXPIRED" ? "expired" : "failed");
      }
    },
    [api, artistId, close, refresh],
  );
  const ready =
    context !== null && context !== "HIDDEN" && context.gate === "READY";
  const latest = ready ? (context.versions[0] ?? null) : null;
  // Opening reads the current version once; every later read is an explicit choice.
  const opened = open && ready && view.kind === "IDLE" && notice === null;
  useEffect(() => {
    if (opened) void reveal(latest?.noteId ?? null);
  }, [opened, reveal, latest?.noteId]);

  async function save(base: Shown | null, draft: AdminArtistNoteContent) {
    if (saving || FIELDS.some((field) => tooLong(field, draft[field]))) return;
    attempt.current ??= crypto.randomUUID();
    setSaving(true);
    setNotice(null);
    try {
      const saved = await api.save(artistId, {
        noteId: attempt.current,
        expectedVersion: latest?.version ?? 0,
        content: draft,
      });
      attempt.current = null;
      epoch.current += 1;
      setView({ kind: "SHOW", shown: { note: saved.note, content: draft } });
      setNotice("saved");
      await refresh();
    } catch (failure) {
      const reason = code(failure);
      if (reason === "STALE_VERSION") {
        attempt.current = null;
        const next = await refresh();
        await reveal(next?.versions[0]?.noteId ?? null, "stale");
      } else if (reason === "SECOND_FACTOR_REQUIRED") {
        close();
        await refresh();
      } else {
        setView({ kind: "EDIT", base, draft });
        setNotice("failed");
      }
    } finally {
      setSaving(false);
    }
  }

  if (context === null || context === "HIDDEN") return null;
  const shown = view.kind === "SHOW" ? view.shown : null;
  const viewingOld =
    shown !== null && latest !== null && shown.note.noteId !== latest.noteId;
  return (
    <section
      className="mc-artist-notes"
      aria-labelledby={`${id}-title`}
      data-artist-notes
      data-artist-notes-gate={context.gate}
    >
      <details
        open={open}
        onToggle={(event) => {
          const next = event.currentTarget.open;
          if (next === open) return;
          if (next) setOpen(true);
          else close();
        }}
      >
        <summary data-artist-notes-toggle>
          <h2 id={`${id}-title`} className="mc-artist-notes-title">
            {copy.title}
          </h2>
          {ready ? (
            <span className="mc-hint" data-artist-notes-last>
              {latest
                ? fill(copy.summaryLast, {
                    name: latest.savedBy,
                    time: time(latest.savedAt),
                  })
                : copy.summaryEmpty}
            </span>
          ) : null}
        </summary>
        <div className="mc-artist-notes-body">
          {!ready ? (
            <p className="mc-hint" role="note" data-artist-notes-locked>
              {context.gate === "TOTP_NOT_ENABLED"
                ? copy.gateTotp
                : copy.gateSignIn}
            </p>
          ) : (
            <>
              <p className="mc-hint">{copy.privacy}</p>
              <p role="status" className="mc-hint" data-artist-notes-notice>
                {view.kind === "LOADING"
                  ? copy.loading
                  : notice === "saved"
                    ? copy.saved
                    : notice === "stale"
                      ? copy.stale
                      : ""}
              </p>
              {notice === "expired" || notice === "failed" ? (
                <div className="mc-artist-notes-alert">
                  <p role="alert" className="mc-error">
                    {notice === "expired" ? copy.expired : copy.failed}
                  </p>
                  {view.kind !== "EDIT" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void reveal(latest?.noteId ?? null)}
                    >
                      {copy.retry}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {view.kind === "SHOW" ? (
                <NoteView
                  copy={copy}
                  shown={view.shown}
                  viewingOld={viewingOld}
                  time={time}
                  onEdit={() =>
                    setView({
                      kind: "EDIT",
                      base: view.shown,
                      draft: view.shown?.content ?? BLANK,
                    })
                  }
                  onBack={() => void reveal(latest?.noteId ?? null)}
                />
              ) : null}
              {view.kind === "EDIT" ? (
                <NoteForm
                  id={id}
                  copy={copy}
                  draft={view.draft}
                  saving={saving}
                  onChange={(draft) => setView({ ...view, draft })}
                  onCancel={() => {
                    attempt.current = null;
                    setNotice(null);
                    setView({ kind: "SHOW", shown: view.base });
                  }}
                  onSave={() => void save(view.base, view.draft)}
                />
              ) : null}
              {context.versions.length > 1 && view.kind !== "EDIT" ? (
                <History
                  copy={copy}
                  versions={context.versions}
                  showing={shown?.note.noteId ?? null}
                  time={time}
                  onView={(noteId) => void reveal(noteId)}
                />
              ) : null}
            </>
          )}
        </div>
      </details>
    </section>
  );
}

export function NoteView({
  copy,
  shown,
  viewingOld,
  time,
  onEdit,
  onBack,
}: {
  copy: ArtistNotesCopy;
  shown: Shown | null;
  viewingOld: boolean;
  time: (value: string) => string;
  onEdit: () => void;
  onBack: () => void;
}) {
  if (shown === null)
    return (
      <Button type="button" data-artist-notes-edit onClick={onEdit}>
        {copy.start}
      </Button>
    );
  return (
    <div data-artist-notes-content>
      {viewingOld ? (
        <p className="mc-hint" data-artist-notes-old>
          {fill(copy.viewingOld, {
            n: String(shown.note.version),
            name: shown.note.savedBy,
            time: time(shown.note.savedAt),
          })}
        </p>
      ) : null}
      <dl className="mc-artist-notes-fields">
        {FIELDS.map((field) => (
          <div key={field}>
            <dt>{copy[field]}</dt>
            <dd data-artist-notes-field={field}>
              {shown.content[field] === "" ? (
                <span className="mc-hint">{copy.blank}</span>
              ) : (
                shown.content[field]
              )}
            </dd>
          </div>
        ))}
      </dl>
      {viewingOld ? (
        <Button type="button" variant="secondary" onClick={onBack}>
          {copy.backToCurrent}
        </Button>
      ) : (
        <Button
          type="button"
          variant="secondary"
          data-artist-notes-edit
          onClick={onEdit}
        >
          {copy.edit}
        </Button>
      )}
    </div>
  );
}

export function NoteForm({
  id,
  copy,
  draft,
  saving,
  onChange,
  onCancel,
  onSave,
}: {
  id: string;
  copy: ArtistNotesCopy;
  draft: AdminArtistNoteContent;
  saving: boolean;
  onChange: (draft: AdminArtistNoteContent) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const hints: Partial<Record<Field, string>> = {
    contact: copy.contactHint,
    identity: copy.identityHint,
  };
  const invalid = FIELDS.some((field) => tooLong(field, draft[field]));
  return (
    <form
      className="mc-artist-notes-form"
      data-artist-notes-form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      {FIELDS.map((field) => {
        const long = tooLong(field, draft[field]);
        const described = [
          hints[field] ? `${id}-${field}-hint` : null,
          long ? `${id}-${field}-error` : null,
        ]
          .filter(Boolean)
          .join(" ");
        const props = {
          id: `${id}-${field}`,
          value: draft[field],
          disabled: saving,
          autoComplete: "off",
          spellCheck: false,
          "aria-invalid": long || undefined,
          "aria-describedby": described || undefined,
          "data-artist-notes-input": field,
        } as const;
        return (
          <div className="mc-field" key={field}>
            <label htmlFor={`${id}-${field}`}>{copy[field]}</label>
            {hints[field] ? (
              <p id={`${id}-${field}-hint`} className="mc-hint">
                {hints[field]}
              </p>
            ) : null}
            {field === "realName" ? (
              <input
                {...props}
                onChange={(event) =>
                  onChange({ ...draft, [field]: event.currentTarget.value })
                }
              />
            ) : (
              <textarea
                {...props}
                rows={field === "other" ? 4 : 3}
                onChange={(event) =>
                  onChange({ ...draft, [field]: event.currentTarget.value })
                }
              />
            )}
            {long ? (
              <p id={`${id}-${field}-error`} className="mc-error">
                {fill(copy.tooLong, {
                  limit: String(ADMIN_ARTIST_NOTE_LIMITS[field]),
                })}
              </p>
            ) : null}
          </div>
        );
      })}
      <div className="mc-artist-notes-actions">
        <Button
          type="submit"
          data-artist-notes-save
          disabled={saving || invalid}
        >
          {saving ? copy.saving : copy.save}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={saving}
          onClick={onCancel}
        >
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}

export function History({
  copy,
  versions,
  showing,
  time,
  onView,
}: {
  copy: ArtistNotesCopy;
  versions: readonly AdminArtistNoteVersion[];
  showing: string | null;
  time: (value: string) => string;
  onView: (noteId: string) => void;
}) {
  return (
    <div className="mc-artist-notes-history" data-artist-notes-history>
      <h3>{copy.history}</h3>
      <ol>
        {versions.map((version, index) => (
          <li key={version.noteId} data-artist-notes-version={version.version}>
            <span>
              <strong>
                {fill(copy.versionLabel, { n: String(version.version) })}
              </strong>{" "}
              <span className="mc-hint">
                {fill(copy.versionBy, {
                  name: version.savedBy,
                  time: time(version.savedAt),
                })}
              </span>
            </span>
            {index === 0 ? (
              <span className="mc-hint">{copy.current}</span>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={showing === version.noteId}
                aria-label={`${copy.view} ${fill(copy.versionLabel, { n: String(version.version) })}`}
                onClick={() => onView(version.noteId)}
              >
                {copy.view}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
