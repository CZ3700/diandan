import { expect, test, vi } from "vitest";
import type { OriginalImage } from "./api";
import { downloadOriginal } from "./original-download";
const original = {
  download: {
    method: "GET",
    url: "https://storage.example.invalid/original",
    headers: {},
    expiresAt: "2099-01-01T00:00:00Z",
  },
} as OriginalImage;
test("private originals omit cookies, referrers, redirects and browser caching", async () => {
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(new Uint8Array([1, 2]), {
        headers: { "Content-Type": "image/png" },
      }),
  );
  const blob = await downloadOriginal(
    original,
    new AbortController().signal,
    transport,
  );
  expect(blob.size).toBe(2);
  expect(transport.mock.calls[0]?.[1]).toMatchObject({
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
});
test("expired grants never fetch and unsuccessful or non-image responses never preview", async () => {
  const transport = vi.fn<typeof fetch>();
  await expect(
    downloadOriginal(
      {
        ...original,
        download: { ...original.download, expiresAt: "2020-01-01T00:00:00Z" },
      },
      new AbortController().signal,
      transport,
    ),
  ).rejects.toThrow("NETWORK_ERROR");
  expect(transport).not.toHaveBeenCalled();
  transport.mockResolvedValueOnce(new Response("bad", { status: 403 }));
  await expect(
    downloadOriginal(original, new AbortController().signal, transport),
  ).rejects.toThrow("NETWORK_ERROR");
  transport.mockResolvedValueOnce(
    new Response("not a photo", { headers: { "Content-Type": "text/html" } }),
  );
  await expect(
    downloadOriginal(original, new AbortController().signal, transport),
  ).rejects.toThrow("INVALID_RESPONSE");
});
