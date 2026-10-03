/* global AbortSignal, CSSRule, HTMLImageElement, HTMLElement, MutationObserver, PerformanceObserver, clearTimeout, document, fetch, getComputedStyle, matchMedia, performance, requestAnimationFrame, setTimeout, window */

import { createHash, randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveSpawnCommand } from "./spawn-command.mjs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import postcss from "postcss";

import {
  isSafeRelativeArtifactPath,
  observePage,
  summarizeAxeResult,
} from "./verify-ui-primitives-browser.mjs";

function spawnArguments(command, arguments_) {
  const resolved = resolveSpawnCommand(command, arguments_);
  return [resolved.command, resolved.args];
}

const scriptPath = fileURLToPath(import.meta.url);
const defaultWorkspaceRoot = path.resolve(path.dirname(scriptPath), "..");
const rootManifest = JSON.parse(
  readFileSync(path.join(defaultWorkspaceRoot, "package.json"), "utf8"),
);
const storefrontManifest = JSON.parse(
  readFileSync(
    path.join(defaultWorkspaceRoot, "apps/storefront/package.json"),
    "utf8",
  ),
);
const expectedToolchainVersions = Object.freeze({
  axe: rootManifest.devDependencies["@axe-core/playwright"],
  next: storefrontManifest.dependencies.next,
  node: `v${readFileSync(path.join(defaultWorkspaceRoot, ".node-version"), "utf8").trim()}`,
  playwright: rootManifest.devDependencies["@playwright/test"],
  pnpm: String(rootManifest.packageManager).replace(/^pnpm@/u, ""),
  postcss: rootManifest.devDependencies.postcss,
  react: storefrontManifest.dependencies.react,
});
const expectedToolchainVersionKeys = Object.freeze(
  ["browser", ...Object.keys(expectedToolchainVersions)].sort(),
);
const evidenceRelativePath = "output/playwright/p2-05";
const routeSuffix = "/motion";
const rerunCommand =
  "mise exec node@24.20.0 -- node scripts/verify-ui-motion-browser.mjs";
const sourceFingerprintAlgorithm = "p2-05-render-inputs-v1";
const previewLocales = Object.freeze([
  "en",
  "en-XA",
  "es",
  "ja",
  "pt",
  "th",
  "vi",
  "zh-CN",
]);
const expectedFontFamilies = Object.freeze([
  "Manrope Variable",
  "Noto Sans JP Variable",
  "Noto Sans SC Variable",
  "Noto Sans Thai Variable",
  "Noto Sans Variable",
]);
const expectedRuntimeFontFamiliesByLocale = Object.freeze({
  en: Object.freeze(["Manrope Variable", "Noto Sans Variable"]),
  "en-XA": Object.freeze(["Manrope Variable", "Noto Sans Variable"]),
  es: Object.freeze(["Manrope Variable", "Noto Sans Variable"]),
  ja: Object.freeze(["Noto Sans JP Variable"]),
  pt: Object.freeze(["Manrope Variable", "Noto Sans Variable"]),
  th: Object.freeze(["Noto Sans Thai Variable"]),
  vi: Object.freeze(["Manrope Variable", "Noto Sans Variable"]),
  "zh-CN": Object.freeze(["Noto Sans SC Variable"]),
});

const sourceFingerprintPathspec = Object.freeze([
  ".node-version",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "turbo.json",
  "packages/contracts",
  "packages/config",
  "packages/design-tokens",
  "packages/observability",
  "packages/ui",
  "apps/storefront/next.config.ts",
  "apps/storefront/package.json",
  "apps/storefront/postcss-font-display-optional",
  "apps/storefront/postcss.config.mjs",
  "apps/storefront/tsconfig.build.json",
  "apps/storefront/tsconfig.json",
  "apps/storefront/public",
  "apps/storefront/src",
  "apps/storefront/src/app/globals.css",
  "apps/storefront/src/app/layout.tsx",
  ":(glob)apps/storefront/src/app/ui-motion-*",
  "apps/storefront/src/app/%5Finternal/design-foundations/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(japanese)/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(latin)/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(simplified-chinese)/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(thai)/layout.tsx",
  "apps/storefront/src/app/%5Finternal/design-foundations/(vietnamese)/layout.tsx",
  ":(glob)apps/storefront/src/app/%5Finternal/design-foundations/**/motion/page.tsx",
  "apps/storefront/src/design-foundations.ts",
  "apps/storefront/src/instrumentation.ts",
  "apps/storefront/src/internal-presentation-locale.ts",
  "apps/storefront/src/presentation-locale.ts",
  "apps/storefront/src/proxy.ts",
  "apps/storefront/src/server/runtime-config.ts",
  "scripts/check-ui-motion.mjs",
  "scripts/verify-ui-motion-browser.mjs",
  "scripts/verify-ui-primitives-browser.mjs",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const pngCrcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return crc >>> 0;
});

function pngCrc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function validatePngScanlines(decoded, { bitsPerPixel, height, width }) {
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const expectedLength = (rowBytes + 1) * height;
  if (
    !Number.isSafeInteger(expectedLength) ||
    decoded.length !== expectedLength
  ) {
    throw new Error("P2-05 PNG decoded scanline length is invalid");
  }
  const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  let previous = Buffer.alloc(rowBytes);
  let offset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = decoded[offset];
    offset += 1;
    if (!Number.isInteger(filter) || filter < 0 || filter > 4) {
      throw new Error("P2-05 PNG scanline uses an invalid filter");
    }
    const current = Buffer.allocUnsafe(rowBytes);
    for (let column = 0; column < rowBytes; column += 1) {
      const encoded = decoded[offset + column];
      const left =
        column >= filterBytesPerPixel
          ? current[column - filterBytesPerPixel]
          : 0;
      const above = previous[column];
      const upperLeft =
        column >= filterBytesPerPixel
          ? previous[column - filterBytesPerPixel]
          : 0;
      let prediction = 0;
      if (filter === 1) {
        prediction = left;
      } else if (filter === 2) {
        prediction = above;
      } else if (filter === 3) {
        prediction = Math.floor((left + above) / 2);
      } else if (filter === 4) {
        prediction = paethPredictor(left, above, upperLeft);
      }
      current[column] = (encoded + prediction) & 0xff;
    }
    offset += rowBytes;
    previous = current;
  }
}

export function readDecodedPngDimensions(value) {
  if (
    !Buffer.isBuffer(value) ||
    value.length < 57 ||
    value.length > 128 * 1024 * 1024 ||
    value.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  ) {
    throw new Error("P2-05 screenshot must be a complete PNG");
  }
  let offset = 8;
  let header;
  let idatEnded = false;
  let sawIdat = false;
  let sawPalette = false;
  let sawEnd = false;
  const idat = [];
  while (offset < value.length) {
    if (offset + 12 > value.length) {
      throw new Error("P2-05 PNG chunk is truncated");
    }
    const length = value.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > value.length) {
      throw new Error("P2-05 PNG chunk data is truncated");
    }
    const typeBuffer = value.subarray(offset + 4, offset + 8);
    const type = typeBuffer.toString("ascii");
    if (!/^[A-Za-z]{4}$/u.test(type)) {
      throw new Error("P2-05 PNG chunk type is invalid");
    }
    const expectedCrc = value.readUInt32BE(dataEnd);
    const actualCrc = pngCrc32(value.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) {
      throw new Error(`P2-05 PNG ${type} CRC is invalid`);
    }
    const data = value.subarray(dataStart, dataEnd);
    if (header === undefined) {
      if (type !== "IHDR" || length !== 13) {
        throw new Error("P2-05 PNG must begin with one complete IHDR chunk");
      }
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const validDepths = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        width <= 0 ||
        height <= 0 ||
        !validDepths[colorType]?.includes(bitDepth) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        throw new Error(
          "P2-05 PNG IHDR dimensions, color mode or non-interlaced encoding is invalid",
        );
      }
      header = { bitDepth, colorType, height, width };
    } else if (type === "IHDR") {
      throw new Error("P2-05 PNG must contain exactly one IHDR chunk");
    } else if (type === "PLTE") {
      if (
        sawPalette ||
        sawIdat ||
        header.colorType === 0 ||
        header.colorType === 4 ||
        length === 0 ||
        length % 3 !== 0 ||
        length > 256 * 3 ||
        (header.colorType === 3 && length / 3 > 2 ** header.bitDepth)
      ) {
        throw new Error("P2-05 PNG palette chunk is invalid");
      }
      sawPalette = true;
    } else if (type === "IDAT") {
      if (idatEnded || length === 0) {
        throw new Error(
          "P2-05 PNG IDAT chunks must be non-empty and consecutive",
        );
      }
      sawIdat = true;
      idat.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || !sawIdat || chunkEnd !== value.length) {
        throw new Error("P2-05 PNG must end with one complete IEND chunk");
      }
      sawEnd = true;
    } else {
      if ((typeBuffer[0] & 0x20) === 0) {
        throw new Error(
          `P2-05 PNG contains unsupported critical chunk ${type}`,
        );
      }
      if (sawIdat) {
        idatEnded = true;
      }
    }
    offset = chunkEnd;
    if (sawEnd) {
      break;
    }
  }
  if (
    header === undefined ||
    !sawIdat ||
    !sawEnd ||
    (header.colorType === 3 && !sawPalette)
  ) {
    throw new Error("P2-05 PNG is missing required IHDR/PLTE/IDAT/IEND data");
  }
  const channelCount = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const bitsPerPixel = channelCount * header.bitDepth;
  const expectedLength =
    (Math.ceil((header.width * bitsPerPixel) / 8) + 1) * header.height;
  if (
    !Number.isSafeInteger(expectedLength) ||
    expectedLength > 128 * 1024 * 1024
  ) {
    throw new Error("P2-05 PNG decoded dimensions exceed the evidence budget");
  }
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(idat), {
      maxOutputLength: expectedLength + 1,
    });
  } catch (error) {
    throw new Error("P2-05 PNG IDAT data cannot be decoded", { cause: error });
  }
  validatePngScanlines(decoded, {
    bitsPerPixel,
    height: header.height,
    width: header.width,
  });
  return { height: header.height, width: header.width };
}

function scenario(input) {
  return Object.freeze({
    ...input,
    axe: Object.freeze(input.axe ?? []),
    viewport: Object.freeze(input.viewport),
  });
}

const motionScenarioMatrix = Object.freeze([
  scenario({
    group: "baseline",
    id: "viewport-360x800-en",
    locale: "en",
    screenshot: "viewports/360x800-en.png",
    viewport: { height: 800, width: 360 },
  }),
  scenario({
    axe: [{ id: "baseline-mobile" }],
    group: "baseline",
    id: "viewport-390x844-vi",
    locale: "vi",
    screenshot: "viewports/390x844-vi.png",
    viewport: { height: 844, width: 390 },
  }),
  scenario({
    group: "baseline",
    id: "viewport-768x1024-th",
    locale: "th",
    screenshot: "viewports/768x1024-th.png",
    viewport: { height: 1024, width: 768 },
  }),
  scenario({
    group: "baseline",
    id: "viewport-1024x768-zh-cn",
    locale: "zh-CN",
    screenshot: "viewports/1024x768-zh-CN.png",
    viewport: { height: 768, width: 1024 },
  }),
  scenario({
    axe: [{ id: "baseline-desktop" }],
    group: "baseline",
    id: "viewport-1440x900-ja",
    locale: "ja",
    screenshot: "viewports/1440x900-ja.png",
    viewport: { height: 900, width: 1440 },
  }),
  scenario({
    group: "baseline",
    id: "viewport-1920x1080-es",
    locale: "es",
    screenshot: "viewports/1920x1080-es.png",
    viewport: { height: 1080, width: 1920 },
  }),
  scenario({
    axe: [{ id: "pseudo-320" }],
    fullPage: true,
    group: "stress",
    id: "stress-320x800-en-xa",
    locale: "en-XA",
    screenshot: "stress/320x800-en-XA.png",
    viewport: { height: 800, width: 320 },
  }),
  scenario({
    fullPage: true,
    group: "stress",
    id: "stress-320x800-pt",
    locale: "pt",
    screenshot: "stress/320x800-pt-long.png",
    viewport: { height: 800, width: 320 },
  }),
]);

const specialScreenshotPaths = Object.freeze([
  "hero/390x844-start.png",
  "hero/390x844-mid.png",
  "hero/390x844-end.png",
  "hero/1440x900-start.png",
  "hero/1440x900-mid.png",
  "hero/1440x900-end.png",
  "motion/idol-mouse-spatial-1440.png",
  "motion/idol-touch-opacity-390.png",
  "motion/idol-keyboard-instant-1440.png",
  "motion/idol-latest-wins-1440.png",
  "motion/add-confirmed-390.png",
  "motion/success-end-1440.png",
  "reduced-motion/390x844.png",
  "reduced-motion/1440x900.png",
]);

export function createMotionScenarioMatrix() {
  return motionScenarioMatrix;
}

export function createMotionScreenshotPaths() {
  return Object.freeze([
    ...motionScenarioMatrix.map(({ screenshot }) => screenshot),
    ...specialScreenshotPaths,
  ]);
}

function screenshotViewport(relativePath) {
  const match =
    /(320x800|360x800|390x844|768x1024|1024x768|1440x900|1920x1080)/u.exec(
      relativePath,
    );
  if (match !== null) {
    const [width, height] = match[1].split("x").map(Number);
    return { height, width };
  }
  const widthOnly = /-(390|1440)\.png$/u.exec(relativePath);
  if (widthOnly === null) {
    return null;
  }
  const width = Number(widthOnly[1]);
  return { height: width === 390 ? 844 : 900, width };
}

function screenshotDimensionsMatch(relativePath, dimensions) {
  const viewport = screenshotViewport(relativePath);
  if (viewport === null) {
    return false;
  }
  if (relativePath.startsWith("hero/")) {
    return (
      dimensions.width >= Math.max(200, viewport.width * 0.5) &&
      dimensions.width <= viewport.width &&
      dimensions.height >= 200 &&
      dimensions.height <= viewport.height
    );
  }
  if (
    relativePath.startsWith("stress/") ||
    relativePath.startsWith("reduced-motion/")
  ) {
    return (
      dimensions.width === viewport.width &&
      dimensions.height >= viewport.height
    );
  }
  return (
    dimensions.width === viewport.width && dimensions.height === viewport.height
  );
}

function caseKey(width, height, locale) {
  return [width, height, locale].join("x");
}

export function validateMotionScenarioMatrix(matrix) {
  const errors = [];
  if (!Array.isArray(matrix)) {
    return ["motion scenario matrix must be an array"];
  }
  const required = [
    [360, 800, "en"],
    [390, 844, "vi"],
    [768, 1024, "th"],
    [1024, 768, "zh-CN"],
    [1440, 900, "ja"],
    [1920, 1080, "es"],
    [320, 800, "en-XA"],
    [320, 800, "pt"],
  ];
  if (matrix.length !== required.length) {
    errors.push("motion matrix must contain exactly eight locale scenarios");
  }
  const ids = new Set();
  const screenshots = new Set();
  const locales = new Set();
  const cases = new Set();
  const axeIds = new Set();
  for (const entry of matrix) {
    if (typeof entry?.id !== "string" || ids.has(entry.id)) {
      errors.push("motion scenario ids must be non-empty and unique");
    } else {
      ids.add(entry.id);
    }
    if (!previewLocales.includes(entry?.locale) || locales.has(entry.locale)) {
      errors.push("motion locale routes must be valid and unique");
    } else {
      locales.add(entry.locale);
    }
    if (
      !Number.isInteger(entry?.viewport?.width) ||
      !Number.isInteger(entry?.viewport?.height)
    ) {
      errors.push("motion scenario viewports must use integer dimensions");
    } else {
      cases.add(
        caseKey(entry.viewport.width, entry.viewport.height, entry.locale),
      );
    }
    if (
      !isSafeRelativeArtifactPath(entry?.screenshot, ".png") ||
      screenshots.has(entry.screenshot)
    ) {
      errors.push("motion screenshots must use safe unique relative paths");
    } else {
      screenshots.add(entry.screenshot);
    }
    if (!Array.isArray(entry?.axe)) {
      errors.push("motion scenario axe scans must be an array");
      continue;
    }
    for (const scan of entry.axe) {
      if (
        typeof scan?.id !== "string" ||
        !/^[a-z0-9-]+$/u.test(scan.id) ||
        axeIds.has(scan.id)
      ) {
        errors.push("motion axe scan ids must be safe and unique");
      } else {
        axeIds.add(scan.id);
      }
    }
  }
  for (const [width, height, locale] of required) {
    if (!cases.has(caseKey(width, height, locale))) {
      errors.push(
        locale === "pt" && width === 320
          ? "motion matrix is missing the 320px Portuguese stress case"
          : `motion matrix is missing ${caseKey(width, height, locale)}`,
      );
    }
  }
  for (const requiredAxe of [
    "baseline-mobile",
    "baseline-desktop",
    "pseudo-320",
  ]) {
    if (!axeIds.has(requiredAxe)) {
      errors.push(`motion matrix is missing axe scan ${requiredAxe}`);
    }
  }
  return errors;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function approximatelyZero(value, tolerance = 0.001) {
  return finite(value) && Math.abs(value) <= tolerance;
}

function hasExactUniqueStrings(value, expected) {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0) &&
    new Set(value).size === value.length &&
    JSON.stringify(value) === JSON.stringify([...expected].sort())
  );
}

function primaryFontFamilyFromStack(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  return value
    .split(",", 1)[0]
    .trim()
    .replace(/^(['"])(.*)\1$/u, "$2")
    .trim();
}

export function assessRuntimeFontEvidence(evidence, locale) {
  const errors = [];
  const expectedFamilies = expectedRuntimeFontFamiliesByLocale[locale];
  if (expectedFamilies === undefined) {
    return [
      `runtime font evidence has no canonical profile for ${String(locale)}`,
    ];
  }
  if (!isRecord(evidence)) {
    return ["runtime font evidence must be an object"];
  }
  if (evidence.source !== "document.fonts + CSSOM + computedStyle") {
    errors.push(
      "runtime font evidence must combine document.fonts, CSSOM and computedStyle",
    );
  }

  const fontFaceSet = evidence.fontFaceSet;
  if (
    !isRecord(fontFaceSet) ||
    !Number.isSafeInteger(fontFaceSet.faceCount) ||
    fontFaceSet.faceCount < expectedFamilies.length
  ) {
    errors.push("runtime document.fonts face count must be non-zero");
  }
  if (!hasExactUniqueStrings(fontFaceSet?.displays, ["optional"])) {
    errors.push("runtime document.fonts faces must all use display optional");
  }
  if (!hasExactUniqueStrings(fontFaceSet?.families, expectedFamilies)) {
    errors.push(
      `runtime document.fonts families must match ${expectedFamilies.join(", ")}`,
    );
  }
  if (
    !Array.isArray(fontFaceSet?.statuses) ||
    fontFaceSet.statuses.length < 1 ||
    new Set(fontFaceSet.statuses).size !== fontFaceSet.statuses.length ||
    !fontFaceSet.statuses.includes("loaded") ||
    fontFaceSet.statuses.some(
      (status) => !["loaded", "unloaded"].includes(status),
    )
  ) {
    errors.push(
      "runtime document.fonts statuses must be settled to loaded or unloaded and include a loaded face",
    );
  }

  const cssom = evidence.cssom;
  if (
    !isRecord(cssom) ||
    !Number.isSafeInteger(cssom.fontFaces) ||
    cssom.fontFaces < expectedFamilies.length ||
    !Number.isSafeInteger(cssom.styleSheets) ||
    cssom.styleSheets < 1
  ) {
    errors.push(
      "runtime CSSOM must contain readable font faces and stylesheets",
    );
  }
  if (!hasExactUniqueStrings(cssom?.displays, ["optional"])) {
    errors.push("runtime CSSOM font faces must all use display optional");
  }
  if (!hasExactUniqueStrings(cssom?.families, expectedFamilies)) {
    errors.push(
      `runtime CSSOM font families must match ${expectedFamilies.join(", ")}`,
    );
  }
  if (cssom?.importantDescriptors !== 0) {
    errors.push("runtime CSSOM font descriptors must not use !important");
  }
  if (
    !Number.isSafeInteger(cssom?.imports) ||
    cssom.imports < 0 ||
    !Array.isArray(cssom?.unreadableStyleSheets) ||
    cssom.unreadableStyleSheets.length > 0
  ) {
    errors.push("runtime CSSOM must read every stylesheet and imported sheet");
  }

  const computed = evidence.computed;
  if (
    !isRecord(computed) ||
    typeof computed.fontFamily !== "string" ||
    computed.fontFamily.length === 0 ||
    computed.primaryFamily !== expectedFamilies[0] ||
    primaryFontFamilyFromStack(computed.fontFamily) !== expectedFamilies[0]
  ) {
    errors.push(
      `runtime computed font stack must start with ${expectedFamilies[0]}`,
    );
  }
  return errors;
}

function hasFiniteRect(rect) {
  return (
    isRecord(rect) &&
    [rect.height, rect.left, rect.top, rect.width].every(finite)
  );
}

function matchingRect(left, right, tolerance = 1) {
  return (
    hasFiniteRect(left) &&
    hasFiniteRect(right) &&
    Math.abs(left.left - right.left) <= tolerance &&
    Math.abs(left.top - right.top) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance
  );
}

export function hasIdolFirstFrameCoverage(proof) {
  return (
    isRecord(proof) &&
    matchingRect(proof.activeLayout, proof.outgoingLayout) &&
    matchingRect(proof.outgoingRect, proof.visualRect)
  );
}

export function assessMotionPerformance(metrics, expectedWidth) {
  const errors = [];
  if (!isRecord(metrics)) {
    return ["motion performance evidence must be an object"];
  }
  if (!Array.isArray(metrics.clippedText)) {
    errors.push("clipped text evidence must be an array");
  } else if (metrics.clippedText.length > 0) {
    errors.push(`clipped text detected: ${metrics.clippedText.join(", ")}`);
  }
  if (!Array.isArray(metrics.controls) || metrics.controls.length < 3) {
    errors.push("motion controls must contain the switch and cart actions");
  } else {
    for (const control of metrics.controls) {
      if (!finite(control?.width) || !finite(control?.height)) {
        errors.push("motion control sizes must be finite");
      } else if (control.width < 44 || control.height < 44) {
        errors.push(`control below 44px: ${String(control.label)}`);
      }
    }
  }
  const clientWidth = Number(metrics?.document?.clientWidth ?? 0);
  const scrollWidth = Math.max(
    Number(metrics?.document?.scrollWidth ?? 0),
    Number(metrics?.document?.bodyScrollWidth ?? 0),
  );
  if (
    !finite(clientWidth) ||
    Math.abs(clientWidth - expectedWidth) > 0.5 ||
    scrollWidth > clientWidth + 0.5
  ) {
    errors.push(
      `horizontal overflow or viewport mismatch: client=${String(clientWidth)} scroll=${String(scrollWidth)} expected=${String(expectedWidth)}`,
    );
  }
  if (!approximatelyZero(metrics.cls)) {
    errors.push(`CLS must remain zero; measured ${String(metrics.cls)}`);
  }
  if (!approximatelyZero(metrics.rawLayoutShift)) {
    errors.push(
      `raw layout shift must remain zero; measured ${String(metrics.rawLayoutShift)}`,
    );
  }
  // 2026-10-01 user decision: the zero budget guards the motion and interaction
  // phase after the load event; tasks that start while the page loads are kept
  // in the evidence but do not fail the gate. Unplaceable tasks count as after.
  const loadEventEnd = metrics?.navigation?.loadEventEnd;
  if (!finite(loadEventEnd) || loadEventEnd <= 0) {
    errors.push(
      `page load completion must be recorded to place long tasks; measured ${String(loadEventEnd)}`,
    );
  }
  if (!Array.isArray(metrics.longTasks)) {
    errors.push("long task evidence must be an array");
  } else if (finite(loadEventEnd) && loadEventEnd > 0) {
    const afterLoad = metrics.longTasks.filter(
      (task) => !finite(task?.startTime) || task.startTime >= loadEventEnd,
    );
    if (afterLoad.length > 0) {
      errors.push(
        `long task budget exceeded after load: ${String(afterLoad.length)}`,
      );
    }
  }
  for (const observer of ["event", "layoutShift", "longTask", "lcp"]) {
    if (
      metrics?.observers?.[observer]?.supported !== true ||
      metrics?.observers?.[observer]?.installed !== true
    ) {
      errors.push(
        `${observer} performance observer must be supported and installed`,
      );
    }
  }
  if (
    !isRecord(metrics.raf) ||
    !finite(metrics.raf.p95FrameDeltaMs) ||
    !finite(metrics.raf.maxFrameDeltaMs) ||
    !Number.isInteger(metrics.raf.sampleCount) ||
    metrics.raf.sampleCount < 20 ||
    metrics.raf.p95FrameDeltaMs > 34 ||
    metrics.raf.maxFrameDeltaMs > 50
  ) {
    errors.push(
      "rAF proxy must contain at least 20 samples at a stable 30fps floor",
    );
  }
  if (metrics.fontsStatus !== "loaded") {
    errors.push("browser fonts must be loaded before measurement");
  }
  if (!finite(metrics.lcpMs) || metrics.lcpMs <= 0 || metrics.lcpMs >= 2_500) {
    errors.push(
      `LCP proxy must remain below 2500ms; measured ${String(metrics.lcpMs)}`,
    );
  }
  if (
    !isRecord(metrics.interactionLatency) ||
    !finite(metrics.interactionLatency.maxMs) ||
    metrics.interactionLatency.maxMs < 0 ||
    metrics.interactionLatency.maxMs >= 200 ||
    typeof metrics.interactionLatency.source !== "string" ||
    !metrics.interactionLatency.source.includes("not field INP")
  ) {
    errors.push(
      "interaction latency proxy must remain below 200ms and disclose it is not field INP",
    );
  } else if (
    (!Number.isInteger(metrics.interactionLatency.sampleCount) ||
      metrics.interactionLatency.sampleCount < 1) &&
    (!isRecord(metrics.interactionLatency.fallback) ||
      !finite(metrics.interactionLatency.fallback.durationMs) ||
      metrics.interactionLatency.fallback.durationMs < 0 ||
      metrics.interactionLatency.fallback.durationMs >= 200 ||
      typeof metrics.interactionLatency.fallback.method !== "string" ||
      !metrics.interactionLatency.fallback.method.includes(
        "performance.now around trusted Playwright click",
      ))
  ) {
    errors.push(
      "empty EventTiming evidence requires a reproducible trusted-click fallback",
    );
  }
  if (
    !Number.isInteger(metrics.jsTransferBytes) ||
    metrics.jsTransferBytes <= 0 ||
    metrics.jsTransferBytes >= 150_000
  ) {
    errors.push(
      `JavaScript transfer budget must remain below 150KB; measured ${String(metrics.jsTransferBytes)} bytes`,
    );
  }
  return errors;
}

function transformNumbers(value) {
  if (value === "none") {
    return [];
  }
  const match = /^(matrix|matrix3d)\(([^)]+)\)$/u.exec(String(value));
  if (match === null) {
    return null;
  }
  const numbers = match[2].split(",").map(Number);
  const expectedLength = match[1] === "matrix" ? 6 : 16;
  return numbers.length === expectedLength && numbers.every(Number.isFinite)
    ? numbers
    : null;
}

function isValidTransform(value) {
  return transformNumbers(value) !== null;
}

function isIdentityTransform(value) {
  const numbers = transformNumbers(value);
  if (numbers === null) {
    return false;
  }
  if (numbers.length === 0) {
    return true;
  }
  if (numbers.length === 16) {
    return numbers.every((number, index) =>
      [0, 5, 10, 15].includes(index)
        ? Math.abs(number - 1) < 0.0001
        : Math.abs(number) < 0.0001,
    );
  }
  return (
    Math.abs(numbers[0] - 1) < 0.0001 &&
    Math.abs(numbers[1]) < 0.0001 &&
    Math.abs(numbers[2]) < 0.0001 &&
    Math.abs(numbers[3] - 1) < 0.0001 &&
    Math.abs(numbers[4]) < 0.0001 &&
    Math.abs(numbers[5]) < 0.0001
  );
}

function assessTimingEvidence(timing, { label, maximumMs, minimumMs }) {
  const errors = [];
  if (
    !isRecord(timing) ||
    !Array.isArray(timing.items) ||
    timing.items.length === 0 ||
    !finite(timing.maxActiveDurationMs) ||
    !finite(timing.maxEndTimeMs)
  ) {
    return [`${label} timing must contain animation effect totals`];
  }
  let measuredActive = 0;
  let measuredEnd = 0;
  for (const item of timing.items) {
    if (
      !isRecord(item) ||
      typeof item.property !== "string" ||
      item.property.length === 0 ||
      !finite(item.durationMs) ||
      !finite(item.delayMs) ||
      !finite(item.endDelayMs) ||
      !finite(item.iterations) ||
      item.iterations <= 0 ||
      !finite(item.activeDurationMs) ||
      !finite(item.endTimeMs)
    ) {
      errors.push(`${label} timing item is incomplete`);
      continue;
    }
    const expectedActive = item.durationMs * item.iterations;
    const expectedEnd = Math.max(
      0,
      item.delayMs + expectedActive + item.endDelayMs,
    );
    if (
      Math.abs(item.activeDurationMs - expectedActive) > 0.5 ||
      Math.abs(item.endTimeMs - expectedEnd) > 0.5
    ) {
      errors.push(
        `${label} timing totals do not include delay/endDelay/iterations`,
      );
    }
    measuredActive = Math.max(measuredActive, item.activeDurationMs);
    measuredEnd = Math.max(measuredEnd, item.endTimeMs);
  }
  if (
    Math.abs(measuredActive - timing.maxActiveDurationMs) > 0.5 ||
    Math.abs(measuredEnd - timing.maxEndTimeMs) > 0.5 ||
    timing.maxActiveDurationMs < minimumMs ||
    timing.maxActiveDurationMs > maximumMs ||
    timing.maxEndTimeMs < minimumMs ||
    timing.maxEndTimeMs > maximumMs
  ) {
    errors.push(
      `${label} total active/end time must remain ${String(minimumMs)}-${String(maximumMs)}ms`,
    );
  }
  return errors;
}

function opacity(value) {
  return Number(value);
}

function assessHeroVisualFrames(hero, label) {
  const frames = hero?.frameStates;
  if (
    !Array.isArray(frames) ||
    frames.length !== 3 ||
    frames.map((frame) => frame?.name).join(",") !== "start,mid,end"
  ) {
    return [`${label} hero must contain ordered visual frame states`];
  }
  const [start, mid, end] = frames;
  const completeFrames = frames.every(
    (frame) =>
      isRecord(frame) &&
      typeof frame.contentOpacity === "string" &&
      finite(opacity(frame.contentOpacity)) &&
      opacity(frame.contentOpacity) >= 0 &&
      opacity(frame.contentOpacity) <= 1 &&
      typeof frame.mediaOpacity === "string" &&
      finite(opacity(frame.mediaOpacity)) &&
      opacity(frame.mediaOpacity) >= 0 &&
      opacity(frame.mediaOpacity) <= 1 &&
      typeof frame.contentTransform === "string" &&
      isValidTransform(frame.contentTransform) &&
      typeof frame.mediaTransform === "string" &&
      isValidTransform(frame.mediaTransform) &&
      isRecord(frame.rect) &&
      finite(frame.rect.height) &&
      frame.rect.height > 0 &&
      finite(frame.rect.width) &&
      frame.rect.width > 0 &&
      finite(frame.rect.left) &&
      finite(frame.rect.top),
  );
  if (!completeFrames) {
    return [`${label} hero frame evidence must be complete and finite`];
  }
  const signatures = frames.map((frame) =>
    JSON.stringify([
      frame.contentOpacity,
      frame.contentTransform,
      frame.mediaOpacity,
      frame.mediaTransform,
    ]),
  );
  if (
    new Set(signatures).size !== 3 ||
    !finite(opacity(start.contentOpacity)) ||
    !finite(opacity(mid.contentOpacity)) ||
    !finite(opacity(end.contentOpacity)) ||
    opacity(start.contentOpacity) >= opacity(mid.contentOpacity) ||
    opacity(mid.contentOpacity) >= opacity(end.contentOpacity) ||
    opacity(start.mediaOpacity) >= opacity(mid.mediaOpacity) ||
    opacity(mid.mediaOpacity) >= opacity(end.mediaOpacity) ||
    opacity(end.contentOpacity) < 0.99 ||
    opacity(end.mediaOpacity) < 0.99 ||
    isIdentityTransform(start.contentTransform) ||
    isIdentityTransform(start.mediaTransform) ||
    !isIdentityTransform(end.contentTransform) ||
    !isIdentityTransform(end.mediaTransform)
  ) {
    return [
      `${label} hero visual change must be non-no-op from distinct start/mid frames to opaque identity end`,
    ];
  }
  return [];
}

function assessOpacityCrossfade(frames, label) {
  if (
    !isRecord(frames?.start) ||
    !isRecord(frames?.end) ||
    !finite(opacity(frames.start.activeOpacity)) ||
    !finite(opacity(frames.start.outgoingOpacity)) ||
    !finite(opacity(frames.end.activeOpacity)) ||
    !finite(opacity(frames.end.outgoingOpacity)) ||
    opacity(frames.start.activeOpacity) > 0.01 ||
    opacity(frames.start.outgoingOpacity) < 0.99 ||
    opacity(frames.end.activeOpacity) < 0.99 ||
    opacity(frames.end.outgoingOpacity) > 0.01
  ) {
    return [`${label} visual change must crossfade from outgoing to active`];
  }
  return [];
}

export function assessReducedMotionEvidence(measurement, expectedWidth) {
  const errors = [];
  if (!isRecord(measurement)) {
    return ["reduced-motion measurement must be an object"];
  }
  if (measurement.mediaQuery !== true) {
    errors.push("reduced-motion media query must be active");
  }
  if (measurement.viewportWidth !== expectedWidth) {
    errors.push(`reduced-motion viewport must be ${String(expectedWidth)}px`);
  }
  if (measurement.scrollBehavior !== "auto") {
    errors.push("reduced-motion scroll behavior must be auto");
  }
  if (!approximatelyZero(measurement.positionDeltaPx)) {
    errors.push("reduced-motion interactions must not move the fixture");
  }
  if (!approximatelyZero(measurement.scrollDeltaPx)) {
    errors.push("reduced-motion interactions must preserve scroll position");
  }
  if (measurement.statusClear !== true) {
    errors.push("reduced-motion state feedback must remain explicit");
  }
  const feedback = measurement.stateFeedback;
  const visiblyRendered = (state) =>
    isRecord(state) &&
    typeof state.text === "string" &&
    state.text.trim().length > 0 &&
    state.display !== "none" &&
    state.visibility === "visible" &&
    finite(Number(state.opacity)) &&
    Number(state.opacity) >= 0.99;
  if (
    feedback?.selectedId !== "noa-aster" ||
    feedback?.selectedLabelVisible !== true ||
    feedback?.confirmedLabelVisible !== true ||
    feedback?.cartCount !== 1 ||
    typeof feedback?.liveRegionText !== "string" ||
    feedback.liveRegionText.trim().length === 0 ||
    feedback?.successVisible !== true ||
    !visiblyRendered(feedback?.heroContent) ||
    !visiblyRendered(feedback?.idolCopy) ||
    !visiblyRendered(feedback?.selectedLabel) ||
    !visiblyRendered(feedback?.confirmedLabel) ||
    !visiblyRendered(feedback?.success)
  ) {
    errors.push(
      "reduced-motion feedback must keep visible text at opaque display/visibility for the selected idol, confirmed label, cart count, live region and success state",
    );
  }
  for (const key of ["hero", "idol", "add", "success"]) {
    const value = measurement[key];
    if (
      !isRecord(value) ||
      !approximatelyZero(value.animationMs) ||
      !approximatelyZero(value.transitionMs) ||
      !isIdentityTransform(value.transform)
    ) {
      errors.push(
        `${key} must have zero-duration, no-displacement reduced motion`,
      );
    }
  }
  return errors;
}

function diagnosticsErrors(diagnostics) {
  const errors = [];
  for (const key of [
    "console",
    "externalResources",
    "httpErrors",
    "pageErrors",
    "requestFailures",
  ]) {
    if (!Array.isArray(diagnostics?.[key])) {
      errors.push(`diagnostics.${key} must be an array`);
    } else if (diagnostics[key].length > 0) {
      errors.push(`diagnostics.${key} must be empty`);
    }
  }
  if (
    !Array.isArray(diagnostics?.requests) ||
    diagnostics.requests.length === 0
  ) {
    errors.push("diagnostics.requests must contain browser traffic");
  } else if (
    diagnostics.requests.some((request) => request?.allowed !== true)
  ) {
    errors.push("all browser traffic must remain same-origin or embedded");
  }
  return errors;
}

function axeRuleInventory(result) {
  return [
    ...new Set(
      ["inapplicable", "incomplete", "passes", "violations"].flatMap(
        (category) =>
          Array.isArray(result?.[category])
            ? result[category]
                .map((rule) => rule?.id)
                .filter((id) => typeof id === "string" && id.length > 0)
            : [],
      ),
    ),
  ].sort();
}

function isSafeFingerprintPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /^[a-z]:/iu.test(value)
  ) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return (
    normalized === value &&
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.startsWith("../") &&
    !normalized.split("/").some((segment) => segment === "..")
  );
}

function hasValidSourceFingerprint(snapshot) {
  if (
    !isRecord(snapshot) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(snapshot.sha) ||
    snapshot.sourceFingerprintAlgorithm !== sourceFingerprintAlgorithm ||
    !/^[a-f0-9]{64}$/u.test(snapshot.sourceFingerprint) ||
    !Array.isArray(snapshot.sourceFingerprintFiles) ||
    snapshot.sourceFingerprintFiles.length === 0 ||
    !Array.isArray(snapshot.status) ||
    snapshot.status.some((line) => typeof line !== "string")
  ) {
    return false;
  }

  let previousPath;
  for (const file of snapshot.sourceFingerprintFiles) {
    if (
      !isRecord(file) ||
      Object.keys(file).sort().join(",") !== "path,sha256" ||
      !isSafeFingerprintPath(file.path) ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      (previousPath !== undefined && previousPath >= file.path)
    ) {
      return false;
    }
    previousPath = file.path;
  }

  return (
    snapshot.sourceFingerprint ===
    sha256(
      JSON.stringify({
        algorithm: sourceFingerprintAlgorithm,
        files: snapshot.sourceFingerprintFiles,
      }),
    )
  );
}

function hasSameGitEvidence(before, after) {
  return (
    hasValidSourceFingerprint(before) &&
    hasValidSourceFingerprint(after) &&
    before.sha === after.sha &&
    before.sourceFingerprint === after.sourceFingerprint &&
    before.sourceFingerprintAlgorithm === sourceFingerprintAlgorithm &&
    after.sourceFingerprintAlgorithm === sourceFingerprintAlgorithm &&
    JSON.stringify(before.sourceFingerprintFiles) ===
      JSON.stringify(after.sourceFingerprintFiles) &&
    JSON.stringify(before.status) === JSON.stringify(after.status)
  );
}

export function assessMotionEvidenceShape(results) {
  const errors = [];
  if (!isRecord(results) || results.schemaVersion !== 1) {
    return ["motion evidence must use schemaVersion 1"];
  }
  const matrixErrors = validateMotionScenarioMatrix(results.matrix);
  errors.push(...matrixErrors);
  if (
    JSON.stringify(results.matrix) !==
    JSON.stringify(createMotionScenarioMatrix())
  ) {
    errors.push("persisted motion matrix must match the canonical matrix");
  }
  if (
    results.result !== "passed-with-physical-device-gate" ||
    results.physicalDeviceEvidence !== false ||
    typeof results.remainingGate !== "string" ||
    !/real mobile-device recording/iu.test(results.remainingGate)
  ) {
    errors.push("desktop evidence must retain the explicit real-device gate");
  }
  if (!hasSameGitEvidence(results?.git?.before, results?.git?.after)) {
    errors.push(
      "motion evidence Git and source fingerprints must remain stable",
    );
  }
  if (
    results.fontLoadingPolicy?.strategy !== "optional" ||
    !Number.isSafeInteger(results.fontLoadingPolicy?.cssFiles) ||
    results.fontLoadingPolicy.cssFiles < 1 ||
    !Number.isSafeInteger(results.fontLoadingPolicy?.fontFaces) ||
    results.fontLoadingPolicy.fontFaces < expectedFontFamilies.length ||
    JSON.stringify(results.fontLoadingPolicy?.verifiedFamilies) !==
      JSON.stringify([...expectedFontFamilies].sort())
  ) {
    errors.push(
      "motion evidence must prove the production no-swap font loading policy",
    );
  }
  const versionKeys = isRecord(results.versions)
    ? Object.keys(results.versions).sort()
    : [];
  if (
    JSON.stringify(versionKeys) !==
      JSON.stringify(expectedToolchainVersionKeys) ||
    !/^Google Chrome \d+(?:\.\d+){0,3}$/u.test(
      String(results.versions?.browser ?? ""),
    ) ||
    Object.entries(expectedToolchainVersions).some(
      ([name, version]) => results.versions?.[name] !== version,
    )
  ) {
    errors.push(
      "motion evidence browser toolchain versions must match the exact project manifests",
    );
  }
  if (
    !Array.isArray(results.runtimeGates) ||
    results.runtimeGates.length !== 3
  ) {
    errors.push(
      "motion evidence requires preview, staging and production gates",
    );
  } else {
    for (const environment of ["preview", "staging", "production"]) {
      const gate = results.runtimeGates.find(
        (candidate) => candidate?.environment === environment,
      );
      const expectedStatus = environment === "preview" ? 200 : 404;
      if (
        gate?.healthStatus !== 200 ||
        !Array.isArray(gate.localeStatuses) ||
        gate.localeStatuses.length !== previewLocales.length ||
        gate.localeStatuses.some((status) => status !== expectedStatus)
      ) {
        errors.push(`${environment} motion route gate is invalid`);
      }
    }
  }
  if (
    !Array.isArray(results.scenarioResults) ||
    results.scenarioResults.length !== motionScenarioMatrix.length
  ) {
    errors.push("motion evidence must contain all eight scenario results");
  } else {
    for (const entry of motionScenarioMatrix) {
      const result = results.scenarioResults.find(
        (candidate) => candidate?.id === entry.id,
      );
      const expectedFixture = `/_internal/design-foundations/${encodeURIComponent(entry.locale)}/motion`;
      if (
        result?.fixtureUrl !== expectedFixture ||
        result?.locale !== entry.locale ||
        result?.screenshot !== entry.screenshot ||
        JSON.stringify(result?.viewport) !== JSON.stringify(entry.viewport) ||
        !Array.isArray(result?.errors) ||
        result.errors.length > 0
      ) {
        errors.push(`scenario ${entry.id} metadata is invalid`);
        continue;
      }
      errors.push(
        ...assessMotionPerformance(
          result.performance,
          entry.viewport.width,
        ).map((error) => `${entry.id}: ${error}`),
      );
      errors.push(
        ...assessRuntimeFontEvidence(result.runtimeFonts, entry.locale).map(
          (error) => `${entry.id}: ${error}`,
        ),
      );
      errors.push(
        ...diagnosticsErrors(result.diagnostics).map(
          (error) => `${entry.id}: ${error}`,
        ),
      );
    }
  }
  const checks = results.motionChecks;
  for (const viewport of ["mobile", "desktop"]) {
    const hero = checks?.hero?.[viewport];
    if (
      !isRecord(hero) ||
      !finite(hero.durationMs) ||
      hero.durationMs < 600 ||
      hero.durationMs > 900 ||
      JSON.stringify(hero.frames) !== JSON.stringify(["start", "mid", "end"]) ||
      !approximatelyZero(hero.layoutShift)
    ) {
      errors.push(
        `${viewport} hero must prove stable start/mid/end frames at 600-900ms`,
      );
    }
    errors.push(
      ...assessTimingEvidence(hero?.timing, {
        label: `${viewport} hero`,
        maximumMs: 900,
        minimumMs: 600,
      }),
      ...assessHeroVisualFrames(hero, viewport),
    );
  }
  const idol = checks?.idolSwitch;
  if (
    idol?.mouse?.mode !== "spatial" ||
    !finite(idol?.mouse?.durationMs) ||
    idol.mouse.durationMs <= 0 ||
    idol.mouse.durationMs > 360
  ) {
    errors.push("idol mouse spatial transition must finish within 360ms");
  }
  if (idol?.mouse?.focusPreserved !== true) {
    errors.push("idol mouse transition must preserve radio focus");
  }
  errors.push(
    ...assessTimingEvidence(idol?.mouse?.timing, {
      label: "idol mouse",
      maximumMs: 360,
      minimumMs: 1,
    }),
    ...assessOpacityCrossfade(idol?.mouse?.visualFrames, "idol mouse"),
  );
  if (
    idol?.mouse?.firstFrame?.coverage !== true ||
    !hasIdolFirstFrameCoverage(idol?.mouse?.firstFrame) ||
    !finite(idol?.mouse?.firstFrame?.activeOpacity) ||
    idol.mouse.firstFrame.activeOpacity > 0.01 ||
    !finite(idol?.mouse?.firstFrame?.outgoingOpacity) ||
    idol.mouse.firstFrame.outgoingOpacity < 0.99
  ) {
    errors.push(
      `idol switch first frame must preserve outgoing coverage while active starts transparent; measured ${JSON.stringify(idol?.mouse?.firstFrame ?? null)}`,
    );
  }
  if (
    idol?.touch?.mode !== "opacity" ||
    !finite(idol?.touch?.durationMs) ||
    idol.touch.durationMs <= 0 ||
    idol.touch.durationMs > 360
  ) {
    errors.push("idol touch opacity transition must finish within 360ms");
  }
  if (
    JSON.stringify(idol?.touch?.transitionProperties) !==
      JSON.stringify(["opacity"]) ||
    !isIdentityTransform(idol?.touch?.transform)
  ) {
    errors.push(
      "idol touch motion must transition opacity only with no transform",
    );
  }
  errors.push(
    ...assessTimingEvidence(idol?.touch?.timing, {
      label: "idol touch",
      maximumMs: 360,
      minimumMs: 1,
    }),
    ...assessOpacityCrossfade(idol?.touch?.visualFrames, "idol touch"),
  );
  if (
    idol?.keyboard?.mode !== "instant" ||
    idol?.keyboard?.durationMs !== 0 ||
    idol?.keyboard?.transitionMs !== 0 ||
    idol?.keyboard?.animationMs !== 0 ||
    !isIdentityTransform(idol?.keyboard?.transform) ||
    idol?.keyboard?.focusPreserved !== true
  ) {
    errors.push(
      "idol keyboard change must have computed zero motion and preserve focus",
    );
  }
  if (
    idol?.latestWins?.attempts !== 10 ||
    idol?.latestWins?.selected !== "mira-vale" ||
    idol?.latestWins?.cleared !== true ||
    idol?.latestWins?.outgoingCount !== 0
  ) {
    errors.push(
      "idol switch must prove 10-attempt latest-wins behavior and clear outgoing layers",
    );
  }
  if (
    idol?.rapidReverse?.cancelled !== true ||
    idol?.rapidReverse?.selected !== "mira-vale" ||
    idol?.rapidReverse?.outgoingCount !== 0 ||
    idol?.rapidReverse?.activeReady !== true ||
    idol?.rapidReverse?.activeVisible !== true ||
    idol?.rapidReverse?.blankFrame !== false ||
    !finite(idol?.rapidReverse?.activeOpacity) ||
    idol.rapidReverse.activeOpacity < 0.99
  ) {
    errors.push(
      "slow-image rapid reverse must cancel atomically with Mira visible and no blank frame",
    );
  }
  if (idol?.scrollPreserved !== true) {
    errors.push("idol switch must preserve scroll position");
  }
  if (
    idol?.activeImage?.blockedWhileLoading !== true ||
    idol?.activeImage?.complete !== true ||
    !finite(idol?.activeImage?.naturalWidth) ||
    idol.activeImage.naturalWidth <= 0 ||
    idol?.activeImage?.decodeResolvedBeforeExit !== true
  ) {
    errors.push(
      "active idol image must complete and decode before the outgoing layer exits",
    );
  }
  const decodeFallback = idol?.decodeRejectionFallback;
  if (
    decodeFallback?.decodeRejected !== true ||
    decodeFallback?.prepareBeforeReject !== true ||
    decodeFallback?.prepareAfterReject !== true ||
    decodeFallback?.outgoingRetainedBeforeError !== true ||
    decodeFallback?.fallbackVisible !== true ||
    decodeFallback?.settledAfterFallback !== true ||
    decodeFallback?.outgoingCount !== 0 ||
    decodeFallback?.activeVisible !== true ||
    decodeFallback?.blankFrame !== false
  ) {
    errors.push(
      "decode rejection must retain the outgoing image until runtime fallback is visible, then settle without a blank frame",
    );
  }
  const add = checks?.addToCart;
  if (
    add?.pendingObserved !== true ||
    !finite(add?.stateDelayMs) ||
    add.stateDelayMs < 0 ||
    add.stateDelayMs > 220 ||
    !finite(add?.visualDurationMs) ||
    add.visualDurationMs < 220 ||
    add.visualDurationMs > 320 ||
    add?.buttonFocused !== true ||
    add?.liveAnnouncement !== true ||
    add?.countDelta !== 1
  ) {
    errors.push(
      "add-to-cart state must confirm within 220ms and retain a 220-320ms visual feedback with focus and live status",
    );
  }
  errors.push(
    ...assessTimingEvidence(add?.timing, {
      label: "add-to-cart",
      maximumMs: 320,
      minimumMs: 220,
    }),
  );
  if (
    !isRecord(add?.visualFrames?.start) ||
    !isRecord(add?.visualFrames?.end) ||
    !finite(opacity(add.visualFrames.start.actionOpacity)) ||
    !finite(opacity(add.visualFrames.start.confirmedOpacity)) ||
    !finite(opacity(add.visualFrames.end.actionOpacity)) ||
    !finite(opacity(add.visualFrames.end.confirmedOpacity)) ||
    opacity(add.visualFrames.start.actionOpacity) < 0.99 ||
    opacity(add.visualFrames.start.confirmedOpacity) > 0.01 ||
    opacity(add.visualFrames.end.actionOpacity) > 0.01 ||
    opacity(add.visualFrames.end.confirmedOpacity) < 0.99
  ) {
    errors.push(
      "add-to-cart visual change must crossfade from action to confirmed state",
    );
  }
  if (
    add?.interruption?.resetToIdle !== true ||
    add?.interruption?.pendingObserved !== true ||
    add?.interruption?.countStableOnError !== true ||
    add?.interruption?.errorLive !== true
  ) {
    errors.push(
      "add-to-cart interruption must reset, interrupt pending feedback, preserve count and announce the error",
    );
  }
  const success = checks?.success;
  if (
    !finite(success?.durationMs) ||
    success.durationMs < 600 ||
    success.durationMs > 900 ||
    success?.statusClear !== true ||
    success?.remainingAnimations !== 0
  ) {
    errors.push(
      "success reveal must remain explicit, finish within 600-900ms, and settle with no remaining animation",
    );
  }
  errors.push(
    ...assessTimingEvidence(success?.timing, {
      label: "success reveal",
      maximumMs: 900,
      minimumMs: 600,
    }),
  );
  if (
    !isRecord(success?.visualFrames?.start) ||
    !isRecord(success?.visualFrames?.end) ||
    !finite(opacity(success.visualFrames.start.markerOpacity)) ||
    !finite(opacity(success.visualFrames.start.bodyOpacity)) ||
    !finite(opacity(success.visualFrames.end.markerOpacity)) ||
    !finite(opacity(success.visualFrames.end.bodyOpacity)) ||
    opacity(success.visualFrames.start.markerOpacity) >= 0.99 ||
    opacity(success.visualFrames.start.bodyOpacity) >= 0.99 ||
    opacity(success.visualFrames.end.markerOpacity) < 0.99 ||
    opacity(success.visualFrames.end.bodyOpacity) < 0.99 ||
    isIdentityTransform(success.visualFrames.start.markerTransform) ||
    !isIdentityTransform(success.visualFrames.end.markerTransform)
  ) {
    errors.push(
      "success visual change must reveal non-identity transparent start into opaque identity end",
    );
  }
  errors.push(
    ...assessReducedMotionEvidence(results?.reducedMotion?.mobile, 390).map(
      (error) => `mobile reduced motion: ${error}`,
    ),
    ...assessReducedMotionEvidence(results?.reducedMotion?.desktop, 1440).map(
      (error) => `desktop reduced motion: ${error}`,
    ),
  );
  const canonicalAxe = motionScenarioMatrix.flatMap((entry) =>
    entry.axe.map((scan) => ({
      artifact: `axe-results/${scan.id}.json`,
      id: scan.id,
      scenarioId: entry.id,
    })),
  );
  if (!Array.isArray(results.axeSummaries)) {
    errors.push("axe summaries must be an array");
  } else {
    const ids = new Set();
    const artifacts = new Set();
    for (const [index, expected] of canonicalAxe.entries()) {
      const summary = results.axeSummaries[index];
      if (
        summary?.id !== expected.id ||
        summary?.scenarioId !== expected.scenarioId ||
        summary?.artifact !== expected.artifact
      ) {
        errors.push(
          "axe summaries must match the canonical id/scenario/artifact mapping",
        );
      }
      if (
        !isSafeRelativeArtifactPath(summary?.artifact, ".json") ||
        ids.has(summary?.id) ||
        artifacts.has(summary?.artifact)
      ) {
        errors.push("axe artifacts and ids must be safe and unique");
      }
      ids.add(summary?.id);
      artifacts.add(summary?.artifact);
      if (
        !Array.isArray(summary?.ruleInventory) ||
        summary.ruleInventory.length === 0 ||
        summary.ruleInventory.some(
          (rule) => typeof rule !== "string" || rule.length === 0,
        )
      ) {
        errors.push("axe rule inventory must be non-empty");
      }
      if (!Array.isArray(summary?.blocking) || summary.blocking.length > 0) {
        errors.push(
          "all three axe scans must have zero critical/serious findings",
        );
      }
    }
    if (results.axeSummaries.length !== canonicalAxe.length) {
      errors.push("all three canonical axe scans must be present");
    }
  }
  return errors;
}

export function assessCurrentMotionEvidence(results, currentFingerprint) {
  const errors = assessMotionEvidenceShape(results);
  if (
    !isRecord(currentFingerprint) ||
    currentFingerprint.algorithm !== sourceFingerprintAlgorithm ||
    currentFingerprint.digest !== results?.git?.after?.sourceFingerprint ||
    JSON.stringify(currentFingerprint.files) !==
      JSON.stringify(results?.git?.after?.sourceFingerprintFiles)
  ) {
    errors.push(
      "persisted P2-05 motion evidence is stale; rerun verify-ui-motion-browser.mjs",
    );
  }
  return errors;
}

export function createMotionEvidenceReadme({
  axeSummaries = [],
  fontLoadingPolicy,
  generatedAt,
  git,
  remainingGate,
  scenarioResults = [],
  screenshots = [],
} = {}) {
  return [
    "# P2-05 signature motion browser verification",
    "",
    `Generated: ${String(generatedAt ?? "unknown")}`,
    "",
    "## Outcome",
    "",
    `- Production build: true`,
    `- Locale scenarios: ${String(scenarioResults.length)}/8`,
    `- Screenshots: ${String(screenshots.length)}`,
    `- Axe scans: ${String(axeSummaries.length)}; critical/serious blocking findings: ${String(axeSummaries.reduce((total, scan) => total + (scan.blocking?.length ?? 0), 0))}`,
    `- Font loading: ${String(fontLoadingPolicy?.fontFaces ?? 0)} production font faces use ${String(fontLoadingPolicy?.strategy ?? "unknown")}; verified families: ${String(fontLoadingPolicy?.verifiedFamilies?.length ?? 0)}/${String(expectedFontFamilies.length)}`,
    `- Runtime font sets: ${String(scenarioResults.filter((result) => assessRuntimeFontEvidence(result?.runtimeFonts, result?.locale).length === 0).length)}/${String(motionScenarioMatrix.length)} locale scenarios prove document.fonts, CSSOM and computed-stack parity`,
    `- Source fingerprint: ${String(git?.before?.sourceFingerprint ?? "unknown")} (${String(git?.before?.sourceFingerprintAlgorithm ?? sourceFingerprintAlgorithm)})`,
    "- Physical device evidence: false",
    "",
    "## Remaining gate",
    "",
    remainingGate ??
      "Real mobile-device recording and frame-rate evidence is still required.",
    "Desktop Chrome viewport/touch emulation is intentionally not described as physical-device proof.",
    "LCP, PerformanceEventTiming interaction latency, rAF pacing, and JavaScript transfer bytes are local desktop Chrome proxies; the interaction measurement is not field INP.",
    "",
    "## Screenshot SHA-256",
    "",
    ...screenshots.map((entry) => `- ${entry.path} (${entry.sha256})`),
    "",
    `Rerun: \`${rerunCommand}\``,
    "",
    "This is local production-build evidence behind the internal preview gate. It is not deployment, staging infrastructure, production release evidence, or physical-device performance evidence.",
    "",
  ].join("\n");
}

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function lstatIfExists(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function motionEvidenceBackupPath(target) {
  return path.join(path.dirname(target), `.${path.basename(target)}-backup`);
}

async function processStartMarker(pid) {
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code === "ESRCH") {
      alive = false;
    } else if (error?.code !== "EPERM") {
      throw error;
    }
  }
  if (!alive) {
    return null;
  }
  const marker = (
    await captureCommand(
      "ps",
      ["-o", "lstart=", "-p", String(pid)],
      process.cwd(),
    )
  ).trim();
  return marker.length > 0 ? marker : null;
}

async function reclaimMotionLock(lockPath) {
  const stalePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await rename(lockPath, stalePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  await rm(stalePath, { force: true, recursive: true });
  return true;
}

function motionLockAuthorityPort(evidenceParentRealPath) {
  const digest = createHash("sha256").update(evidenceParentRealPath).digest();
  return 30_000 + (digest.readUInt16BE(0) % 20_000);
}

async function acquireMotionLockAuthority(evidenceParent) {
  const evidenceParentRealPath = await realpath(evidenceParent);
  const host = "127.0.0.1";
  const port = motionLockAuthorityPort(evidenceParentRealPath);
  const authority = createServer();
  authority.unref();
  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        authority.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        authority.off("error", onError);
        resolve();
      };
      authority.once("error", onError);
      authority.once("listening", onListening);
      authority.listen({ exclusive: true, host, port });
    });
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      throw new Error(
        "P2-05 evidence lock is held; another browser verification is running",
        { cause: error },
      );
    }
    throw error;
  }
  let closed = false;
  return {
    host,
    port,
    async close() {
      if (closed) {
        return;
      }
      await new Promise((resolve, reject) =>
        authority.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
      closed = true;
    },
  };
}

export async function acquireMotionEvidenceLock(evidenceParent) {
  const lockPath = path.join(evidenceParent, ".p2-05-run.lock");
  const token = randomUUID();
  const currentProcessStartMarker = await processStartMarker(process.pid);
  invariant(
    currentProcessStartMarker !== null,
    "P2-05 cannot identify the current process start",
  );
  const authority = await acquireMotionLockAuthority(evidenceParent);
  let initializationPath;
  try {
    const owner = {
      authority: { host: authority.host, port: authority.port },
      pid: process.pid,
      processStartMarker: currentProcessStartMarker,
      schemaVersion: 1,
      token,
    };
    initializationPath = `${lockPath}.init-${token}`;
    await mkdir(initializationPath, { mode: 0o700 });
    await writeFile(
      path.join(initializationPath, "owner.json"),
      `${JSON.stringify(owner)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    if ((await lstatIfExists(lockPath)) !== null) {
      await reclaimMotionLock(lockPath);
    }
    await rename(initializationPath, lockPath);
    const publishedOwner = JSON.parse(
      await readFile(path.join(lockPath, "owner.json"), "utf8"),
    );
    invariant(
      publishedOwner.token === token &&
        publishedOwner.processStartMarker === currentProcessStartMarker,
      "P2-05 evidence lock initialization lost its race",
    );
  } catch (error) {
    try {
      if (initializationPath !== undefined) {
        await rm(initializationPath, { force: true, recursive: true });
      }
    } finally {
      await authority.close();
    }
    throw error;
  }
  let released = false;
  return {
    path: lockPath,
    async release() {
      if (released) {
        return;
      }
      const ownerPath = path.join(lockPath, "owner.json");
      const ownerDetails = await lstatIfExists(ownerPath);
      invariant(
        ownerDetails?.isFile() === true && !ownerDetails.isSymbolicLink(),
        "P2-05 evidence lock owner is not a regular file",
      );
      const owner = JSON.parse(await readFile(ownerPath, "utf8"));
      invariant(
        owner.token === token &&
          owner.processStartMarker === currentProcessStartMarker,
        "P2-05 evidence lock ownership changed",
      );
      const releasePath = `${lockPath}.release-${token}`;
      await rename(lockPath, releasePath);
      await rm(releasePath, { force: true, recursive: true });
      await authority.close();
      released = true;
    },
  };
}

async function inspectMotionEvidenceDirectory(candidate, label) {
  const details = await lstatIfExists(candidate);
  if (details === null) {
    return { exists: false, label, valid: false };
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    return {
      error: new Error(`P2-05 evidence ${label} must be a real directory`),
      exists: true,
      label,
      valid: false,
    };
  }
  try {
    await validateMotionEvidenceCandidate(candidate);
    return { exists: true, label, valid: true };
  } catch (error) {
    return { error, exists: true, label, valid: false };
  }
}

function invalidEvidenceRecoveryError(targetState, backupState) {
  const invalid = [targetState, backupState]
    .filter((state) => state.exists && !state.valid)
    .map((state) => state.label)
    .join(" and ");
  return new AggregateError(
    [targetState.error, backupState.error].filter(Boolean),
    `P2-05 cannot recover because ${invalid || "available directories"} do not contain valid evidence`,
  );
}

export async function recoverMotionEvidenceSwap(
  target,
  { move = rename, remove = rm } = {},
) {
  const backup = motionEvidenceBackupPath(target);
  const [targetState, backupState] = await Promise.all([
    inspectMotionEvidenceDirectory(target, "target"),
    inspectMotionEvidenceDirectory(backup, "backup"),
  ]);

  if (!backupState.exists) {
    if (targetState.exists && !targetState.valid) {
      throw invalidEvidenceRecoveryError(targetState, backupState);
    }
    return;
  }

  if (!targetState.exists) {
    if (!backupState.valid) {
      throw invalidEvidenceRecoveryError(targetState, backupState);
    }
    await move(backup, target);
    return;
  }

  if (targetState.valid) {
    await remove(backup, { force: true, recursive: true });
    return;
  }

  if (!backupState.valid) {
    throw invalidEvidenceRecoveryError(targetState, backupState);
  }

  const invalidTarget = path.join(
    path.dirname(target),
    `.${path.basename(target)}-invalid-${randomUUID()}`,
  );
  await move(target, invalidTarget);
  try {
    await move(backup, target);
  } catch (error) {
    await move(invalidTarget, target);
    throw error;
  }
  try {
    await validateMotionEvidenceCandidate(target);
  } catch (error) {
    await move(target, backup);
    await move(invalidTarget, target);
    throw new Error("P2-05 backup became invalid during recovery", {
      cause: error,
    });
  }
  await remove(invalidTarget, { force: true, recursive: true });
}

export function createMotionEvidenceCleanup({
  canReleaseLock = () => true,
  candidate,
  closeResources,
  getCandidate = () => candidate,
  getServer,
  getTarget = () => target,
  lockPath,
  releaseLock,
  recover = recoverMotionEvidenceSwap,
  stop = stopServer,
  target,
}) {
  let cleanupPromise;
  return function cleanup() {
    cleanupPromise ??= (async () => {
      const errors = [];
      const attempt = async (operation) => {
        try {
          await operation();
        } catch (error) {
          errors.push(error);
        }
      };
      await attempt(() => stop(getServer()));
      if (closeResources !== undefined) {
        await attempt(closeResources);
      }
      let recoverySucceeded = true;
      const activeTarget = getTarget();
      if (activeTarget !== undefined) {
        try {
          await recover(activeTarget);
        } catch (error) {
          recoverySucceeded = false;
          errors.push(error);
        }
      }
      const activeCandidate = getCandidate();
      if (activeCandidate !== undefined) {
        await attempt(() =>
          rm(activeCandidate, { force: true, recursive: true }),
        );
      }
      if (recoverySucceeded && canReleaseLock()) {
        await attempt(() =>
          releaseLock === undefined
            ? rm(lockPath, { force: true, recursive: true })
            : releaseLock(),
        );
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "P2-05 cleanup failed");
      }
    })();
    return cleanupPromise;
  };
}

function trackedProcessIsAlive({ child, processGroup }) {
  if (processGroup && process.platform !== "win32") {
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") {
        return false;
      }
      if (error?.code === "EPERM") {
        return true;
      }
      throw error;
    }
  }
  return child.exitCode === null && child.signalCode === null;
}

async function waitForTrackedProcessExit(entry, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!trackedProcessIsAlive(entry)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !trackedProcessIsAlive(entry);
}

async function terminateWindowsProcessTree(pid, force) {
  const killer = spawn(
    "taskkill",
    ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
    { stdio: "ignore", windowsHide: true },
  );
  await new Promise((resolve, reject) => {
    killer.once("error", reject);
    killer.once("close", resolve);
  });
}

async function signalTrackedProcess(entry, signal) {
  const { child, processGroup } = entry;
  try {
    if (process.platform === "win32") {
      await terminateWindowsProcessTree(child.pid, signal === "SIGKILL");
    } else if (processGroup) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

async function terminateTrackedChild(
  entry,
  { graceTimeoutMs = 2_000, killTimeoutMs = 2_000 } = {},
) {
  if (!trackedProcessIsAlive(entry)) {
    return;
  }
  await signalTrackedProcess(entry, "SIGTERM");
  if (await waitForTrackedProcessExit(entry, graceTimeoutMs)) {
    return;
  }
  await signalTrackedProcess(entry, "SIGKILL");
  if (!(await waitForTrackedProcessExit(entry, killTimeoutMs))) {
    throw new Error(
      `P2-05 could not terminate tracked process tree ${String(entry.child.pid)}`,
    );
  }
}

async function closeBrowserWithin(browser, timeoutMs) {
  let timeout;
  try {
    await Promise.race([
      Promise.resolve().then(() => browser.close()),
      new Promise((resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("P2-05 browser close timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function createMotionResourceRegistry({
  browserCloseTimeoutMs = 5_000,
  childGraceTimeoutMs = 2_000,
  childKillTimeoutMs = 2_000,
} = {}) {
  const browsers = new Set();
  const children = new Map();
  let cleanupPromise;
  let closing = false;
  const terminate = (entry) =>
    terminateTrackedChild(entry, {
      graceTimeoutMs: childGraceTimeoutMs,
      killTimeoutMs: childKillTimeoutMs,
    });
  return {
    closeBrowser(browser) {
      return closeBrowserWithin(browser, browserCloseTimeoutMs);
    },
    cleanup() {
      closing = true;
      cleanupPromise ??= (async () => {
        const errors = [];
        const settle = async (operation) => {
          try {
            await operation();
          } catch (error) {
            errors.push(error);
          }
        };
        await Promise.all([
          ...[...browsers].map((browser) =>
            settle(() => closeBrowserWithin(browser, browserCloseTimeoutMs)),
          ),
          ...[...children.values()].map((entry) =>
            settle(() => terminate(entry)),
          ),
        ]);
        browsers.clear();
        children.clear();
        if (errors.length > 0) {
          throw new AggregateError(
            errors,
            `P2-05 resource cleanup failed: ${errors
              .map((error) =>
                error instanceof Error ? error.message : String(error),
              )
              .join("; ")}`,
          );
        }
      })();
      return cleanupPromise;
    },
    trackBrowser(browser) {
      if (closing) {
        void closeBrowserWithin(browser, browserCloseTimeoutMs).catch(
          () => undefined,
        );
        return () => undefined;
      }
      browsers.add(browser);
      return () => browsers.delete(browser);
    },
    trackChild(child, { processGroup = false } = {}) {
      const entry = { child, processGroup };
      if (closing) {
        void terminate(entry).catch(() => undefined);
        return () => undefined;
      }
      children.set(child, entry);
      return () => children.delete(child);
    },
  };
}

function isContainedRealPath(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function requireEvidenceRoot(candidate) {
  const details = await lstatIfExists(candidate);
  if (details === null || !details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("P2-05 evidence candidate root must be a real directory");
  }
  return { absolute: path.resolve(candidate), real: await realpath(candidate) };
}

async function requireEvidenceFile(candidate, relativePath) {
  if (!isSafeFingerprintPath(relativePath)) {
    throw new Error(`P2-05 evidence path is unsafe: ${relativePath}`);
  }
  const root = await requireEvidenceRoot(candidate);
  const segments = relativePath.split("/");
  let current = root.absolute;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const details = await lstatIfExists(current);
    if (
      details === null ||
      !details.isDirectory() ||
      details.isSymbolicLink()
    ) {
      throw new Error(
        `P2-05 evidence ${relativePath} has a missing or symbolic-link ancestor`,
      );
    }
    if (!isContainedRealPath(root.real, await realpath(current))) {
      throw new Error(`P2-05 evidence ${relativePath} escaped its candidate`);
    }
  }
  const target = path.join(current, segments.at(-1));
  const details = await lstatIfExists(target);
  if (details === null || !details.isFile() || details.isSymbolicLink()) {
    throw new Error(`P2-05 evidence ${relativePath} must be a regular file`);
  }
  if (!isContainedRealPath(root.real, await realpath(target))) {
    throw new Error(`P2-05 evidence ${relativePath} escaped its candidate`);
  }
  return target;
}

async function readJsonFile(candidate, relativePath) {
  try {
    return JSON.parse(
      await readFile(
        await requireEvidenceFile(candidate, relativePath),
        "utf8",
      ),
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`P2-05 ${relativePath} must contain valid JSON`, {
        cause: error,
      });
    }
    throw error;
  }
}

export async function validateMotionEvidenceCandidate(candidate) {
  await requireEvidenceRoot(candidate);
  const results = await readJsonFile(candidate, "browser-results.json");
  const errors = assessMotionEvidenceShape(results);
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  const readme = await readFile(
    await requireEvidenceFile(candidate, "README.md"),
    "utf8",
  );
  if (
    !readme.includes("P2-05 signature motion browser verification") ||
    !readme.includes(rerunCommand) ||
    !/Physical device evidence: false/iu.test(readme)
  ) {
    throw new Error(
      "P2-05 README must identify the gate, rerun and device limit",
    );
  }
  for (const [relativePath, expected] of [
    ["raw/scenario-results.json", results.scenarioResults],
    ["raw/motion-checks.json", results.motionChecks],
    ["raw/reduced-motion.json", results.reducedMotion],
  ]) {
    const actual = await readJsonFile(candidate, relativePath);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`P2-05 raw artifact mismatch: ${relativePath}`);
    }
  }

  const manifest = new Map();
  const manifestPath = await requireEvidenceFile(
    candidate,
    "screenshots.sha256",
  );
  for (const line of (await readFile(manifestPath, "utf8"))
    .split("\n")
    .filter(Boolean)) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    if (
      match === null ||
      !isSafeRelativeArtifactPath(match[2], ".png") ||
      manifest.has(match[2])
    ) {
      throw new Error("P2-05 screenshot manifest contains an invalid entry");
    }
    manifest.set(match[2], match[1]);
  }
  const expectedScreenshots = createMotionScreenshotPaths();
  const declared = new Map();
  if (!Array.isArray(results.screenshots)) {
    throw new Error("P2-05 screenshot evidence must be an array");
  }
  for (const screenshot of results.screenshots) {
    if (
      !isSafeRelativeArtifactPath(screenshot?.path, ".png") ||
      !/^[a-f0-9]{64}$/u.test(screenshot?.sha256 ?? "") ||
      !Number.isInteger(screenshot?.pixelWidth) ||
      !Number.isInteger(screenshot?.pixelHeight) ||
      declared.has(screenshot.path)
    ) {
      throw new Error("P2-05 browser results contain an invalid screenshot");
    }
    declared.set(screenshot.path, screenshot.sha256);
    const screenshotPath = await requireEvidenceFile(
      candidate,
      screenshot.path,
    );
    const screenshotBuffer = await readFile(screenshotPath);
    const actualHash = sha256(screenshotBuffer);
    if (
      actualHash !== screenshot.sha256 ||
      manifest.get(screenshot.path) !== screenshot.sha256
    ) {
      throw new Error(`P2-05 screenshot hash mismatch for ${screenshot.path}`);
    }
    try {
      const dimensions = readDecodedPngDimensions(screenshotBuffer);
      if (
        dimensions.width !== screenshot.pixelWidth ||
        dimensions.height !== screenshot.pixelHeight ||
        !screenshotDimensionsMatch(screenshot.path, dimensions)
      ) {
        throw new Error(
          "PNG pixel dimensions must match metadata and the declared viewport",
        );
      }
    } catch (error) {
      throw new Error(
        `P2-05 screenshot must be a valid PNG with matching pixel dimensions: ${screenshot.path}`,
        {
          cause: error,
        },
      );
    }
  }
  if (
    declared.size !== expectedScreenshots.length ||
    manifest.size !== expectedScreenshots.length ||
    expectedScreenshots.some(
      (screenshot) => !declared.has(screenshot) || !manifest.has(screenshot),
    )
  ) {
    throw new Error(
      "P2-05 screenshot set must exactly match the required evidence",
    );
  }

  for (const summary of results.axeSummaries) {
    const artifact = await readJsonFile(candidate, summary.artifact);
    if (
      artifact?.schemaVersion !== 1 ||
      artifact?.scan?.id !== summary.id ||
      artifact?.scan?.scenarioId !== summary.scenarioId
    ) {
      throw new Error(`P2-05 axe metadata mismatch: ${summary.artifact}`);
    }
    const actual = summarizeAxeResult(artifact.result);
    const ruleInventory = axeRuleInventory(artifact.result);
    if (
      actual.blocking.length > 0 ||
      JSON.stringify(actual) !==
        JSON.stringify({
          blocking: summary.blocking,
          counts: summary.counts,
        }) ||
      JSON.stringify(ruleInventory) !== JSON.stringify(summary.ruleInventory)
    ) {
      throw new Error(`P2-05 axe summary mismatch: ${summary.artifact}`);
    }
  }
  return results;
}

export async function replaceMotionEvidenceDirectory(candidate, target) {
  if (path.dirname(candidate) !== path.dirname(target)) {
    throw new Error("P2-05 candidate and target directories must be siblings");
  }
  const details = await lstat(candidate);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("P2-05 candidate evidence must be a directory");
  }
  await recoverMotionEvidenceSwap(target);
  await validateMotionEvidenceCandidate(candidate);
  if (!(await pathExists(target))) {
    await rename(candidate, target);
    return;
  }
  const targetDetails = await lstat(target);
  if (!targetDetails.isDirectory() || targetDetails.isSymbolicLink()) {
    throw new Error("P2-05 target evidence must be a real directory");
  }
  const backup = motionEvidenceBackupPath(target);
  await rename(target, backup);
  try {
    await rename(candidate, target);
  } catch (error) {
    await recoverMotionEvidenceSwap(target);
    throw error;
  }
  await rm(backup, { force: true, recursive: true });
}

async function captureCommand(command, arguments_, cwd) {
  const child = spawn(...spawnArguments(command, arguments_), {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) {
    throw new Error(output.join(""));
  }
  return output.join("").trimEnd();
}

async function runCommand(
  command,
  arguments_,
  { cwd, env = process.env, logPath, registry },
) {
  const processGroup = process.platform !== "win32";
  const child = spawn(...spawnArguments(command, arguments_), {
    cwd,
    detached: processGroup,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const untrack =
    registry?.trackChild(child, { processGroup }) ?? (() => undefined);
  const output = [];
  const capture = (chunk) => {
    const text = chunk.toString();
    output.push(text);
    process.stdout.write(text);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } finally {
    untrack();
  }
  const combined = output.join("");
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, combined, "utf8");
  if (result.code !== 0) {
    throw new Error(
      `command failed: ${[command, ...arguments_].join(" ")}\nexit=${String(result.code)} signal=${String(result.signal)}\n${combined.slice(-4_000)}`,
    );
  }
}

export function normalizeMotionWorkspaceStatus(lines) {
  return lines.filter(
    (line) =>
      !/^.. output\/playwright\/(?:\.p2-05-(?:backup|candidate-[^/]+|run\.lock(?:\.(?:init|release|stale)-[^/]+)?)|p2-05)\//u.test(
        line,
      ),
  );
}

export async function collectMotionSourceFingerprint(workspaceRoot) {
  const listed = await captureCommand(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...sourceFingerprintPathspec,
    ],
    workspaceRoot,
  );
  const paths = listed.split("\0").filter(Boolean).sort();
  invariant(paths.length > 0, "motion source fingerprint scope is empty");
  const files = await Promise.all(
    paths.map(async (relativePath) => {
      const normalized = path.posix.normalize(relativePath);
      const absolute = path.resolve(workspaceRoot, relativePath);
      invariant(
        normalized === relativePath &&
          !path.isAbsolute(relativePath) &&
          !relativePath.startsWith("../") &&
          absolute.startsWith(workspaceRoot + path.sep),
        "motion source fingerprint escaped the workspace",
      );
      const details = await lstat(absolute);
      invariant(
        details.isFile() && !details.isSymbolicLink(),
        "motion fingerprint accepts regular files only",
      );
      return { path: relativePath, sha256: sha256(await readFile(absolute)) };
    }),
  );
  return {
    algorithm: sourceFingerprintAlgorithm,
    digest: sha256(
      JSON.stringify({ algorithm: sourceFingerprintAlgorithm, files }),
    ),
    files,
  };
}

async function collectGit(workspaceRoot) {
  const [sha, fingerprint, status] = await Promise.all([
    captureCommand("git", ["rev-parse", "HEAD"], workspaceRoot),
    collectMotionSourceFingerprint(workspaceRoot),
    captureCommand(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      workspaceRoot,
    ),
  ]);
  return {
    sha,
    sourceFingerprint: fingerprint.digest,
    sourceFingerprintAlgorithm: fingerprint.algorithm,
    sourceFingerprintFiles: fingerprint.files,
    status: normalizeMotionWorkspaceStatus(
      status === "" ? [] : status.split("\n"),
    ),
  };
}

async function readPackageJson(absolutePath) {
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

async function collectVersions(workspaceRoot) {
  const [root, storefront, playwright, axe, next, react, postcssPackage, pnpm] =
    await Promise.all([
      readPackageJson(path.join(workspaceRoot, "package.json")),
      readPackageJson(path.join(workspaceRoot, "apps/storefront/package.json")),
      readPackageJson(
        path.join(workspaceRoot, "node_modules/@playwright/test/package.json"),
      ),
      readPackageJson(
        path.join(
          workspaceRoot,
          "node_modules/@axe-core/playwright/package.json",
        ),
      ),
      readPackageJson(
        path.join(
          workspaceRoot,
          "apps/storefront/node_modules/next/package.json",
        ),
      ),
      readPackageJson(
        path.join(
          workspaceRoot,
          "apps/storefront/node_modules/react/package.json",
        ),
      ),
      readPackageJson(
        path.join(workspaceRoot, "node_modules/postcss/package.json"),
      ),
      captureCommand("corepack", ["pnpm", "--version"], workspaceRoot),
    ]);
  const expectedNode = (
    await readFile(path.join(workspaceRoot, ".node-version"), "utf8")
  ).trim();
  invariant(
    process.versions.node === expectedNode,
    `runner requires Node ${expectedNode}`,
  );
  invariant(
    pnpm === String(root.packageManager).replace(/^pnpm@/u, ""),
    "installed pnpm version must match packageManager",
  );
  invariant(
    playwright.version === root.devDependencies["@playwright/test"] &&
      axe.version === root.devDependencies["@axe-core/playwright"] &&
      next.version === storefront.dependencies.next &&
      react.version === storefront.dependencies.react &&
      postcssPackage.version === root.devDependencies.postcss,
    "browser toolchain versions must match exact manifests",
  );
  return {
    axe: axe.version,
    browser: "pending",
    next: next.version,
    node: process.version,
    playwright: playwright.version,
    pnpm,
    postcss: postcssPackage.version,
    react: react.version,
  };
}

async function listCssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listCssFiles(target);
      }
      return entry.isFile() && entry.name.endsWith(".css") ? [target] : [];
    }),
  );
  return nested.flat().sort();
}

function decodeCssIdentifier(
  source,
  { offset = 0, returnCursor = false, stopAtRuleBoundary = false } = {},
) {
  let decoded = "";
  let cursor = offset;
  while (cursor < source.length) {
    const character = source[cursor];
    if (stopAtRuleBoundary && source.startsWith("/*", cursor)) {
      break;
    }
    if (
      stopAtRuleBoundary &&
      (/\s/u.test(character) || character === "{" || character === ";")
    ) {
      break;
    }
    if (/\s/u.test(character)) {
      return undefined;
    }
    if (
      stopAtRuleBoundary &&
      character.codePointAt(0) <= 0x7f &&
      !/[a-z0-9_-]/iu.test(character) &&
      character !== "\\"
    ) {
      break;
    }
    if (character !== "\\") {
      decoded += character;
      cursor += 1;
      continue;
    }

    cursor += 1;
    const escaped = source[cursor];
    if (escaped === undefined || escaped === "\n" || escaped === "\r") {
      return undefined;
    }
    if (/[\da-f]/iu.test(escaped)) {
      let hex = "";
      while (
        cursor < source.length &&
        hex.length < 6 &&
        /[\da-f]/iu.test(source[cursor])
      ) {
        hex += source[cursor];
        cursor += 1;
      }
      const codePoint = Number.parseInt(hex, 16);
      decoded +=
        codePoint === 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
          ? "\uFFFD"
          : String.fromCodePoint(codePoint);
      if (/\s/u.test(source[cursor] ?? "")) {
        if (source[cursor] === "\r" && source[cursor + 1] === "\n") {
          cursor += 1;
        }
        cursor += 1;
      }
      continue;
    }
    decoded += escaped;
    cursor += 1;
  }
  const value = decoded.toLowerCase();
  return returnCursor ? { cursor, value } : value;
}

function inspectAtRuleHeader(atRule) {
  const literalName = atRule.name.trim().toLowerCase();
  if (literalName === "font-face" || literalName === "import") {
    return {
      hasPrelude: atRule.params.trim().length > 0,
      name: literalName,
    };
  }
  const source = atRule.toString().trimStart();
  if (!source.startsWith("@")) {
    return undefined;
  }
  const identifier = decodeCssIdentifier(source, {
    offset: 1,
    returnCursor: true,
    stopAtRuleBoundary: true,
  });
  if (identifier === undefined || typeof identifier === "string") {
    return undefined;
  }
  let cursor = identifier.cursor;
  while (cursor < source.length) {
    if (/\s/u.test(source[cursor] ?? "")) {
      cursor += 1;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      const commentEnd = source.indexOf("*/", cursor + 2);
      if (commentEnd === -1) {
        return undefined;
      }
      cursor = commentEnd + 2;
      continue;
    }
    break;
  }
  const boundary = source[cursor];
  return {
    hasPrelude: boundary !== undefined && boundary !== "{" && boundary !== ";",
    name: identifier.value,
  };
}

export async function validateBuiltFontPolicy(storefrontRoot) {
  const staticRoot = path.join(storefrontRoot, ".next/static");
  const cssFiles = await listCssFiles(staticRoot);
  invariant(cssFiles.length > 0, "production build contains no CSS chunks");

  let fontFaces = 0;
  const verifiedFamilies = new Set();
  for (const cssFile of cssFiles) {
    const source = await readFile(cssFile, "utf8");
    let stylesheet;
    try {
      stylesheet = postcss.parse(source, { from: cssFile });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${path.relative(storefrontRoot, cssFile)} must be valid production CSS: ${detail}`,
        { cause: error },
      );
    }
    stylesheet.walkAtRules((fontFace) => {
      const header = inspectAtRuleHeader(fontFace);
      invariant(
        header?.name !== "import",
        `${path.relative(storefrontRoot, cssFile)} production CSS must not contain @import`,
      );
      if (header?.name !== "font-face") {
        return;
      }
      invariant(
        !header.hasPrelude,
        `${path.relative(storefrontRoot, cssFile)} @font-face must not contain a prelude`,
      );
      fontFaces += 1;
      const displays = [];
      const families = [];
      for (const node of fontFace.nodes ?? []) {
        if (node.type !== "decl") {
          continue;
        }
        const property = decodeCssIdentifier(node.prop.trim());
        if (property === "font-display") {
          invariant(
            !node.important,
            `${path.relative(storefrontRoot, cssFile)} @font-face font-display must not use !important`,
          );
          displays.push(node.value.trim().toLowerCase());
        } else if (property === "font-family") {
          invariant(
            !node.important,
            `${path.relative(storefrontRoot, cssFile)} @font-face font-family must not use !important`,
          );
          families.push(
            node.value
              .trim()
              .replace(/^(['"])(.*)\1$/u, "$2")
              .trim(),
          );
        }
      }
      invariant(
        displays.length === 1 && displays[0] === "optional",
        `${path.relative(storefrontRoot, cssFile)} @font-face must use exactly one font-display: optional descriptor`,
      );
      invariant(
        families.length === 1,
        `${path.relative(storefrontRoot, cssFile)} @font-face must use exactly one font-family descriptor`,
      );
      if (expectedFontFamilies.includes(families[0])) {
        verifiedFamilies.add(families[0]);
      }
    });
  }

  invariant(fontFaces > 0, "production build contains no font faces");
  for (const family of expectedFontFamilies) {
    invariant(
      verifiedFamilies.has(family),
      `production build is missing the ${family} font profile`,
    );
  }

  return {
    cssFiles: cssFiles.length,
    fontFaces,
    strategy: "optional",
    verifiedFamilies: [...verifiedFamilies].sort(),
  };
}

async function prepareProductionBuild(workspaceRoot, candidate, registry) {
  const logs = path.join(candidate, "logs");
  await runCommand(
    "corepack",
    ["pnpm", "--filter", "@fan-support/ui", "build"],
    {
      cwd: workspaceRoot,
      logPath: path.join(logs, "build-ui.log"),
      registry,
    },
  );
  await runCommand(
    "corepack",
    ["pnpm", "--filter", "@fan-support/storefront", "build"],
    {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        FAN_SUPPORT_DEPLOYMENT_ENV: "preview",
        FAN_SUPPORT_SITE_ORIGIN: "https://localhost:3443",
        NODE_ENV: "production",
      },
      logPath: path.join(logs, "build-storefront.log"),
      registry,
    },
  );
  const storefrontRoot = path.join(workspaceRoot, "apps/storefront");
  const fontLoadingPolicy = await validateBuiltFontPolicy(storefrontRoot);
  const standalone = path.join(
    storefrontRoot,
    ".next/standalone/apps/storefront",
  );
  invariant(
    await pathExists(path.join(standalone, "server.js")),
    "Next standalone server is missing",
  );
  const staticTarget = path.join(standalone, ".next/static");
  await rm(staticTarget, { force: true, recursive: true });
  await mkdir(path.dirname(staticTarget), { recursive: true });
  await cp(path.join(storefrontRoot, ".next/static"), staticTarget, {
    recursive: true,
  });
  const publicTarget = path.join(standalone, "public");
  await rm(publicTarget, { force: true, recursive: true });
  await cp(path.join(storefrontRoot, "public"), publicTarget, {
    recursive: true,
  });
  return { fontLoadingPolicy, standalone };
}

async function reservePort() {
  const server = createServer();
  server.unref();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  invariant(
    address !== null && typeof address === "object",
    "cannot reserve port",
  );
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

function runtimeSiteOrigin(environment) {
  return environment === "preview"
    ? "https://localhost:3443"
    : "https://shop.example.invalid";
}

async function fetchStatus(url) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const status = response.status;
  await response.body?.cancel();
  return status;
}

async function startServer({ candidate, environment, registry, standalone }) {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const chunks = [];
  const processGroup = process.platform !== "win32";
  const child = spawn(process.execPath, ["server.js"], {
    cwd: standalone,
    detached: processGroup,
    env: {
      ...process.env,
      FAN_SUPPORT_DEPLOYMENT_ENV: environment,
      FAN_SUPPORT_SITE_ORIGIN: runtimeSiteOrigin(environment),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const untrack =
    registry?.trackChild(child, { processGroup }) ?? (() => undefined);
  const capture = (chunk) => {
    const value = chunk.toString();
    chunks.push(value);
    process.stdout.write(value);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  completion.catch(() => undefined);
  const server = {
    candidate,
    child,
    chunks,
    completion,
    environment,
    origin,
    processGroup,
    untrack,
  };
  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30_000) {
      if (child.exitCode !== null) {
        throw new Error(`${environment} server exited before readiness`);
      }
      try {
        if ((await fetchStatus(`${origin}/healthz`)) === 200) {
          return server;
        }
      } catch {
        // The standalone server has not bound the reserved port yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${environment} server did not become ready`);
  } catch (error) {
    await stopServer(server);
    throw error;
  }
}

async function stopServer(server) {
  if (server === undefined) {
    return;
  }
  try {
    await terminateTrackedChild(
      { child: server.child, processGroup: server.processGroup },
      { graceTimeoutMs: 5_000, killTimeoutMs: 2_000 },
    );
  } finally {
    server.untrack();
  }
  const logPath = path.join(
    server.candidate,
    "logs",
    `server-${server.environment}.log`,
  );
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, server.chunks.join(""), "utf8");
}

function fixturePath(locale) {
  return `/_internal/design-foundations/${encodeURIComponent(locale)}${routeSuffix}`;
}

async function probeRuntime(server) {
  const [healthStatus, ...localeStatuses] = await Promise.all([
    fetchStatus(`${server.origin}/healthz`),
    ...previewLocales.map((locale) =>
      fetchStatus(server.origin + fixturePath(locale)),
    ),
  ]);
  return {
    environment: server.environment,
    healthStatus,
    localeStatuses,
    origin: server.origin,
  };
}

async function settleImages(page) {
  await page.evaluate(async () => {
    const images = [...document.images];
    await Promise.all(
      images.map(async (image) => {
        image.loading = "eager";
        if (!image.complete) {
          await new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          });
        }
        try {
          await image.decode();
        } catch {
          // Runtime image errors are represented by the component fallback.
        }
      }),
    );
  });
}

async function settleMotionPage(page, locale, phaseTimes) {
  const url = fixturePath(locale);
  const response = await page.goto(url, { waitUntil: "load" });
  if (phaseTimes) {
    phaseTimes.navigationLoadedAt = await page.evaluate(() =>
      performance.now(),
    );
  }
  invariant(response?.status() === 200, `${url} must return 200`);
  const root = page.locator('main[data-ui-motion="v1"]');
  await root.waitFor({ state: "visible" });
  invariant(
    (await root.getAttribute("lang")) === locale,
    "motion fixture lang mismatch",
  );
  invariant(
    (await page.locator('meta[name="robots"]').getAttribute("content"))
      ?.toLowerCase()
      .includes("noindex") === true,
    "motion fixture must remain noindex",
  );
  await page.evaluate(async () => document.fonts.ready);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
  await settleImages(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(850);
  if (phaseTimes) {
    phaseTimes.settleCompletedAt = await page.evaluate(() => performance.now());
  }
  return url;
}

async function collectRuntimeFontEvidence(page) {
  return page.evaluate(() => {
    const normalizeFamily = (value) =>
      String(value)
        .trim()
        .replace(/^(['"])(.*)\1$/u, "$2")
        .trim();
    const uniqueSorted = (values) => [...new Set(values)].sort();
    const faces = [...document.fonts];
    const styleSheets = new Set([
      ...document.styleSheets,
      ...(document.adoptedStyleSheets ?? []),
    ]);
    const pendingRoots = [document];
    while (pendingRoots.length > 0) {
      const root = pendingRoots.pop();
      for (const element of root?.querySelectorAll?.("*") ?? []) {
        const shadowRoot = element.shadowRoot;
        if (shadowRoot === null) {
          continue;
        }
        pendingRoots.push(shadowRoot);
        for (const sheet of shadowRoot.adoptedStyleSheets ?? []) {
          styleSheets.add(sheet);
        }
        for (const owner of shadowRoot.querySelectorAll(
          'style, link[rel="stylesheet"]',
        )) {
          if (owner.sheet !== null) {
            styleSheets.add(owner.sheet);
          }
        }
      }
    }

    const cssomDisplays = [];
    const cssomFamilies = [];
    const unreadableStyleSheets = [];
    const visitedStyleSheets = new Set();
    let fontFaces = 0;
    let importantDescriptors = 0;
    let imports = 0;
    const visitRules = (rules, label) => {
      for (const rule of rules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          fontFaces += 1;
          const display = rule.style
            .getPropertyValue("font-display")
            .trim()
            .toLowerCase();
          const family = normalizeFamily(
            rule.style.getPropertyValue("font-family"),
          );
          cssomDisplays.push(display);
          cssomFamilies.push(family);
          if (
            rule.style.getPropertyPriority("font-display") !== "" ||
            rule.style.getPropertyPriority("font-family") !== ""
          ) {
            importantDescriptors += 1;
          }
          continue;
        }
        if (rule.type === CSSRule.IMPORT_RULE) {
          imports += 1;
          if (rule.styleSheet === null) {
            unreadableStyleSheets.push(`${label} -> unresolved @import`);
          } else {
            visitStyleSheet(rule.styleSheet);
          }
          continue;
        }
        if (!("cssRules" in rule)) {
          continue;
        }
        try {
          visitRules(rule.cssRules, `${label} -> grouped rule`);
        } catch {
          unreadableStyleSheets.push(`${label} -> unreadable grouped rule`);
        }
      }
    };
    const visitStyleSheet = (sheet) => {
      if (visitedStyleSheets.has(sheet)) {
        return;
      }
      visitedStyleSheets.add(sheet);
      const label = sheet.href ?? "inline/adopted stylesheet";
      try {
        visitRules(sheet.cssRules, label);
      } catch {
        unreadableStyleSheets.push(label);
      }
    };
    for (const sheet of styleSheets) {
      visitStyleSheet(sheet);
    }

    const specimen = document.querySelector('main[data-ui-motion="v1"]');
    const fontFamily =
      specimen === null ? "" : getComputedStyle(specimen).fontFamily;
    const primaryFamily = normalizeFamily(fontFamily.split(",", 1)[0] ?? "");
    return {
      computed: { fontFamily, primaryFamily },
      cssom: {
        displays: uniqueSorted(cssomDisplays),
        families: uniqueSorted(cssomFamilies),
        fontFaces,
        importantDescriptors,
        imports,
        styleSheets: visitedStyleSheets.size,
        unreadableStyleSheets: uniqueSorted(unreadableStyleSheets),
      },
      fontFaceSet: {
        displays: uniqueSorted(
          faces.map((face) => String(face.display).trim().toLowerCase()),
        ),
        faceCount: faces.length,
        families: uniqueSorted(
          faces.map((face) => normalizeFamily(face.family)),
        ),
        statuses: uniqueSorted(faces.map((face) => String(face.status))),
      },
      source: "document.fonts + CSSOM + computedStyle",
    };
  });
}

async function installPerformanceObservers(context) {
  await context.addInitScript(() => {
    window.__p205MotionMetrics = {
      cls: 0,
      eventDurations: [],
      lcpMs: 0,
      longTasks: [],
      observers: Object.fromEntries(
        [
          ["event", "event"],
          ["layoutShift", "layout-shift"],
          ["longTask", "longtask"],
          ["lcp", "largest-contentful-paint"],
        ].map(([key, type]) => [
          key,
          {
            installed: false,
            supported:
              PerformanceObserver.supportedEntryTypes?.includes(type) === true,
          },
        ]),
      ),
      rawLayoutShift: 0,
    };
    try {
      const layoutObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const value = Number(entry.value ?? 0);
          window.__p205MotionMetrics.rawLayoutShift += value;
          if (entry.hadRecentInput !== true) {
            window.__p205MotionMetrics.cls += value;
          }
        }
      });
      layoutObserver.observe({ type: "layout-shift", buffered: true });
      window.__p205MotionMetrics.observers.layoutShift.installed = true;
    } catch {
      // The validator fails closed if layout-shift evidence is unavailable.
    }
    try {
      const taskObserver = new PerformanceObserver((list) => {
        window.__p205MotionMetrics.longTasks.push(
          ...list.getEntries().map((entry) => ({
            duration: entry.duration,
            startTime: entry.startTime,
          })),
        );
      });
      taskObserver.observe({ type: "longtask", buffered: true });
      window.__p205MotionMetrics.observers.longTask.installed = true;
    } catch {
      // The validator fails closed if long-task evidence is unavailable.
    }
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__p205MotionMetrics.lcpMs = Math.max(
            window.__p205MotionMetrics.lcpMs,
            entry.startTime,
          );
        }
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
      window.__p205MotionMetrics.observers.lcp.installed = true;
    } catch {
      // The validator requires a positive LCP value.
    }
    try {
      const eventObserver = new PerformanceObserver((list) => {
        window.__p205MotionMetrics.eventDurations.push(
          ...list.getEntries().map((entry) => entry.duration),
        );
      });
      eventObserver.observe({
        type: "event",
        buffered: true,
        durationThreshold: 0,
      });
      window.__p205MotionMetrics.observers.event.installed = true;
    } catch {
      // A trusted-click fallback covers empty samples, not observer setup.
    }
  });
}

async function beginPerformanceWindow(page, phaseTimes) {
  invariant(
    await page.evaluate(() => window.__p205MotionMetrics !== undefined),
    "performance observers must initialize before navigation",
  );
  const startedAt = await page.evaluate(() => performance.now());
  await page.getByTestId("replay-hero").click();
  const endedAt = await page.evaluate(() => performance.now());
  if (phaseTimes) {
    phaseTimes.trustedClickStartedAt = startedAt;
    phaseTimes.trustedClickEndedAt = endedAt;
  }
  await page.waitForTimeout(100);
  return {
    durationMs: endedAt - startedAt,
    method: "performance.now around trusted Playwright click",
  };
}

async function collectPerformance(
  page,
  expectedWidth,
  interactionFallback,
  phaseTimes,
) {
  if (phaseTimes) {
    phaseTimes.collectStartedAt = await page.evaluate(() => performance.now());
  }
  const metrics = await page.evaluate(async (fallback) => {
    const deltas = [];
    let previous;
    await new Promise((resolve) => {
      const tick = (timestamp) => {
        if (previous !== undefined) {
          deltas.push(timestamp - previous);
        }
        previous = timestamp;
        if (deltas.length >= 30) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
    const sorted = [...deltas].sort((left, right) => left - right);
    const p95 =
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const clippedText = [];
    const textElements = document.querySelectorAll(
      'main[data-ui-motion="v1"] h1, main[data-ui-motion="v1"] h2, main[data-ui-motion="v1"] h3, main[data-ui-motion="v1"] p, main[data-ui-motion="v1"] button, main[data-ui-motion="v1"] label, main[data-ui-motion="v1"] output',
    );
    for (const [index, element] of [...textElements].entries()) {
      if (
        !(element instanceof HTMLElement) ||
        element.closest(".fs-live-region")
      ) {
        continue;
      }
      const style = getComputedStyle(element);
      if (
        style.visibility === "hidden" ||
        style.display === "none" ||
        element.getClientRects().length === 0
      ) {
        continue;
      }
      const horizontal =
        style.overflowX !== "visible" &&
        element.scrollWidth > element.clientWidth + 1;
      const vertical =
        style.overflowY !== "visible" &&
        element.scrollHeight > element.clientHeight + 1;
      if (horizontal || vertical) {
        clippedText.push(
          `${element.tagName.toLowerCase()}-${String(index)}-${horizontal ? "x" : "y"}`,
        );
      }
    }
    const controls = [
      ...document.querySelectorAll(".fs-motion-idol__option, button"),
    ]
      .filter(
        (element) =>
          element instanceof HTMLElement && element.getClientRects().length > 0,
      )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          label:
            element.textContent?.trim().replace(/\s+/gu, " ").slice(0, 120) ??
            "",
          width: rect.width,
        };
      });
    const eventDurations = window.__p205MotionMetrics.eventDurations;
    return {
      clippedText,
      cls: window.__p205MotionMetrics.cls,
      controls,
      document: {
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      },
      fontsStatus: document.fonts.status,
      interactionLatency: {
        ...(eventDurations.length === 0 ? { fallback } : {}),
        maxMs:
          eventDurations.length === 0
            ? fallback.durationMs
            : Math.max(...eventDurations),
        sampleCount: eventDurations.length,
        source:
          eventDurations.length === 0
            ? "reproducible trusted-click fallback (desktop Chrome; not field INP)"
            : "PerformanceEventTiming duration proxy (desktop Chrome; not field INP)",
      },
      jsTransferBytes: performance
        .getEntriesByType("resource")
        .filter((entry) => entry.initiatorType === "script")
        .reduce((total, entry) => total + Number(entry.transferSize ?? 0), 0),
      lcpMs: window.__p205MotionMetrics.lcpMs,
      longTasks: window.__p205MotionMetrics.longTasks,
      navigation: {
        loadEventEnd:
          performance.getEntriesByType("navigation")[0]?.loadEventEnd ?? null,
      },
      observers: window.__p205MotionMetrics.observers,
      raf: {
        maxFrameDeltaMs: Math.max(...deltas),
        p95FrameDeltaMs: p95,
        sampleCount: deltas.length,
      },
      rawLayoutShift: window.__p205MotionMetrics.rawLayoutShift,
    };
  }, interactionFallback);
  if (phaseTimes) {
    phaseTimes.collectEndedAt = await page.evaluate(() => performance.now());
  }
  const errors = assessMotionPerformance(metrics, expectedWidth);
  if (errors.length > 0) {
    process.stderr.write(
      `P2-05 performance failure: ${JSON.stringify({
        expectedWidth,
        errors,
        lcpMs: metrics.lcpMs,
        cls: metrics.cls,
        longTasks: metrics.longTasks,
        navigation: metrics.navigation,
        raf: metrics.raf,
        interactionLatency: metrics.interactionLatency,
        phaseTimes,
      })}\n`,
    );
  }
  invariant(errors.length === 0, errors.join("; "));
  return metrics;
}

async function writeScreenshot(
  pageOrLocator,
  candidate,
  relativePath,
  options = {},
) {
  const target = path.join(candidate, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  const screenshotOptions = {
    animations: options.animations ?? "disabled",
    caret: "hide",
    path: target,
  };
  if (options.fullPage !== undefined) {
    screenshotOptions.fullPage = options.fullPage;
  }
  await pageOrLocator.screenshot(screenshotOptions);
  const buffer = await readFile(target);
  const dimensions = readDecodedPngDimensions(buffer);
  return {
    path: relativePath,
    pixelHeight: dimensions.height,
    pixelWidth: dimensions.width,
    sha256: sha256(buffer),
  };
}

async function writeAxeResult(candidate, scenarioId, scan, result) {
  const relativePath = `axe-results/${scan.id}.json`;
  const target = path.join(candidate, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify({ result, scan: { ...scan, scenarioId }, schemaVersion: 1 }, null, 2)}\n`,
    "utf8",
  );
  return relativePath;
}

async function runScenario({ AxeBuilder, browser, candidate, entry, origin }) {
  const context = await browser.newContext({
    baseURL: origin,
    colorScheme: "dark",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    viewport: entry.viewport,
  });
  await installPerformanceObservers(context);
  const page = await context.newPage();
  const diagnostics = await observePage(page, context, origin);
  try {
    const phaseTimes = {};
    const url = await settleMotionPage(page, entry.locale, phaseTimes);
    phaseTimes.fontAuditStartedAt = await page.evaluate(() =>
      performance.now(),
    );
    const runtimeFonts = await collectRuntimeFontEvidence(page);
    phaseTimes.fontAuditEndedAt = await page.evaluate(() => performance.now());
    const interactionFallback = await beginPerformanceWindow(page, phaseTimes);
    const performanceEvidence = await collectPerformance(
      page,
      entry.viewport.width,
      interactionFallback,
      phaseTimes,
    );
    const axeSummaries = [];
    for (const scan of entry.axe) {
      const axeResult = await new AxeBuilder({ page }).analyze();
      const summary = summarizeAxeResult(axeResult);
      const artifact = await writeAxeResult(
        candidate,
        entry.id,
        scan,
        axeResult,
      );
      const ruleInventory = axeRuleInventory(axeResult);
      axeSummaries.push({
        ...summary,
        artifact,
        id: scan.id,
        ruleInventory,
        scenarioId: entry.id,
      });
    }
    const screenshot = await writeScreenshot(
      page,
      candidate,
      entry.screenshot,
      {
        fullPage: entry.fullPage === true,
      },
    );
    const errors = [
      ...assessMotionPerformance(performanceEvidence, entry.viewport.width),
      ...assessRuntimeFontEvidence(runtimeFonts, entry.locale),
      ...diagnosticsErrors(diagnostics),
      ...axeSummaries.flatMap((summary) =>
        summary.blocking.map(
          (violation) =>
            `axe ${summary.id} ${String(violation.impact)} ${violation.id}`,
        ),
      ),
    ];
    return {
      axeSummaries,
      result: {
        axeSummaries,
        diagnostics,
        errors,
        fixtureUrl: url,
        group: entry.group,
        id: entry.id,
        locale: entry.locale,
        performance: performanceEvidence,
        runtimeFonts,
        screenshot: entry.screenshot,
        viewport: entry.viewport,
      },
      screenshot,
    };
  } finally {
    await context.close();
  }
}

async function runHeroFrames({ browser, candidate, origin, viewport }) {
  const context = await browser.newContext({
    baseURL: origin,
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    viewport,
  });
  const page = await context.newPage();
  const diagnostics = await observePage(page, context, origin);
  try {
    await settleMotionPage(page, "en");
    await page.getByTestId("replay-hero").click();
    await page.waitForFunction(() => {
      const hero = document.querySelector('[data-fs-motion="hero-entrance"]');
      return hero !== null && hero.getAnimations({ subtree: true }).length >= 2;
    });
    const hero = page.locator('[data-fs-motion="hero-entrance"]');
    const animationTiming = await readAnimationTiming(hero);
    const timing = await page.evaluate(() => {
      const hero = document.querySelector('[data-fs-motion="hero-entrance"]');
      if (!(hero instanceof HTMLElement)) {
        return null;
      }
      const animations = hero.getAnimations({ subtree: true });
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = 0;
      }
      const rect = hero.getBoundingClientRect();
      return {
        baseRect: {
          height: rect.height,
          left: rect.left,
          top: rect.top + window.scrollY,
          width: rect.width,
        },
      };
    });
    invariant(timing !== null, "hero animations must be measurable");
    invariant(
      animationTiming.maxActiveDurationMs >= 600 &&
        animationTiming.maxActiveDurationMs <= 900 &&
        animationTiming.maxEndTimeMs >= 600 &&
        animationTiming.maxEndTimeMs <= 900,
      "hero duration must be 600-900ms",
    );
    const prefix = `hero/${String(viewport.width)}x${String(viewport.height)}`;
    const screenshots = [];
    const frameStates = [];
    for (const [name, progress] of [
      ["start", 0],
      ["mid", 0.5],
      ["end", 1],
    ]) {
      const state = await page.evaluate(
        ({ endTimeMs, progress }) => {
          const hero = document.querySelector(
            '[data-fs-motion="hero-entrance"]',
          );
          if (!(hero instanceof HTMLElement)) {
            return null;
          }
          const animations = hero.getAnimations({ subtree: true });
          for (const animation of animations) {
            animation.pause();
            animation.currentTime = endTimeMs * progress;
          }
          const media = hero.querySelector(".fs-hero__media");
          const content = hero.querySelector(".fs-hero__content");
          const rect = hero.getBoundingClientRect();
          return {
            contentOpacity:
              content instanceof HTMLElement
                ? getComputedStyle(content).opacity
                : null,
            contentTransform:
              content instanceof HTMLElement
                ? getComputedStyle(content).transform
                : null,
            mediaOpacity:
              media instanceof HTMLElement
                ? getComputedStyle(media).opacity
                : null,
            mediaTransform:
              media instanceof HTMLElement
                ? getComputedStyle(media).transform
                : null,
            rect: {
              height: rect.height,
              left: rect.left,
              top: rect.top + window.scrollY,
              width: rect.width,
            },
          };
        },
        { endTimeMs: animationTiming.maxEndTimeMs, progress },
      );
      invariant(state !== null, `hero ${name} frame must be measurable`);
      frameStates.push({ name, ...state });
      screenshots.push(
        await writeScreenshot(
          page.locator('[data-fs-motion="hero-entrance"]'),
          candidate,
          `${prefix}-${name}.png`,
          { animations: "allow" },
        ),
      );
    }
    const layoutShift = frameStates.reduce((maximum, frame) => {
      const delta = Math.max(
        Math.abs(frame.rect.height - timing.baseRect.height),
        Math.abs(frame.rect.width - timing.baseRect.width),
        Math.abs(frame.rect.left - timing.baseRect.left),
        Math.abs(frame.rect.top - timing.baseRect.top),
      );
      return Math.max(maximum, delta);
    }, 0);
    const errors = diagnosticsErrors(diagnostics);
    invariant(errors.length === 0, errors.join("; "));
    return {
      evidence: {
        durationMs: animationTiming.maxActiveDurationMs,
        frameStates,
        frames: ["start", "mid", "end"],
        layoutShift,
        timing: animationTiming,
      },
      screenshots,
    };
  } finally {
    await context.close();
  }
}

async function readAnimationTiming(locator) {
  return locator.evaluate((element) => {
    const items = element
      .getAnimations({ subtree: true })
      .map((animation) => {
        const raw = animation.effect?.getTiming();
        if (raw === undefined) {
          return null;
        }
        const durationMs = Number(raw.duration);
        const delayMs = Number(raw.delay);
        const endDelayMs = Number(raw.endDelay);
        const iterations = Number(raw.iterations);
        if (
          !Number.isFinite(durationMs) ||
          !Number.isFinite(delayMs) ||
          !Number.isFinite(endDelayMs) ||
          !Number.isFinite(iterations)
        ) {
          return null;
        }
        const activeDurationMs = durationMs * iterations;
        return {
          activeDurationMs,
          delayMs,
          durationMs,
          endDelayMs,
          endTimeMs: Math.max(0, delayMs + activeDurationMs + endDelayMs),
          iterations,
          property:
            animation.transitionProperty ??
            animation.animationName ??
            animation.effect?.target?.className ??
            "unknown",
        };
      })
      .filter((item) => item !== null && item.activeDurationMs > 0);
    return {
      items,
      maxActiveDurationMs: items.reduce(
        (maximum, item) => Math.max(maximum, item.activeDurationMs),
        0,
      ),
      maxEndTimeMs: items.reduce(
        (maximum, item) => Math.max(maximum, item.endTimeMs),
        0,
      ),
    };
  });
}

async function captureOpacityTransition(
  locator,
  { activeSelector, outgoingSelector },
) {
  return locator.evaluate(
    (element, selectors) => {
      const animations = element.getAnimations({ subtree: true });
      const summarize = () => {
        const active = element.querySelector(selectors.activeSelector);
        const outgoing = element.querySelector(selectors.outgoingSelector);
        return {
          activeOpacity:
            active instanceof HTMLElement
              ? Number(getComputedStyle(active).opacity)
              : 0,
          outgoingOpacity:
            outgoing instanceof HTMLElement
              ? Number(getComputedStyle(outgoing).opacity)
              : 0,
        };
      };
      const endTime = (animation) => {
        const timing = animation.effect?.getTiming();
        if (timing === undefined) {
          return 0;
        }
        return Math.max(
          0,
          Number(timing.delay) +
            Number(timing.duration) * Number(timing.iterations) +
            Number(timing.endDelay),
        );
      };
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = 0;
      }
      const start = summarize();
      for (const animation of animations) {
        animation.currentTime = endTime(animation);
      }
      const end = summarize();
      for (const animation of animations) {
        animation.currentTime = 0;
        animation.play();
      }
      return { end, start };
    },
    { activeSelector, outgoingSelector },
  );
}

async function runRapidReverseProof(browser, origin) {
  const context = await browser.newContext({
    baseURL: origin,
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  let releaseImage = () => undefined;
  try {
    await settleMotionPage(page, "en");
    let resolveRelease;
    const imageRelease = new Promise((resolve) => {
      resolveRelease = resolve;
    });
    releaseImage = resolveRelease;
    let markImageRequested;
    const imageRequested = new Promise((resolve) => {
      markImageRequested = resolve;
    });
    await page.route(/fictional-performer-noa-aster\.webp/u, async (route) => {
      try {
        const response = await route.fetch();
        markImageRequested();
        await imageRelease;
        await route.fulfill({
          headers: { ...response.headers(), "cache-control": "no-store" },
          response,
        });
      } catch {
        // Returning to the already-presented idol intentionally cancels the
        // unpresented image request in this isolated adversarial context.
      }
    });
    const options = page.locator(".fs-motion-idol__option");
    await options.nth(1).scrollIntoViewIfNeeded();
    const [miraBox, noaBox] = await Promise.all([
      options.nth(0).boundingBox(),
      options.nth(1).boundingBox(),
    ]);
    invariant(
      miraBox !== null && noaBox !== null,
      "rapid reverse targets must be measurable",
    );
    await page.mouse.click(
      noaBox.x + noaBox.width / 2,
      noaBox.y + noaBox.height / 2,
    );
    await Promise.race([
      imageRequested,
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error("rapid reverse did not observe the delayed Noa image"),
            ),
          5_000,
        ),
      ),
    ]);
    await page.waitForFunction(
      () =>
        document
          .querySelector(".fs-motion-idol__panel")
          ?.getAttribute("data-motion-phase") === "prepare",
      undefined,
      { polling: 10 },
    );
    await page.mouse.click(
      miraBox.x + miraBox.width / 2,
      miraBox.y + miraBox.height / 2,
    );
    await page.waitForFunction(() => {
      const panel = document.querySelector(".fs-motion-idol__panel");
      return (
        panel?.getAttribute("aria-label") === "Mira Vale" &&
        panel.getAttribute("data-motion-phase") === "settled" &&
        panel.querySelectorAll(
          '.fs-motion-idol__media-layer[data-layer="outgoing"]',
        ).length === 0
      );
    });
    const evidence = await page.evaluate(() => {
      const panel = document.querySelector(".fs-motion-idol__panel");
      const layer = panel?.querySelector(
        '.fs-motion-idol__media-layer[data-layer="active"]',
      );
      const image = layer?.querySelector("img");
      const fallback = layer?.querySelector("[data-media-fallback]");
      const activeOpacity =
        layer instanceof HTMLElement
          ? Number(getComputedStyle(layer).opacity)
          : 0;
      const activeReady =
        (image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth > 0) ||
        (fallback instanceof HTMLElement &&
          fallback.getClientRects().length > 0);
      const activeVisible =
        layer instanceof HTMLElement &&
        layer.getClientRects().length > 0 &&
        getComputedStyle(layer).visibility !== "hidden" &&
        activeOpacity >= 0.99;
      const outgoingCount =
        panel?.querySelectorAll(
          '.fs-motion-idol__media-layer[data-layer="outgoing"]',
        ).length ?? -1;
      const selected = document
        .querySelector(".fs-motion-idol__radio:checked")
        ?.getAttribute("value");
      return {
        activeOpacity,
        activeReady,
        activeVisible,
        blankFrame: !(activeReady && activeVisible),
        cancelled:
          panel?.getAttribute("data-motion-phase") === "settled" &&
          outgoingCount === 0,
        outgoingCount,
        selected,
      };
    });
    releaseImage();
    return evidence;
  } finally {
    releaseImage();
    await context.close();
  }
}

async function runDecodeRejectionFallbackProof(browser, origin) {
  const context = await browser.newContext({
    baseURL: origin,
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  try {
    await settleMotionPage(page, "en");
    await page.evaluate(() => {
      window.__p205DecodeRejection = {
        decodeCalled: false,
        decodeRejected: false,
        fallbackAt: null,
        settledAt: null,
      };
      const originalDecode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function decode(...arguments_) {
        if (!this.currentSrc.includes("fictional-performer-noa-aster.webp")) {
          return originalDecode.apply(this, arguments_);
        }
        window.__p205DecodeRejection.decodeCalled = true;
        return new Promise((_, reject) => {
          window.__p205RejectNoaDecode = () => {
            window.__p205DecodeRejection.decodeRejected = true;
            reject(new Error("P2-05 synthetic Noa decode rejection"));
          };
        });
      };
      const panel = document.querySelector(".fs-motion-idol__panel");
      new MutationObserver(() => {
        const state = window.__p205DecodeRejection;
        if (
          state.fallbackAt === null &&
          panel?.querySelector(
            '.fs-motion-idol__media-layer[data-layer="active"] [data-media-fallback]',
          ) !== null
        ) {
          state.fallbackAt = performance.now();
        }
        if (
          state.settledAt === null &&
          panel?.getAttribute("data-motion-phase") === "settled"
        ) {
          state.settledAt = performance.now();
        }
      }).observe(panel, {
        attributeFilter: ["data-motion-phase"],
        attributes: true,
        childList: true,
        subtree: true,
      });
    });
    const noa = page.locator(".fs-motion-idol__option").nth(1);
    await noa.scrollIntoViewIfNeeded();
    const box = await noa.boundingBox();
    invariant(box !== null, "decode rejection idol target must be measurable");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction(
      () =>
        window.__p205DecodeRejection.decodeCalled === true &&
        document
          .querySelector(".fs-motion-idol__panel")
          ?.getAttribute("data-motion-phase") === "prepare",
    );
    const beforeReject = await page.evaluate(() => {
      const panel = document.querySelector(".fs-motion-idol__panel");
      const outgoing = panel?.querySelector(
        '.fs-motion-idol__media-layer[data-layer="outgoing"]',
      );
      return {
        outgoingOpacity:
          outgoing instanceof HTMLElement
            ? Number(getComputedStyle(outgoing).opacity)
            : 0,
        outgoingPresent: outgoing instanceof HTMLElement,
        prepare: panel?.getAttribute("data-motion-phase") === "prepare",
      };
    });
    await page.evaluate(() => window.__p205RejectNoaDecode());
    await page.waitForTimeout(80);
    const afterReject = await page.evaluate(() => {
      const panel = document.querySelector(".fs-motion-idol__panel");
      const outgoing = panel?.querySelector(
        '.fs-motion-idol__media-layer[data-layer="outgoing"]',
      );
      return {
        outgoingOpacity:
          outgoing instanceof HTMLElement
            ? Number(getComputedStyle(outgoing).opacity)
            : 0,
        outgoingPresent: outgoing instanceof HTMLElement,
        prepare: panel?.getAttribute("data-motion-phase") === "prepare",
      };
    });
    const activeImage = page.locator(
      '.fs-motion-idol__media-layer[data-layer="active"] img',
    );
    await activeImage.dispatchEvent("error");
    const fallback = page.locator(
      '.fs-motion-idol__media-layer[data-layer="active"] [data-media-fallback]',
    );
    await fallback.waitFor({ state: "visible" });
    await page.waitForFunction(() => {
      const panel = document.querySelector(".fs-motion-idol__panel");
      return (
        panel?.getAttribute("data-motion-phase") === "settled" &&
        panel.querySelectorAll(
          '.fs-motion-idol__media-layer[data-layer="outgoing"]',
        ).length === 0
      );
    });
    return page.evaluate(
      (proof) => {
        const panel = document.querySelector(".fs-motion-idol__panel");
        const active = panel?.querySelector(
          '.fs-motion-idol__media-layer[data-layer="active"]',
        );
        const fallback = active?.querySelector("[data-media-fallback]");
        const activeOpacity =
          active instanceof HTMLElement
            ? Number(getComputedStyle(active).opacity)
            : 0;
        const fallbackVisible =
          fallback instanceof HTMLElement &&
          fallback.getClientRects().length > 0 &&
          getComputedStyle(fallback).visibility !== "hidden";
        const outgoingCount =
          panel?.querySelectorAll(
            '.fs-motion-idol__media-layer[data-layer="outgoing"]',
          ).length ?? -1;
        const state = window.__p205DecodeRejection;
        const activeVisible =
          active instanceof HTMLElement &&
          active.getClientRects().length > 0 &&
          activeOpacity >= 0.99 &&
          fallbackVisible;
        return {
          activeVisible,
          blankFrame: !activeVisible,
          decodeRejected: state.decodeRejected,
          fallbackVisible,
          outgoingCount,
          outgoingRetainedBeforeError:
            proof.afterReject.outgoingPresent &&
            proof.afterReject.outgoingOpacity >= 0.99,
          prepareAfterReject: proof.afterReject.prepare,
          prepareBeforeReject:
            proof.beforeReject.prepare &&
            proof.beforeReject.outgoingPresent &&
            proof.beforeReject.outgoingOpacity >= 0.99,
          settledAfterFallback:
            state.fallbackAt !== null &&
            state.settledAt !== null &&
            state.settledAt >= state.fallbackAt,
        };
      },
      { afterReject, beforeReject },
    );
  } finally {
    await context.close();
  }
}

async function runMouseAndKeyboardMotion({ browser, candidate, origin }) {
  const rapidReverse = await runRapidReverseProof(browser, origin);
  const decodeRejectionFallback = await runDecodeRejectionFallbackProof(
    browser,
    origin,
  );
  const context = await browser.newContext({
    baseURL: origin,
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  const diagnostics = await observePage(page, context, origin);
  const screenshots = [];
  try {
    await settleMotionPage(page, "en");
    const options = page.locator(".fs-motion-idol__option");
    await options.nth(1).scrollIntoViewIfNeeded();
    let releaseImage;
    const imageRelease = new Promise((resolve) => {
      releaseImage = resolve;
    });
    let markImageRequested;
    const imageRequested = new Promise((resolve) => {
      markImageRequested = resolve;
    });
    await page.route(/fictional-performer-noa-aster\.webp/u, async (route) => {
      const response = await route.fetch();
      markImageRequested();
      await imageRelease;
      await route.fulfill({ response });
    });
    await page.evaluate(() => {
      window.__p205ImageReadiness = {
        decodeResolvedAt: null,
        settledAt: null,
      };
      const originalDecode = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = function decode(...arguments_) {
        const result = originalDecode.apply(this, arguments_);
        if (!this.currentSrc.includes("fictional-performer-noa-aster.webp")) {
          return result;
        }
        return result.then((value) => {
          if (window.__p205ImageReadiness.decodeResolvedAt === null) {
            window.__p205ImageReadiness.decodeResolvedAt = performance.now();
          }
          return value;
        });
      };
      const panel = document.querySelector(".fs-motion-idol__panel");
      new MutationObserver(() => {
        if (
          panel?.getAttribute("data-motion-phase") === "settled" &&
          window.__p205ImageReadiness.settledAt === null
        ) {
          window.__p205ImageReadiness.settledAt = performance.now();
        }
      }).observe(panel, {
        attributeFilter: ["data-motion-phase"],
        attributes: true,
      });
    });
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const targetBox = await options.nth(1).boundingBox();
    invariant(targetBox !== null, "mouse idol target must be measurable");
    await page.mouse.click(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
    );
    await Promise.race([
      imageRequested,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("active idol image request was not observed")),
          5_000,
        ),
      ),
    ]);
    const panel = page.locator(
      '.fs-motion-idol__panel[data-motion-mode="spatial"]',
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(".fs-motion-idol__panel")
          ?.getAttribute("data-motion-phase") === "prepare",
      undefined,
      { polling: 10 },
    );
    const firstFrameMeasurement = await panel.evaluate((element) => {
      const active = element.querySelector(
        '.fs-motion-idol__media-layer[data-layer="active"]',
      );
      const outgoing = element.querySelector(
        '.fs-motion-idol__media-layer[data-layer="outgoing"]',
      );
      const visual = element.querySelector(".fs-motion-idol__visual");
      if (
        !(active instanceof HTMLElement) ||
        !(outgoing instanceof HTMLElement) ||
        !(visual instanceof HTMLElement)
      ) {
        return null;
      }
      const activeRect = active.getBoundingClientRect();
      const outgoingRect = outgoing.getBoundingClientRect();
      const visualRect = visual.getBoundingClientRect();
      return {
        activeLayout: {
          height: active.offsetHeight,
          left: active.offsetLeft,
          top: active.offsetTop,
          width: active.offsetWidth,
        },
        activeOpacity: Number(getComputedStyle(active).opacity),
        activeRect: {
          height: activeRect.height,
          left: activeRect.left,
          top: activeRect.top,
          width: activeRect.width,
        },
        outgoingLayout: {
          height: outgoing.offsetHeight,
          left: outgoing.offsetLeft,
          top: outgoing.offsetTop,
          width: outgoing.offsetWidth,
        },
        outgoingOpacity: Number(getComputedStyle(outgoing).opacity),
        outgoingRect: {
          height: outgoingRect.height,
          left: outgoingRect.left,
          top: outgoingRect.top,
          width: outgoingRect.width,
        },
        visualRect: {
          height: visualRect.height,
          left: visualRect.left,
          top: visualRect.top,
          width: visualRect.width,
        },
      };
    });
    invariant(
      firstFrameMeasurement !== null,
      "idol switch prepare frame must be measurable",
    );
    const firstFrame = {
      ...firstFrameMeasurement,
      coverage: hasIdolFirstFrameCoverage(firstFrameMeasurement),
    };
    const mouseFocusPreserved = await page.evaluate(
      () =>
        document.activeElement?.matches(".fs-motion-idol__radio:checked") ===
        true,
    );
    const scrollAfter = await page.evaluate(() => window.scrollY);
    const blockedWhileLoading = await page.evaluate(() => {
      const panel = document.querySelector(".fs-motion-idol__panel");
      const image = panel?.querySelector(
        '.fs-motion-idol__media-layer[data-layer="active"] img',
      );
      return (
        panel?.getAttribute("data-motion-phase") === "prepare" &&
        image instanceof HTMLImageElement &&
        (!image.complete || image.naturalWidth === 0)
      );
    });
    releaseImage();
    await page.waitForFunction(() => {
      const image = document.querySelector(
        '.fs-motion-idol__media-layer[data-layer="active"] img',
      );
      return (
        image instanceof HTMLImageElement &&
        image.complete &&
        image.naturalWidth > 0
      );
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector(".fs-motion-idol__panel")
          ?.getAttribute("data-motion-phase") === "settled" &&
        document
          .querySelector(".fs-motion-idol__panel")
          ?.getAnimations({ subtree: true }).length > 0,
    );
    const mouseTiming = await readAnimationTiming(panel);
    const mouseVisualFrames = await captureOpacityTransition(panel, {
      activeSelector: '.fs-motion-idol__media-layer[data-layer="active"]',
      outgoingSelector: '.fs-motion-idol__media-layer[data-layer="outgoing"]',
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '.fs-motion-idol__media-layer[data-layer="outgoing"]',
        ).length === 0,
    );
    const activeImage = await page.evaluate((blocked) => {
      const layer = document.querySelector(
        '.fs-motion-idol__media-layer[data-layer="active"]',
      );
      const image = layer?.querySelector("img");
      const fallback = layer?.querySelector("[data-media-fallback]");
      const readiness = window.__p205ImageReadiness;
      return {
        blockedWhileLoading: blocked,
        complete:
          image instanceof HTMLImageElement
            ? image.complete
            : fallback !== null,
        decodeResolvedBeforeExit:
          readiness.decodeResolvedAt !== null &&
          readiness.settledAt !== null &&
          readiness.decodeResolvedAt <= readiness.settledAt,
        fallbackVisible:
          fallback instanceof HTMLElement &&
          fallback.getClientRects().length > 0 &&
          getComputedStyle(fallback).visibility !== "hidden",
        naturalWidth:
          image instanceof HTMLImageElement ? image.naturalWidth : 0,
      };
    }, blockedWhileLoading);
    screenshots.push(
      await writeScreenshot(
        page,
        candidate,
        "motion/idol-mouse-spatial-1440.png",
      ),
    );

    await page.reload({ waitUntil: "load" });
    await page
      .locator('main[data-ui-motion="v1"]')
      .waitFor({ state: "visible" });
    await page.evaluate(async () => document.fonts.ready);
    const radios = page.locator(".fs-motion-idol__radio");
    await radios.nth(0).focus();
    await radios.nth(0).press("ArrowRight");
    await page.waitForFunction(
      () =>
        document
          .querySelector(".fs-motion-idol__panel")
          ?.getAttribute("aria-label") === "Noa Aster",
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(".fs-motion-idol__panel")
          ?.getAttribute("data-motion-phase") === "settled" &&
        document.querySelectorAll(
          '.fs-motion-idol__media-layer[data-layer="outgoing"]',
        ).length === 0,
    );
    const keyboardMode = await page
      .locator(".fs-motion-idol__panel")
      .getAttribute("data-motion-mode");
    const keyboardFocusPreserved = await page.evaluate(
      () =>
        document.activeElement?.matches(".fs-motion-idol__radio:checked") ===
        true,
    );
    const keyboardStyle = await readMotionStyle(
      page,
      '.fs-motion-idol__media-layer[data-layer="active"]',
    );
    screenshots.push(
      await writeScreenshot(
        page,
        candidate,
        "motion/idol-keyboard-instant-1440.png",
      ),
    );

    await page.reload({ waitUntil: "load" });
    await page
      .locator('main[data-ui-motion="v1"]')
      .waitFor({ state: "visible" });
    const latestOptions = page.locator(".fs-motion-idol__option");
    for (let index = 0; index < 10; index += 1) {
      await latestOptions.nth(index % 2 === 0 ? 1 : 0).click();
    }
    await page.waitForFunction(() => {
      const panel = document.querySelector(".fs-motion-idol__panel");
      return (
        panel?.getAttribute("aria-label") === "Mira Vale" &&
        panel.getAttribute("data-motion-phase") === "settled" &&
        panel.querySelectorAll(
          '.fs-motion-idol__media-layer[data-layer="outgoing"]',
        ).length === 0 &&
        panel.getAnimations({ subtree: true }).length === 0
      );
    });
    const latestSelected = await page
      .locator(".fs-motion-idol__radio:checked")
      .getAttribute("value");
    const latestOutgoingCount = await page
      .locator('.fs-motion-idol__media-layer[data-layer="outgoing"]')
      .count();
    screenshots.push(
      await writeScreenshot(
        page,
        candidate,
        "motion/idol-latest-wins-1440.png",
      ),
    );

    await page.getByTestId("replay-success").scrollIntoViewIfNeeded();
    await page.getByTestId("replay-success").click();
    await page.waitForFunction(() => {
      const success = document.querySelector(
        '[data-fs-motion="success-reveal"]',
      );
      return (
        success !== null && success.getAnimations({ subtree: true }).length >= 2
      );
    });
    const successRoot = page.locator('[data-fs-motion="success-reveal"]');
    const successTiming = await readAnimationTiming(successRoot);
    const successVisualFrames = await successRoot.evaluate(
      (element, endTimeMs) => {
        const animations = element.getAnimations({ subtree: true });
        const snapshot = () => {
          const marker = element.querySelector(".fs-motion-success__marker");
          const body = element.querySelector(".fs-motion-success__body");
          return {
            bodyOpacity:
              body instanceof HTMLElement
                ? Number(getComputedStyle(body).opacity)
                : 0,
            markerOpacity:
              marker instanceof HTMLElement
                ? Number(getComputedStyle(marker).opacity)
                : 0,
            markerTransform:
              marker instanceof HTMLElement
                ? getComputedStyle(marker).transform
                : "unknown",
          };
        };
        for (const animation of animations) {
          animation.pause();
          animation.currentTime = 0;
        }
        const start = snapshot();
        for (const animation of animations) {
          animation.currentTime = endTimeMs;
        }
        const end = snapshot();
        for (const animation of animations) {
          animation.currentTime = 0;
          animation.play();
        }
        return { end, start };
      },
      successTiming.maxEndTimeMs,
    );
    await page.waitForTimeout(successTiming.maxEndTimeMs + 40);
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-fs-motion="success-reveal"]')
          ?.getAnimations({ subtree: true }).length === 0,
    );
    const successStatusClear =
      (await page
        .locator('[data-fs-motion="success-reveal"]')
        .getAttribute("data-order-status")) === "confirmed";
    const successRemainingAnimations = await page
      .locator('[data-fs-motion="success-reveal"]')
      .evaluate((element) => element.getAnimations({ subtree: true }).length);
    screenshots.push(
      await writeScreenshot(page, candidate, "motion/success-end-1440.png"),
    );
    const errors = diagnosticsErrors(diagnostics);
    invariant(errors.length === 0, errors.join("; "));
    return {
      idolSwitch: {
        keyboard: {
          ...keyboardStyle,
          durationMs: Math.max(
            keyboardStyle.animationMs,
            keyboardStyle.transitionMs,
          ),
          focusPreserved: keyboardFocusPreserved,
          mode: keyboardMode,
        },
        latestWins: {
          attempts: 10,
          cleared: latestOutgoingCount === 0,
          outgoingCount: latestOutgoingCount,
          selected: latestSelected,
        },
        rapidReverse,
        mouse: {
          durationMs: mouseTiming.maxActiveDurationMs,
          firstFrame,
          focusPreserved: mouseFocusPreserved,
          mode: "spatial",
          timing: mouseTiming,
          visualFrames: mouseVisualFrames,
        },
        scrollPreserved: Math.abs(scrollAfter - scrollBefore) <= 1,
        activeImage,
        decodeRejectionFallback,
      },
      screenshots,
      success: {
        durationMs: successTiming.maxActiveDurationMs,
        remainingAnimations: successRemainingAnimations,
        statusClear: successStatusClear,
        timing: successTiming,
        visualFrames: successVisualFrames,
      },
    };
  } finally {
    await context.close();
  }
}

async function runTouchAndAddMotion({ browser, candidate, origin }) {
  const context = await browser.newContext({
    baseURL: origin,
    hasTouch: true,
    isMobile: true,
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    viewport: { height: 844, width: 390 },
  });
  const page = await context.newPage();
  const diagnostics = await observePage(page, context, origin);
  const screenshots = [];
  try {
    await settleMotionPage(page, "en");
    const target = page.locator(".fs-motion-idol__option").nth(1);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    invariant(box !== null, "touch idol target must be measurable");
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const panel = page.locator(
      '.fs-motion-idol__panel[data-motion-mode="opacity"]',
    );
    await panel.waitFor({ state: "visible" });
    const touchStyle = await panel
      .locator('.fs-motion-idol__media-layer[data-layer="active"]')
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          transform: style.transform,
          transitionProperties: [
            ...new Set(
              style.transitionProperty
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value !== "" && value !== "none"),
            ),
          ],
        };
      });
    await page.waitForFunction(() => {
      const layer = document.querySelector(
        '.fs-motion-idol__media-layer[data-layer="active"]',
      );
      const image = layer?.querySelector("img");
      const fallback = layer?.querySelector("[data-media-fallback]");
      return (
        (image instanceof HTMLImageElement &&
          image.complete &&
          image.naturalWidth > 0) ||
        (fallback instanceof HTMLElement &&
          fallback.getClientRects().length > 0)
      );
    });
    await page.waitForFunction(() => {
      const panel = document.querySelector(".fs-motion-idol__panel");
      return (
        panel?.getAttribute("data-motion-phase") === "settled" &&
        panel.getAnimations({ subtree: true }).length > 0
      );
    });
    const touchTiming = await readAnimationTiming(panel);
    const touchVisualFrames = await captureOpacityTransition(panel, {
      activeSelector: '.fs-motion-idol__media-layer[data-layer="active"]',
      outgoingSelector: '.fs-motion-idol__media-layer[data-layer="outgoing"]',
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '.fs-motion-idol__media-layer[data-layer="outgoing"]',
        ).length === 0,
    );
    screenshots.push(
      await writeScreenshot(
        page,
        candidate,
        "motion/idol-touch-opacity-390.png",
      ),
    );

    const addRoot = page.locator('[data-fs-motion="add-to-cart"]');
    await addRoot.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const root = document.querySelector('[data-fs-motion="add-to-cart"]');
      window.__p205AddEvents = [];
      if (!(root instanceof HTMLElement)) {
        return;
      }
      const record = () => {
        window.__p205AddEvents.push({
          at: performance.now(),
          state: root.getAttribute("data-confirmation-state"),
        });
      };
      record();
      new MutationObserver(record).observe(root, {
        attributeFilter: ["data-confirmation-state"],
        attributes: true,
        childList: true,
        subtree: true,
      });
    });
    const countBefore = Number(
      await page
        .locator("output[data-cart-count]")
        .getAttribute("data-cart-count"),
    );
    const addButton = addRoot.locator("button");
    const addBox = await addButton.boundingBox();
    invariant(addBox !== null, "touch add target must be measurable");
    await page.touchscreen.tap(
      addBox.x + addBox.width / 2,
      addBox.y + addBox.height / 2,
    );
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-fs-motion="add-to-cart"]');
      return (
        root?.getAttribute("data-confirmation-state") === "confirmed" &&
        root.getAnimations({ subtree: true }).length > 0
      );
    });
    const addTiming = await readAnimationTiming(addRoot);
    const addOpacityFrames = await captureOpacityTransition(addRoot, {
      activeSelector: '.fs-motion-add__label[data-layer="confirmed"]',
      outgoingSelector: '.fs-motion-add__label[data-layer="action"]',
    });
    const addEvidence = await page.evaluate(() => {
      const events = window.__p205AddEvents;
      const pending = events.find((event) => event.state === "pending");
      const confirmed = [...events]
        .reverse()
        .find((event) => event.state === "confirmed");
      const root = document.querySelector('[data-fs-motion="add-to-cart"]');
      const button = root?.querySelector("button");
      const live = root?.querySelector('[role="status"], [role="alert"]');
      return {
        buttonFocused: document.activeElement === button,
        stateDelayMs:
          pending === undefined || confirmed === undefined
            ? Number.POSITIVE_INFINITY
            : confirmed.at - pending.at,
        liveAnnouncement: (live?.textContent?.trim().length ?? 0) > 0,
        pendingObserved: pending !== undefined,
      };
    });
    const countAfter = Number(
      await page
        .locator("output[data-cart-count]")
        .getAttribute("data-cart-count"),
    );
    await page.waitForTimeout(addTiming.maxEndTimeMs + 40);
    screenshots.push(
      await writeScreenshot(page, candidate, "motion/add-confirmed-390.png"),
    );
    const resetButton = page.getByRole("button", {
      name: "Reset confirmation",
    });
    await resetButton.click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-fs-motion="add-to-cart"]')
          ?.getAttribute("data-confirmation-state") === "idle",
    );
    const resetToIdle =
      (await addRoot.getAttribute("data-confirmation-state")) === "idle";
    const pendingObservedOnInterrupt = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const root = document.querySelector('[data-fs-motion="add-to-cart"]');
          const add = root?.querySelector("button");
          const error = [...document.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === "Show recoverable error",
          );
          if (
            !(root instanceof HTMLElement) ||
            !(add instanceof HTMLElement) ||
            !(error instanceof HTMLElement)
          ) {
            reject(new Error("add interruption controls are unavailable"));
            return;
          }
          const timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error("add interruption did not observe pending"));
          }, 1_000);
          const observer = new MutationObserver(() => {
            if (root.getAttribute("data-confirmation-state") !== "pending") {
              return;
            }
            clearTimeout(timeout);
            observer.disconnect();
            error.click();
            resolve(true);
          });
          observer.observe(root, {
            attributeFilter: ["data-confirmation-state"],
            attributes: true,
          });
          add.click();
        }),
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-fs-motion="add-to-cart"]')
          ?.getAttribute("data-confirmation-state") === "error",
    );
    await page.waitForTimeout(80);
    const interruption = await page.evaluate(
      ({ count, pendingObserved, reset }) => {
        const root = document.querySelector('[data-fs-motion="add-to-cart"]');
        const currentCount = Number(
          document
            .querySelector("output[data-cart-count]")
            ?.getAttribute("data-cart-count"),
        );
        const live = root?.querySelector('[role="status"], [role="alert"]');
        return {
          countStableOnError: currentCount === count,
          errorLive:
            live?.getAttribute("role") === "alert" &&
            (live.textContent?.trim().length ?? 0) > 0,
          pendingObserved,
          resetToIdle: reset,
        };
      },
      {
        count: countAfter,
        pendingObserved: pendingObservedOnInterrupt,
        reset: resetToIdle,
      },
    );
    const errors = diagnosticsErrors(diagnostics);
    invariant(errors.length === 0, errors.join("; "));
    return {
      addToCart: {
        ...addEvidence,
        countDelta: countAfter - countBefore,
        interruption,
        timing: addTiming,
        visualDurationMs: addTiming.maxActiveDurationMs,
        visualFrames: {
          end: {
            actionOpacity: addOpacityFrames.end.outgoingOpacity,
            confirmedOpacity: addOpacityFrames.end.activeOpacity,
          },
          start: {
            actionOpacity: addOpacityFrames.start.outgoingOpacity,
            confirmedOpacity: addOpacityFrames.start.activeOpacity,
          },
        },
      },
      screenshots,
      touch: {
        durationMs: touchTiming.maxActiveDurationMs,
        mode: "opacity",
        timing: touchTiming,
        transform: touchStyle.transform,
        transitionProperties: touchStyle.transitionProperties,
        visualFrames: touchVisualFrames,
      },
    };
  } finally {
    await context.close();
  }
}

async function readMotionStyle(page, selector) {
  return page.locator(selector).evaluateAll((elements) => {
    const parse = (value) =>
      value.split(",").reduce((maximum, part) => {
        const trimmed = part.trim();
        const parsed = Number.parseFloat(trimmed);
        return Number.isFinite(parsed)
          ? Math.max(maximum, trimmed.endsWith("ms") ? parsed : parsed * 1_000)
          : maximum;
      }, 0);
    return elements.reduce(
      (summary, element) => {
        const style = getComputedStyle(element);
        return {
          animationMs: Math.max(
            summary.animationMs,
            parse(style.animationDuration),
          ),
          transform:
            summary.transform === "none" && style.transform !== "none"
              ? style.transform
              : summary.transform,
          transitionMs: Math.max(
            summary.transitionMs,
            parse(style.transitionDuration),
          ),
        };
      },
      { animationMs: 0, transform: "none", transitionMs: 0 },
    );
  });
}

async function runReducedMotion({ browser, candidate, origin, viewport }) {
  const context = await browser.newContext({
    baseURL: origin,
    hasTouch: viewport.width === 390,
    isMobile: viewport.width === 390,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    viewport,
  });
  const page = await context.newPage();
  const diagnostics = await observePage(page, context, origin);
  try {
    await settleMotionPage(page, "en");
    const root = page.locator('[data-motion-fixture="true"]');
    await page
      .locator(".fs-motion-idol__option")
      .nth(1)
      .scrollIntoViewIfNeeded();
    const before = await root.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        documentRect: {
          height: rect.height,
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          width: rect.width,
        },
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
    });
    await page.evaluate(() => {
      document.querySelector('[data-testid="replay-hero"]')?.click();
      document.querySelectorAll(".fs-motion-idol__option")[1]?.click();
      document.querySelector('[data-fs-motion="add-to-cart"] button')?.click();
      document.querySelector('[data-testid="replay-success"]')?.click();
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-fs-motion="add-to-cart"]')
          ?.getAttribute("data-confirmation-state") === "confirmed",
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector(".fs-motion-idol__panel")
          ?.getAttribute("data-motion-phase") === "settled" &&
        document.querySelectorAll(
          '.fs-motion-idol__media-layer[data-layer="outgoing"]',
        ).length === 0,
    );
    const after = await root.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        documentRect: {
          height: rect.height,
          left: rect.left + window.scrollX,
          top: rect.top + window.scrollY,
          width: rect.width,
        },
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
    });
    const stateFeedback = await page.evaluate(() => {
      const visualState = (element) => {
        if (!(element instanceof HTMLElement)) {
          return {
            display: "none",
            opacity: 0,
            text: "",
            visibility: "hidden",
            visible: false,
          };
        }
        const style = getComputedStyle(element);
        const opacity = Number(style.opacity);
        const text = element.textContent?.trim().replace(/\s+/gu, " ") ?? "";
        return {
          display: style.display,
          opacity,
          text,
          visibility: style.visibility,
          visible:
            element.getClientRects().length > 0 &&
            style.display !== "none" &&
            style.visibility === "visible" &&
            opacity >= 0.99 &&
            text.length > 0,
        };
      };
      const selectedLabel = visualState(
        document.querySelector(
          '.fs-motion-idol__option[data-selected="true"] .fs-motion-idol__selected',
        ),
      );
      const confirmedLabel = visualState(
        document.querySelector('.fs-motion-add__label[data-layer="confirmed"]'),
      );
      const heroContent = visualState(
        document.querySelector(".fs-motion-hero .fs-hero__content"),
      );
      const idolCopy = visualState(
        document.querySelector('.fs-motion-idol__copy[data-active="true"]'),
      );
      const success = visualState(
        document.querySelector(".fs-motion-success__body"),
      );
      const cart = document.querySelector("output[data-cart-count]");
      return {
        cartCount: Number(cart?.getAttribute("data-cart-count")),
        confirmedLabel,
        confirmedLabelVisible: confirmedLabel.visible,
        heroContent,
        idolCopy,
        liveRegionText:
          document
            .querySelector(
              '[data-fs-motion="add-to-cart"] [role="status"], [data-fs-motion="add-to-cart"] [role="alert"]',
            )
            ?.textContent?.trim() ?? "",
        selectedId:
          document
            .querySelector(".fs-motion-idol__radio:checked")
            ?.getAttribute("value") ?? null,
        selectedLabel,
        selectedLabelVisible: selectedLabel.visible,
        success,
        successVisible: success.visible,
      };
    });
    const measurement = {
      add: await readMotionStyle(
        page,
        ".fs-motion-add__label, .fs-motion-add__button",
      ),
      hero: await readMotionStyle(
        page,
        ".fs-motion-hero .fs-hero__media, .fs-motion-hero .fs-hero__content",
      ),
      idol: await readMotionStyle(page, ".fs-motion-idol__media-layer"),
      mediaQuery: await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      positionDeltaPx: Math.max(
        Math.abs(before.documentRect.left - after.documentRect.left),
        Math.abs(before.documentRect.top - after.documentRect.top),
        Math.abs(before.documentRect.width - after.documentRect.width),
        Math.abs(before.documentRect.height - after.documentRect.height),
      ),
      scrollBehavior: await page
        .locator('main[data-ui-motion="v1"]')
        .evaluate((element) => getComputedStyle(element).scrollBehavior),
      scrollDeltaPx: Math.max(
        Math.abs(before.scrollX - after.scrollX),
        Math.abs(before.scrollY - after.scrollY),
      ),
      stateFeedback,
      statusClear: await page.evaluate(
        () =>
          document
            .querySelector(".fs-motion-idol__radio:checked")
            ?.getAttribute("value") === "noa-aster" &&
          document
            .querySelector('[data-fs-motion="add-to-cart"]')
            ?.getAttribute("data-confirmation-state") === "confirmed" &&
          document
            .querySelector('[data-fs-motion="success-reveal"]')
            ?.getAttribute("data-order-status") === "confirmed",
      ),
      success: await readMotionStyle(
        page,
        ".fs-motion-success__marker, .fs-motion-success__body",
      ),
      viewportWidth: viewport.width,
    };
    const errors = [
      ...assessReducedMotionEvidence(measurement, viewport.width),
      ...diagnosticsErrors(diagnostics),
    ];
    invariant(errors.length === 0, errors.join("; "));
    const screenshot = await writeScreenshot(
      page,
      candidate,
      `reduced-motion/${String(viewport.width)}x${String(viewport.height)}.png`,
      { fullPage: true },
    );
    return { measurement, screenshot };
  } finally {
    await context.close();
  }
}

async function runBrowserEvidence({ candidate, origin, registry, versions }) {
  const [{ chromium }, axeModule] = await Promise.all([
    import("@playwright/test"),
    import("@axe-core/playwright"),
  ]);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const untrackBrowser = registry?.trackBrowser(browser) ?? (() => undefined);
  versions.browser = `Google Chrome ${browser.version()}`;
  const scenarioResults = [];
  const axeSummaries = [];
  const screenshots = [];
  try {
    for (const entry of createMotionScenarioMatrix()) {
      process.stdout.write(`\n[p2-05 browser] ${entry.id}\n`);
      const scenarioResult = await runScenario({
        AxeBuilder: axeModule.default,
        browser,
        candidate,
        entry,
        origin,
      });
      invariant(
        scenarioResult.result.errors.length === 0,
        `${entry.id} failed: ${scenarioResult.result.errors.join("; ")}`,
      );
      scenarioResults.push(scenarioResult.result);
      axeSummaries.push(...scenarioResult.axeSummaries);
      screenshots.push(scenarioResult.screenshot);
    }
    process.stdout.write("\n[p2-05 browser] hero-frames-mobile\n");
    const mobileHero = await runHeroFrames({
      browser,
      candidate,
      origin,
      viewport: { height: 844, width: 390 },
    });
    process.stdout.write("\n[p2-05 browser] hero-frames-desktop\n");
    const desktopHero = await runHeroFrames({
      browser,
      candidate,
      origin,
      viewport: { height: 900, width: 1440 },
    });
    screenshots.push(...mobileHero.screenshots, ...desktopHero.screenshots);

    process.stdout.write("\n[p2-05 browser] mouse-keyboard-latest-success\n");
    const desktopMotion = await runMouseAndKeyboardMotion({
      browser,
      candidate,
      origin,
    });
    screenshots.push(...desktopMotion.screenshots);
    process.stdout.write("\n[p2-05 browser] touch-add\n");
    const mobileMotion = await runTouchAndAddMotion({
      browser,
      candidate,
      origin,
    });
    screenshots.push(...mobileMotion.screenshots);

    process.stdout.write("\n[p2-05 browser] reduced-motion-mobile\n");
    const mobileReduced = await runReducedMotion({
      browser,
      candidate,
      origin,
      viewport: { height: 844, width: 390 },
    });
    process.stdout.write("\n[p2-05 browser] reduced-motion-desktop\n");
    const desktopReduced = await runReducedMotion({
      browser,
      candidate,
      origin,
      viewport: { height: 900, width: 1440 },
    });
    screenshots.push(mobileReduced.screenshot, desktopReduced.screenshot);
    return {
      axeSummaries,
      motionChecks: {
        addToCart: mobileMotion.addToCart,
        hero: { desktop: desktopHero.evidence, mobile: mobileHero.evidence },
        idolSwitch: {
          ...desktopMotion.idolSwitch,
          touch: mobileMotion.touch,
        },
        success: desktopMotion.success,
      },
      reducedMotion: {
        desktop: desktopReduced.measurement,
        mobile: mobileReduced.measurement,
      },
      scenarioResults,
      screenshots,
    };
  } finally {
    let browserClosed = false;
    try {
      await (registry?.closeBrowser(browser) ??
        closeBrowserWithin(browser, 5_000));
      browserClosed = true;
    } finally {
      if (browserClosed) {
        untrackBrowser();
      }
    }
  }
}

async function writeRawEvidence(candidate, browserEvidence) {
  await mkdir(path.join(candidate, "raw"), { recursive: true });
  for (const [relativePath, value] of [
    ["raw/scenario-results.json", browserEvidence.scenarioResults],
    ["raw/motion-checks.json", browserEvidence.motionChecks],
    ["raw/reduced-motion.json", browserEvidence.reducedMotion],
  ]) {
    await writeFile(
      path.join(candidate, ...relativePath.split("/")),
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
  }
}

export function installMotionSignalCleanup(cleanup) {
  let handlingSignal;
  let terminating = false;
  const handlers = new Map();
  const uninstall = () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
    handlers.clear();
  };
  const terminate = (signal) => {
    if (terminating) {
      return;
    }
    terminating = true;
    uninstall();
    process.kill(process.pid, signal);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (handlingSignal !== undefined) {
        terminate(signal);
        return;
      }
      handlingSignal = signal;
      Promise.resolve()
        .then(cleanup)
        .then(
          () => terminate(signal),
          (error) => {
            console.error(
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
            );
            terminate(signal);
          },
        );
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  return uninstall;
}

export async function runUiMotionBrowserVerification({
  workspaceRoot = defaultWorkspaceRoot,
} = {}) {
  const matrixErrors = validateMotionScenarioMatrix(
    createMotionScenarioMatrix(),
  );
  invariant(matrixErrors.length === 0, matrixErrors.join("; "));
  const evidenceParent = path.join(workspaceRoot, "output/playwright");
  const target = path.join(workspaceRoot, evidenceRelativePath);
  const lockPath = path.join(evidenceParent, ".p2-05-run.lock");
  const resources = createMotionResourceRegistry();
  let lock;
  let candidate;
  let server;
  let recoveryFailed = false;
  let recoveryTarget;
  const cleanup = createMotionEvidenceCleanup({
    canReleaseLock: () => !recoveryFailed,
    closeResources: () => resources.cleanup(),
    getCandidate: () => candidate,
    getServer: () => server,
    getTarget: () => recoveryTarget,
    lockPath,
    releaseLock: () => lock?.release(),
  });
  const uninstallSignals = installMotionSignalCleanup(cleanup);
  try {
    await mkdir(evidenceParent, { recursive: true });
    lock = await acquireMotionEvidenceLock(evidenceParent);
    recoveryTarget = target;
    try {
      await recoverMotionEvidenceSwap(target);
    } catch (error) {
      recoveryFailed = true;
      throw error;
    }
    candidate = await mkdtemp(path.join(evidenceParent, ".p2-05-candidate-"));
    const [versions, gitBefore] = await Promise.all([
      collectVersions(workspaceRoot),
      collectGit(workspaceRoot),
    ]);
    const { fontLoadingPolicy, standalone } = await prepareProductionBuild(
      workspaceRoot,
      candidate,
      resources,
    );
    server = await startServer({
      candidate,
      environment: "preview",
      registry: resources,
      standalone,
    });
    const previewGate = await probeRuntime(server);
    invariant(
      previewGate.healthStatus === 200 &&
        previewGate.localeStatuses.every((status) => status === 200),
      "preview must expose all eight motion locale routes",
    );
    const browserEvidence = await runBrowserEvidence({
      candidate,
      origin: server.origin,
      registry: resources,
      versions,
    });
    await stopServer(server);
    server = undefined;

    const closedGates = [];
    for (const environment of ["staging", "production"]) {
      server = await startServer({
        candidate,
        environment,
        registry: resources,
        standalone,
      });
      try {
        const gate = await probeRuntime(server);
        invariant(
          gate.healthStatus === 200 &&
            gate.localeStatuses.every((status) => status === 404),
          `${environment} must hide all eight motion locale routes`,
        );
        closedGates.push(gate);
      } finally {
        await stopServer(server);
        server = undefined;
      }
    }
    const gitAfter = await collectGit(workspaceRoot);
    invariant(
      hasSameGitEvidence(gitBefore, gitAfter),
      "motion browser verification changed source workspace state",
    );
    const evidence = {
      axeSummaries: browserEvidence.axeSummaries,
      fontLoadingPolicy,
      generatedAt: new Date().toISOString(),
      git: { after: gitAfter, before: gitBefore },
      launch: {
        browserChannel: "chrome",
        headless: true,
        productionBuild: true,
        touchEvidence: "desktop Chrome emulation only",
      },
      matrix: createMotionScenarioMatrix(),
      motionChecks: browserEvidence.motionChecks,
      physicalDeviceEvidence: false,
      reducedMotion: browserEvidence.reducedMotion,
      remainingGate:
        "Real mobile-device recording and frame-rate evidence is still required.",
      result: "passed-with-physical-device-gate",
      runtimeGates: [previewGate, ...closedGates],
      scenarioResults: browserEvidence.scenarioResults,
      schemaVersion: 1,
      screenshots: browserEvidence.screenshots,
      versions,
    };
    const shapeErrors = assessMotionEvidenceShape(evidence);
    invariant(shapeErrors.length === 0, shapeErrors.join("; "));
    await writeRawEvidence(candidate, browserEvidence);
    await writeFile(
      path.join(candidate, "screenshots.sha256"),
      `${browserEvidence.screenshots
        .map((entry) => `${entry.sha256}  ${entry.path}`)
        .join("\n")}\n`,
      "utf8",
    );
    await writeFile(
      path.join(candidate, "README.md"),
      createMotionEvidenceReadme(evidence),
      "utf8",
    );
    await writeFile(
      path.join(candidate, "browser-results.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    await replaceMotionEvidenceDirectory(candidate, target);
    process.stdout.write(`\nP2-05 browser verification passed: ${target}\n`);
    return evidence;
  } finally {
    try {
      await cleanup();
    } finally {
      uninstallSignals();
    }
  }
}

if (process.argv[1] === scriptPath) {
  await runUiMotionBrowserVerification().catch((error) => {
    console.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exitCode = 1;
  });
}
