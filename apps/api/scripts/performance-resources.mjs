import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { URL } from "node:url";
import { summarizeAcceptanceResources } from "./storefront-acceptance-performance.mjs";

const measuredTypes = new Set([
  "script",
  "stylesheet",
  "font",
  "image",
  "document",
]);

/** Capture bodies in memory only; persist byte counts, hashes and allowlisted failure kinds. */
export function observePerformanceTraffic(page, inspectText = () => {}) {
  const pending = [],
    resources = [],
    failures = [];
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (!measuredTypes.has(type)) return;
    pending.push(
      (async () => {
        try {
          const body = Buffer.from(await response.body());
          if (response.status() !== 200)
            failures.push({ type, status: response.status() });
          resources.push({
            url: response.url(),
            type,
            status: response.status(),
            bodyBytes: body.length,
            gzipBytes: type === "script" ? gzipSync(body).length : null,
            sha256: createHash("sha256").update(body).digest("hex"),
            contentEncoding:
              response.headers()["content-encoding"] ?? "identity",
          });
          if (["script", "document"].includes(type))
            inspectText(body.toString("utf8"), type);
        } catch {
          failures.push({
            type,
            status: response.status(),
            bodyUnavailable: true,
          });
        }
      })(),
    );
  });
  page.on("requestfailed", (request) => {
    const type = request.resourceType();
    if (measuredTypes.has(type))
      failures.push({
        type,
        status: null,
        errorKind: "NETWORK_REQUEST_FAILED",
      });
  });
  return {
    resources,
    failures,
    async settle() {
      let length;
      do {
        length = pending.length;
        await Promise.all(pending);
      } while (length !== pending.length);
    },
  };
}

/** Current-locale catalog bytes must exist; foreign catalog markers must not be delivered. */
export function messageFingerprints(catalogs) {
  const byLocale = new Map(
    Object.entries(catalogs).map(([locale, catalog]) => [
      locale,
      Object.entries(catalog).filter(
        ([, value]) => typeof value === "string" && value.length >= 16,
      ),
    ]),
  );
  const probes = new Map(
    [...byLocale].map(([locale, values]) => [
      locale,
      values.filter(([key, value]) =>
        [...byLocale].every(
          ([other, entries]) =>
            other === locale ||
            !entries.some(
              ([otherKey, otherValue]) =>
                otherKey === key && otherValue === value,
            ),
        ),
      ),
    ]),
  );
  return {
    inspect(locale, text) {
      const matches = (values) =>
        values.filter(([key, value]) => {
          // Require the semantic key and its value together. Dynamic original-language content
          // may legitimately contain another locale's phrase without delivering its UI catalog.
          const pairs = [
            `${JSON.stringify(key)}:${JSON.stringify(value)}`,
            `${key}:${JSON.stringify(value)}`,
          ];
          return pairs.some((pair) => {
            const encoded = JSON.stringify(pair).slice(1, -1);
            const twiceEncoded = JSON.stringify(encoded).slice(1, -1);
            return [pair, encoded, twiceEncoded].some((pattern) =>
              text.includes(pattern),
            );
          });
        }).length;
      return {
        currentLocaleMatches: matches(probes.get(locale) ?? []),
        foreignLocaleMatches: [...probes]
          .filter(([other, values]) => other !== locale && matches(values) > 0)
          .map(([other]) => other),
      };
    },
  };
}

export function assessPerformanceResources({
  origin,
  resources,
  failures,
  allowedFontHashes,
  messageEvidence,
  heroUrl,
}) {
  const fonts = resources.filter((row) => row.type === "font");
  const stylesheets = resources.filter((row) => row.type === "stylesheet");
  const scripts = resources.filter((row) => row.type === "script");
  const externalScripts = scripts.filter(
    (row) => new URL(row.url).origin !== origin,
  );
  const unknownFonts = fonts.filter(
    (row) => !allowedFontHashes.has(row.sha256),
  );
  const budget = summarizeAcceptanceResources(resources, heroUrl);
  return {
    passed:
      failures.length === 0 &&
      resources.every((row) => row.status === 200) &&
      fonts.length > 0 &&
      stylesheets.length > 0 &&
      scripts.length > 0 &&
      unknownFonts.length === 0 &&
      externalScripts.length === 0 &&
      messageEvidence.currentLocaleMatches > 0 &&
      messageEvidence.foreignLocaleMatches.length === 0,
    ...budget,
    fonts: {
      count: fonts.length,
      bodyBytes: fonts.reduce((sum, row) => sum + row.bodyBytes, 0),
      unknownCount: unknownFonts.length,
      localeSourceHashesMatched: unknownFonts.length === 0 && fonts.length > 0,
    },
    stylesheets: {
      count: stylesheets.length,
      bodyBytes: stylesheets.reduce((sum, row) => sum + row.bodyBytes, 0),
    },
    scripts: { count: scripts.length, externalCount: externalScripts.length },
    messages: messageEvidence,
    failures,
  };
}
