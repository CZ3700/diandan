import { expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { AdminClientError, type AdminClient } from "../workspace/client";
import { createArtistNotesApi } from "./api";
import { ARTIST_NOTES_COPY_KEYS, artistNotesCopy } from "./copy";
import { ArtistPrivateNotes, History, NoteForm, NoteView } from "./panel";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const version = (n: number) => ({
  noteId: id(10 + n),
  version: n,
  savedAt: "2026-10-01T02:00:00.000Z",
  savedBy: "Studio owner",
});
const content = {
  realName: "Kim Minji",
  contact: "+66 81 234 5678\nLINE: minji",
  identity: "",
  other: "<b>not markup</b>",
};
const time = () => "1 Oct 2026, 10:00";

test("every language has the whole vocabulary and the placeholders it needs", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = artistNotesCopy(locale);
    expect(Object.keys(copy).sort()).toEqual(
      [...ARTIST_NOTES_COPY_KEYS].sort(),
    );
    for (const key of ARTIST_NOTES_COPY_KEYS)
      expect(copy[key].trim().length, `${locale} ${key}`).toBeGreaterThan(0);
    expect(copy.summaryLast).toContain("{name}");
    expect(copy.summaryLast).toContain("{time}");
    expect(copy.viewingOld).toContain("{n}");
    expect(copy.tooLong).toContain("{limit}");
  }
  expect(artistNotesCopy("zh-CN").title).toBe("私密备注（仅超管可见）");
});

test("a shown version lists the four fields as text, marks blanks and offers editing", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = artistNotesCopy(locale);
    const html = renderToStaticMarkup(
      <NoteView
        copy={copy}
        shown={{ note: version(2), content }}
        viewingOld={false}
        time={time}
        onEdit={() => undefined}
        onBack={() => undefined}
      />,
    );
    for (const field of ["realName", "contact", "identity", "other"])
      expect(html).toContain(`data-artist-notes-field="${field}"`);
    for (const label of [
      copy.realName,
      copy.contact,
      copy.identity,
      copy.other,
    ])
      expect(html).toContain(label);
    expect(html).toContain(copy.blank);
    expect(html).toContain("&lt;b&gt;not markup&lt;/b&gt;");
    expect(html).toContain("data-artist-notes-edit");
  }
});

test("an earlier version says so and only offers the way back", () => {
  const copy = artistNotesCopy("en");
  const html = renderToStaticMarkup(
    <NoteView
      copy={copy}
      shown={{ note: version(1), content }}
      viewingOld
      time={time}
      onEdit={() => undefined}
      onBack={() => undefined}
    />,
  );
  expect(html).toContain("You are looking at version 1");
  expect(html).toContain(copy.backToCurrent);
  expect(html).not.toContain("data-artist-notes-edit");
  const empty = renderToStaticMarkup(
    <NoteView
      copy={copy}
      shown={null}
      viewingOld={false}
      time={time}
      onEdit={() => undefined}
      onBack={() => undefined}
    />,
  );
  expect(empty).toContain(copy.start);
});

test("the form labels every field, explains contact and identity, and flags text over the limit", () => {
  const copy = artistNotesCopy("th");
  const html = renderToStaticMarkup(
    <NoteForm
      id="notes"
      copy={copy}
      draft={{ ...content, other: "🌸".repeat(4001) }}
      saving={false}
      onChange={() => undefined}
      onCancel={() => undefined}
      onSave={() => undefined}
    />,
  );
  for (const field of ["realName", "contact", "identity", "other"])
    expect(html).toContain(`for="notes-${field}"`);
  expect(html).toContain(copy.contactHint);
  expect(html).toContain(copy.identityHint);
  expect(html).toMatch(
    /data-artist-notes-input="other"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*data-artist-notes-input="other"/u,
  );
  expect((html.match(/aria-invalid="true"/gu) ?? []).length).toBe(1);
  expect(html).toContain("4000");
  expect(html).toMatch(/<button[^>]*data-artist-notes-save[^>]*disabled/u);
});

test("the history names each version and its author, and marks the current one", () => {
  const copy = artistNotesCopy("ja");
  const html = renderToStaticMarkup(
    <History
      copy={copy}
      versions={[version(3), version(2), version(1)]}
      showing={id(13)}
      time={time}
      onView={() => undefined}
    />,
  );
  expect(html).toContain("第3版");
  expect(html).toContain("第1版");
  expect(html).toContain(copy.current);
  expect((html.match(/<button/gu) ?? []).length).toBe(2);
  expect(html).toContain("Studio owner");
});

test("before the API answers, nothing about private notes is rendered", () => {
  const html = renderToStaticMarkup(
    <ArtistPrivateNotes
      api={createArtistNotesApi({
        call: () => new Promise<never>(() => undefined),
      } as unknown as AdminClient)}
      artistId={id(1)}
      locale="en"
    />,
  );
  expect(html).toBe("");
});

test("the transport refuses answers for another artist or version", async () => {
  const call = vi.fn();
  const api = createArtistNotesApi({ call } as unknown as AdminClient);
  call.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "CONTEXT",
    artistId: id(2),
    gate: "READY",
    versions: [],
  });
  await expect(api.context(id(1))).rejects.toBeInstanceOf(AdminClientError);
  call.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "NOTE",
    artistId: id(1),
    note: version(2),
    accessId: id(3),
    expiresAt: "2026-10-01T02:05:00.000Z",
    content,
  });
  await expect(api.read(id(1), id(11))).rejects.toBeInstanceOf(
    AdminClientError,
  );
  call.mockResolvedValueOnce({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "SAVED",
    artistId: id(1),
    note: version(1),
  });
  await expect(
    api.save(id(1), { noteId: id(11), expectedVersion: 0, content }),
  ).resolves.toMatchObject({ kind: "SAVED" });
  expect(call).toHaveBeenLastCalledWith(
    "artist-notes-save",
    {
      schemaVersion: 1,
      artistId: id(1),
      noteId: id(11),
      expectedVersion: 0,
      content,
    },
    expect.anything(),
  );
});
