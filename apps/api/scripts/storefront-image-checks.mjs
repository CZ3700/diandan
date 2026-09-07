import { Buffer } from "node:buffer";
import sharp from "sharp";

/** Checks real optimizer responses independently of the source-byte checksum. */
export function createStorefrontImageChecks({ origin, gateway, check }) {
  const candidates = new Map();
  const inspected = new Map();
  function candidate(value) {
    const optimized = new globalThis.URL(value, origin);
    check(
      optimized.origin === origin && optimized.pathname === "/_next/image",
      "published image uses the owned same-origin optimizer",
    );
    const source = optimized.searchParams.get("url");
    const metadata = gateway.publishedMetadata(source);
    const width = Number(optimized.searchParams.get("w"));
    check(
      metadata &&
        width > 0 &&
        width <= metadata.width &&
        optimized.searchParams.get("q") === "75",
      "responsive candidate never exceeds its actual published source width",
    );
    candidates.set(optimized.href, { width, metadata });
    return optimized.href;
  }
  async function inspect(url) {
    if (inspected.has(url)) return;
    const requested = candidates.get(url);
    const response = await globalThis.fetch(url, {
      headers: { accept: "image/avif,image/webp" },
      signal: globalThis.AbortSignal.timeout(60_000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    check(
      response.status === 200,
      "actual optimizer candidate downloads successfully",
    );
    const decoded = await sharp(bytes).metadata();
    check(
      decoded.width === requested.width &&
        decoded.width <= requested.metadata.width &&
        decoded.height <= requested.metadata.height,
      "actual decoded optimizer dimensions match the bounded candidate without enlargement",
    );
    inspected.set(url, {
      width: decoded.width,
      height: decoded.height,
      format: decoded.format,
      byteSize: bytes.length,
      sourceWidth: requested.metadata.width,
      sourceHeight: requested.metadata.height,
    });
  }
  return {
    async observe(page) {
      const values = await page
        .locator("main img,main source")
        .evaluateAll((images) =>
          images.map((image) => ({
            current: image.tagName === "IMG" ? image.currentSrc : null,
            srcset: image.srcset,
          })),
        );
      for (const image of values) {
        for (const value of (image.srcset ?? "").split(",").filter(Boolean))
          candidate(value.trim().split(/\s+/u)[0]);
        if (image.current) await inspect(candidate(image.current));
      }
    },
    async verifyCandidates() {
      for (const url of candidates.keys()) await inspect(url);
      const first = candidates.entries().next().value;
      check(
        Boolean(first),
        "responsive image candidates were captured from the actual browser DOM",
      );
      const [valid, { metadata }] = first;
      const validUrl = new globalThis.URL(valid);
      const source = new globalThis.URL(validUrl.searchParams.get("url"));
      const malformed = [
        new globalThis.URL(source.pathname, "https://other.example.invalid")
          .href,
        new globalThis.URL("/source/original.jpg", source.origin).href,
        source.href + "?token=forbidden",
        new globalThis.URL("/processed/v1/master.png", source.origin).href,
        new globalThis.URL("/processed/v1/master/variant.svg", source.origin)
          .href,
      ];
      for (const value of malformed) {
        const url = new globalThis.URL(valid);
        url.searchParams.set("url", value);
        const response = await globalThis.fetch(url);
        await response.body?.cancel();
        check(
          response.status === 400,
          "optimizer rejects unapproved origin, source path, query or format",
        );
      }
      const redirect = new globalThis.URL(valid);
      redirect.searchParams.set("url", gateway.redirectProbe(source.href));
      const response = await globalThis.fetch(redirect);
      await response.body?.cancel();
      check(
        !response.ok,
        "optimizer refuses even a same-origin controlled redirect",
      );
      gateway.setFailure(true);
      const failure = await gateway.probe(source.pathname);
      gateway.setFailure(false);
      check(
        failure.status === 503,
        "actual TLS media gateway reports its controlled transport failure",
      );
      check(
        metadata.width > 0,
        "image checks are tied to a real READY publication row",
      );
    },
    evidence: () => ({
      candidateCount: candidates.size,
      decoded: [...inspected.values()],
    }),
  };
}
