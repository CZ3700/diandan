import { afterEach, expect, test, vi } from "vitest";
import type * as DirectoryValidation from "./directory-validation";

afterEach(() => {
  vi.doUnmock("./directory-validation");
  vi.resetModules();
});

test("loads validation only for an interaction and stops a cancelled pending import before fetch", async () => {
  vi.resetModules();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const loading = vi.fn(async () => {
    entered.resolve();
    await release.promise;
    return vi.importActual<typeof DirectoryValidation>(
      "./directory-validation",
    );
  });
  vi.doMock("./directory-validation", loading);
  const client = await import("./directory-request");
  expect(loading).not.toHaveBeenCalled();
  const request = vi.fn<typeof fetch>();
  const cancellation = new AbortController();
  const pending = client.requestArtistDirectory(
    { schemaVersion: 1, locale: "en", limit: 12 },
    cancellation.signal,
    request,
  );
  await entered.promise;
  cancellation.abort();
  release.resolve();
  await expect(pending).resolves.toMatchObject({
    outcome: "FAILURE",
    code: "CATALOG_UNAVAILABLE",
  });
  expect(loading).toHaveBeenCalledOnce();
  expect(request).not.toHaveBeenCalled();
});

test("a search cancelled while loading also cannot send a stale query", async () => {
  vi.resetModules();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  vi.doMock("./directory-validation", async () => {
    entered.resolve();
    await release.promise;
    return vi.importActual<typeof DirectoryValidation>(
      "./directory-validation",
    );
  });
  const client = await import("./directory-request");
  const cancellation = new AbortController();
  const request = vi.fn<typeof fetch>();
  const pending = client.requestArtistSearch(
    "old artist",
    "en",
    cancellation.signal,
    request,
  );
  await entered.promise;
  cancellation.abort();
  release.resolve();
  await expect(pending).resolves.toMatchObject({
    kind: "response",
    response: { outcome: "FAILURE", code: "CATALOG_UNAVAILABLE" },
  });
  expect(request).not.toHaveBeenCalled();
});

test("a failed validation download becomes the existing retryable error for browse and search", async () => {
  vi.resetModules();
  vi.doMock("./directory-validation", () => {
    throw new Error("Synthetic module network failure");
  });
  const client = await import("./directory-request");
  const request = vi.fn<typeof fetch>();
  const signal = new AbortController().signal;
  await expect(
    client.requestArtistDirectory(
      { schemaVersion: 1, locale: "en", limit: 12 },
      signal,
      request,
    ),
  ).resolves.toMatchObject({ outcome: "FAILURE", code: "CATALOG_UNAVAILABLE" });
  await expect(
    client.requestArtistSearch("artist", "en", signal, request),
  ).resolves.toMatchObject({
    kind: "response",
    response: { outcome: "FAILURE", code: "CATALOG_UNAVAILABLE" },
  });
  expect(request).not.toHaveBeenCalled();
  // The facade must not retain its own rejected import promise across retries.
  vi.doUnmock("./directory-validation");
  const retry = vi.fn<typeof fetch>(async () =>
    Response.json({
      schemaVersion: 1,
      outcome: "SUCCESS",
      catalogVersion: "a".repeat(64),
      items: [],
      pageInfo: { schemaVersion: 1, hasNextPage: false, endCursor: null },
    }),
  );
  await expect(
    client.requestArtistDirectory(
      { schemaVersion: 1, locale: "en", limit: 12 },
      signal,
      retry,
    ),
  ).resolves.toMatchObject({ outcome: "SUCCESS" });
  expect(retry).toHaveBeenCalledOnce();
});
