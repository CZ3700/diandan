import type {
  OrderAccessItem,
  OrderAccessSupportCertificate,
  SupportedLocale,
} from "@fan-support/contracts";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";

// ADR-019 supplement (L3-09): the savable digital support certificate. Everything here runs in
// the fan's browser; the name typed for the signature never leaves this device.

export const CERTIFICATE_NAME_MAX = 40;

export type CertificateSignature =
  | Readonly<{ mode: "NONE" }>
  | Readonly<{ mode: "ANONYMOUS" }>
  | Readonly<{ mode: "NAME"; name: string }>;

/** 1–40 visible characters after trimming; control characters are refused. */
export function certificateSignatureName(value: string): string | null {
  const name = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  const length = [...name].length;
  if (length < 1 || length > CERTIFICATE_NAME_MAX || /\p{Cc}/u.test(name))
    return null;
  return name;
}

export type CertificateText = Readonly<{
  title: string;
  artist: string;
  gift: string;
  signature: string | null;
  delivered: string;
  order: string;
}>;

export function certificateDeliveredDate(
  certificate: OrderAccessSupportCertificate,
  locale: SupportedLocale,
) {
  // UTC like the order page's own dates, so server and browser render the same day.
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(certificate.deliveredAt));
}

export function certificateGiftLine(
  item: OrderAccessItem,
  locale: SupportedLocale,
  copy: StorefrontCopy,
) {
  const variant = item.gift.variantLabel?.trim();
  // Daily gifts often name their only option after the gift; say it once.
  const title =
    !variant || variant === item.gift.title.trim()
      ? item.gift.title
      : `${item.gift.title} · ${variant}`;
  return formatStorefrontMessage(copy, "orderCertificateGift", locale, {
    gift: title,
    quantity: new Intl.NumberFormat(locale).format(item.quantity),
  });
}

/** The words on the image: artist, gift and quantity, date, order number, chosen signature. */
export function certificateText(
  item: OrderAccessItem,
  certificate: OrderAccessSupportCertificate,
  publicOrderNo: string,
  locale: SupportedLocale,
  copy: StorefrontCopy,
  signature: CertificateSignature,
): CertificateText {
  return {
    title: copy.orderCertificateTitle,
    artist: item.idol.displayName,
    gift: certificateGiftLine(item, locale, copy),
    signature:
      signature.mode === "NONE"
        ? null
        : signature.mode === "ANONYMOUS"
          ? copy.orderCertificateFromAnonymous
          : formatStorefrontMessage(copy, "orderCertificateFrom", locale, {
              name: signature.name,
            }),
    delivered: formatStorefrontMessage(
      copy,
      "orderCertificateDelivered",
      locale,
      { date: certificateDeliveredDate(certificate, locale) },
    ),
    order: formatStorefrontMessage(copy, "orderCertificateOrder", locale, {
      number: publicOrderNo,
    }),
  };
}

/** Letter spacing and capitals suit Latin script only; they break Thai marks and CJK rhythm. */
export function certificateTracked(locale: SupportedLocale) {
  return ["en", "es", "pt", "vi"].includes(locale);
}

export function certificateFileName(publicOrderNo: string, position: number) {
  return `support-certificate-${publicOrderNo}-${position}.png`;
}

/** Break at word boundaries (graphemes for Thai/CJK without spaces); ellipsize past maxLines. */
export function wrapCertificateText(
  text: string,
  locale: SupportedLocale,
  measure: (value: string) => number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const segments =
    typeof Intl.Segmenter === "function"
      ? [...new Intl.Segmenter(locale, { granularity: "word" }).segment(text)]
          .map((part) => part.segment)
          .flatMap((part) => (measure(part) > maxWidth ? [...part] : [part]))
      : [...text];
  const lines: string[] = [];
  let current = "";
  for (const segment of segments) {
    const next = current + segment;
    if (current !== "" && measure(next.trimEnd()) > maxWidth) {
      lines.push(current.trimEnd());
      current = segment.trimStart();
    } else current = next;
  }
  if (current.trim() !== "") lines.push(current.trimEnd());
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last !== "" && measure(`${last}…`) > maxWidth)
    last = [...last].slice(0, -1).join("");
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

export type CertificateTheme = Readonly<{
  background: string;
  surface: string;
  accent: string;
  text: string;
  muted: string;
  border: string;
  fontFamily: string;
}>;

/** Resolve the live storefront theme tokens (any palette) to canvas-ready colours. */
export function readCertificateTheme(element: HTMLElement): CertificateTheme {
  const resolve = (token: string) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    element.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  };
  return {
    background: resolve("--color-bg"),
    surface: resolve("--color-surface"),
    accent: resolve("--color-accent"),
    text: resolve("--color-text"),
    muted: resolve("--color-text-muted"),
    border: resolve("--color-border"),
    fontFamily: getComputedStyle(element).fontFamily,
  };
}

export const CERTIFICATE_IMAGE_SIZE = { width: 1080, height: 1620 } as const;
const { width: WIDTH, height: HEIGHT } = CERTIFICATE_IMAGE_SIZE;
const MARGIN = 96;

type CertificatePhotos<T> = Readonly<{ artist: T; gift: T }>;

async function loadPhoto(url: string | null): Promise<HTMLImageElement | null> {
  if (url === null) return null;
  const image = new Image();
  // Same-origin optimizer URLs load normally; anything else fails instead of tainting.
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

async function loadFonts(theme: CertificateTheme, text: CertificateText) {
  if (!("fonts" in document)) return;
  const sample = Object.values(text).filter(Boolean).join(" ");
  await Promise.race([
    Promise.all(
      ["500", "700"].map((weight) =>
        document.fonts.load(`${weight} 48px ${theme.fontFamily}`, sample),
      ),
    ).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  if (typeof context.roundRect === "function")
    context.roundRect(x, y, width, height, radius);
  else context.rect(x, y, width, height);
}

function drawPhoto(
  context: CanvasRenderingContext2D,
  theme: CertificateTheme,
  photo: HTMLImageElement | null,
  fallbackLabel: string,
  frame: Readonly<{ x: number; y: number; width: number; height: number }>,
  fit: "cover" | "contain",
) {
  const { x, y, width, height } = frame;
  const padding = fit === "contain" ? 16 : 0;
  const imageWidth = width - padding * 2;
  const imageHeight = height - padding * 2;
  context.save();
  roundedRect(context, x, y, width, height, 28);
  context.fillStyle = theme.surface;
  context.fill();
  context.clip();
  if (photo) {
    const scale = (fit === "contain" ? Math.min : Math.max)(
      imageWidth / photo.naturalWidth,
      imageHeight / photo.naturalHeight,
    );
    const drawWidth = photo.naturalWidth * scale,
      drawHeight = photo.naturalHeight * scale;
    context.drawImage(
      photo,
      x + padding + (imageWidth - drawWidth) / 2,
      y + padding + (imageHeight - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  } else {
    context.fillStyle = theme.accent;
    context.font = `500 ${Math.min(width, height) * 0.42}px ${theme.fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      [...fallbackLabel][0] ?? "",
      x + width / 2,
      y + height / 2,
    );
  }
  context.restore();
  context.strokeStyle = theme.accent;
  context.lineWidth = 3;
  roundedRect(context, x, y, width, height, 28);
  context.stroke();
}

function draw(
  canvas: HTMLCanvasElement,
  text: CertificateText,
  theme: CertificateTheme,
  locale: SupportedLocale,
  photos: CertificatePhotos<HTMLImageElement | null>,
) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_UNAVAILABLE");
  context.fillStyle = theme.background;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = theme.accent;
  context.lineWidth = 2;
  context.strokeRect(40, 40, WIDTH - 80, HEIGHT - 80);
  context.strokeStyle = theme.border;
  context.lineWidth = 1;
  context.strokeRect(56, 56, WIDTH - 112, HEIGHT - 112);

  const line = (
    value: string,
    y: number,
    size: number,
    weight: string,
    color: string,
    maxLines: number,
    leading = 1.2,
  ) => {
    context.font = `${weight} ${size}px ${theme.fontFamily}`;
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "alphabetic";
    const lines = wrapCertificateText(
      value,
      locale,
      (candidate) => context.measureText(candidate).width,
      WIDTH - MARGIN * 2,
      maxLines,
    );
    lines.forEach((part, index) =>
      context.fillText(part, WIDTH / 2, y + index * size * leading),
    );
    return y + (lines.length - 1) * size * leading;
  };

  const tracked = certificateTracked(locale);
  if (tracked && "letterSpacing" in context) context.letterSpacing = "6px";
  line(
    tracked ? text.title.toLocaleUpperCase(locale) : text.title,
    150,
    30,
    "700",
    theme.accent,
    1,
  );
  if ("letterSpacing" in context) context.letterSpacing = "0px";
  drawPhoto(
    context,
    theme,
    photos.artist,
    text.artist,
    { x: (WIDTH - 480) / 2, y: 200, width: 480, height: 600 },
    "cover",
  );
  let y = line(text.artist, 890, 64, "600", theme.text, 2, 1.15);
  y = line(text.gift, y + 64, 36, "500", theme.muted, 2);
  const giftTop = y + 24;
  drawPhoto(
    context,
    theme,
    photos.gift,
    text.gift,
    { x: (WIDTH - 224) / 2, y: giftTop, width: 224, height: 224 },
    "contain",
  );
  if (text.signature !== null)
    line(text.signature, giftTop + 224 + 48, 34, "600", theme.accent, 2);
  context.fillStyle = theme.border;
  context.fillRect(WIDTH / 2 - 60, HEIGHT - 170, 120, 2);
  line(text.delivered, HEIGHT - 114, 28, "500", theme.muted, 1);
  line(text.order, HEIGHT - 74, 28, "500", theme.muted, 1);
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG_UNAVAILABLE"))),
        "image/png",
      );
    } catch (error) {
      reject(error);
    }
  });
}

/** Draw both order-snapshot images. Each unavailable image gives way to its own initial. */
export async function renderSupportCertificate(
  text: CertificateText,
  theme: CertificateTheme,
  locale: SupportedLocale,
  photoUrls: CertificatePhotos<string | null>,
): Promise<Blob> {
  const [, artist, gift] = await Promise.all([
    loadFonts(theme, text),
    loadPhoto(photoUrls.artist),
    loadPhoto(photoUrls.gift),
  ]);
  const canvas = document.createElement("canvas");
  draw(canvas, text, theme, locale, { artist, gift });
  try {
    return await toPng(canvas);
  } catch (error) {
    if (artist === null && gift === null) throw error;
    draw(canvas, text, theme, locale, { artist: null, gift: null });
    return toPng(canvas);
  }
}
