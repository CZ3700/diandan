import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { OrdersApi, OrdersDetail } from "./api";
import type { MutationRunner } from "./detail-view";
import { ordersCopy } from "./copy";
import { ordersError } from "./labels";
import { usePrivateView } from "./use-private-view";

export function PrivateNotes({
  api,
  detail,
  locale,
  busy,
  onMutation,
  onClose,
}: {
  api: OrdersApi;
  detail: OrdersDetail;
  locale: SupportedLocale;
  busy: boolean;
  onMutation: MutationRunner;
  onClose: () => void;
}) {
  const copy = ordersCopy(locale);
  const load = useCallback(
    () => api.readNotes(detail.orderId),
    [api, detail.orderId],
  );
  const { value, error, loading, clear, retry } = usePrivateView(load, onClose);
  const [text, setText] = useState("");
  const [attempted, setAttempted] = useState(false);
  const attemptKey = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    return () => {
      attemptKey.current = null;
    };
  }, []);
  function close() {
    clear();
    setText("");
    attemptKey.current = null;
    onClose();
  }
  async function save() {
    if (busy || text.trim().length === 0 || Array.from(text).length > 1000)
      return;
    attemptKey.current ??= crypto.randomUUID();
    setAttempted(true);
    const saved = await onMutation(() =>
      api.addNote(
        {
          orderId: detail.orderId,
          expectedOrderVersion: detail.version,
          reasonCode: "ORDER_OPERATOR_NOTE",
          note: text.trim(),
        },
        attemptKey.current!,
      ),
    );
    if (saved) close();
  }
  return (
    <section
      className="mo-private"
      data-private-panel="notes"
      aria-labelledby="order-private-notes"
    >
      <div className="mo-section-heading">
        <h3 id="order-private-notes" ref={heading} tabIndex={-1}>
          {copy.notes}
        </h3>
        <Button
          type="button"
          variant="secondary"
          data-private-close
          onClick={close}
        >
          {copy.closePrivate}
        </Button>
      </div>
      <p className="mc-hint">{copy.privateHint}</p>
      {loading ? <p role="status">{copy.loading}</p> : null}
      {error ? (
        <>
          <p role="alert" className="mc-error">
            {ordersError(error, copy)}
          </p>
          <Button type="button" variant="secondary" onClick={retry}>
            {copy.retryAction}
          </Button>
        </>
      ) : null}
      {value ? (
        <ul className="mo-notes" data-private-content>
          {value.notes.map((note) => (
            <li key={note.noteId}>
              <time dateTime={note.createdAt}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(note.createdAt))}
              </time>
              <p>{note.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="mc-field">
          <span>{copy.addNote}</span>
          <textarea
            data-order-note
            value={text}
            disabled={busy || attempted}
            rows={4}
            maxLength={2000}
            onChange={(event) => setText(event.currentTarget.value)}
            aria-describedby="order-note-hint"
          />
        </label>
        <p id="order-note-hint" className="mc-hint">
          {copy.noteHint}
        </p>
        <Button
          type="submit"
          data-order-note-save
          disabled={
            busy || text.trim().length === 0 || Array.from(text).length > 1000
          }
        >
          {attempted ? copy.retryAction : copy.saveNote}
        </Button>
      </form>
    </section>
  );
}
