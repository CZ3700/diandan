import {
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";

export type DesignFoundationPreviewLocale = SupportedLocale | "en-XA";

export type DesignFoundationCase = Readonly<{
  accent: string;
  body: string;
  fontProfile: string;
  heading: string;
  label: string;
  locale: DesignFoundationPreviewLocale;
  sample: string;
}>;

type FoundationCopy = Readonly<{
  body: string;
  heading: string;
  label: string;
  sample: string;
}>;

const SYNTHETIC_ACCENT = "#6888BD";

function createPublicCase(
  locale: SupportedLocale,
  copy: FoundationCopy,
): DesignFoundationCase {
  return Object.freeze({
    accent: SYNTHETIC_ACCENT,
    ...copy,
    fontProfile: FONT_PROFILE_BY_LOCALE[locale].id,
    locale,
  });
}

function foundationCopyForLocale(locale: SupportedLocale): FoundationCopy {
  switch (locale) {
    case "en":
      return {
        body: "A quiet foundation for expressive portraits, thoughtful gifts, and clear moments of trust.",
        heading: "A thoughtful gift, prepared with care.",
        label: "English · Latin foundation",
        sample: "Manrope · À É Ñ Õ — 0123456789",
      };
    case "es":
      return {
        body: "Una base editorial serena que mantiene legibles las descripciones detalladas, los mensajes importantes y las acciones principales incluso cuando el texto necesita bastante más espacio.",
        heading: "Un regalo especial, preparado con cuidado.",
        label: "Español · Latin Extended",
        sample: "Árbol, corazón, ilusión, pingüino y acción.",
      };
    case "ja":
      return {
        body: "写真の存在感を守りながら、説明と大切な操作を落ち着いて読み進められる余白と文字組みです。",
        heading: "想いを込めた贈り物を、丁寧に準備します。",
        label: "日本語・和文組版",
        sample: "「ありがとう」、そして応援の気持ち。",
      };
    case "pt":
      return {
        body: "Uma base editorial tranquila que mantém descrições detalhadas, mensagens importantes e ações principais confortáveis de ler, mesmo quando o conteúdo precisa de muito mais espaço.",
        heading: "Um presente especial, preparado com carinho.",
        label: "Português · Latin Extended",
        sample: "Coração, atenção, bênção, açúcar e emoção.",
      };
    case "th":
      return {
        body: "ระบบตัวอักษรที่ให้ภาพถ่ายโดดเด่นและยังคงอ่านข้อความสำคัญกับขั้นตอนการสั่งซื้อได้อย่างชัดเจนในทุกขนาดหน้าจอ",
        heading: "ของขวัญแทนใจที่จัดเตรียมอย่างพิถีพิถัน",
        label: "ไทย · การจัดวางอักษรไทย",
        sample: "กำลังใจ ความตั้งใจ และความประทับใจ",
      };
    case "vi":
      return {
        body: "Một nền tảng biên tập tĩnh lặng để hình ảnh luôn nổi bật, còn nội dung quan trọng vẫn rõ ràng trên mọi kích thước màn hình.",
        heading: "Món quà chân thành, được chuẩn bị chu đáo.",
        label: "Tiếng Việt · dấu và ký tự ghép",
        sample: "Tình yêu, sự tử tế, Nguyễn, Trường và ươm mầm.",
      };
    case "zh-CN":
      return {
        body: "克制的编辑式排版让人物摄影保持主角地位，同时确保重要说明与操作在不同屏幕上都清晰、从容。",
        heading: "把真挚心意，认真准备成一份礼物。",
        label: "简体中文 · 中文排版",
        sample: "你好，世界。心意、陪伴与支持！",
      };
    default: {
      const exhaustiveLocale: never = locale;
      return exhaustiveLocale;
    }
  }
}

const publicCases = Object.freeze(
  Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      createPublicCase(locale, foundationCopyForLocale(locale)),
    ]),
  ),
) as Readonly<Record<SupportedLocale, DesignFoundationCase>>;

const pseudoCase = Object.freeze({
  accent: SYNTHETIC_ACCENT,
  body: "[!! À qüüïëţ ëđïţöřïàļ föüñđàţïöñ ţħàţ ïñţëñţïöñàļļÿ ëxpàñđš ëvëřÿ ļàbëļ, đëšçřïpţïöñ, àñđ àçţïöñ föř řëfļöŵ ţëšţïñğ !!]",
  fontProfile: "latin",
  heading: "[!! À ţħöüğħţfüļ ğïfţ, çàřëfüļļÿ přëpàřëđ ŵïţħ ëxţřà řööɱ !!]",
  label: "Pseudo · expansion fixture",
  locale: "en-XA",
  sample: "[!! 0123456789 · ÀÉÑÕ · ëxpàñđëđ !!]",
} satisfies DesignFoundationCase);

export const DESIGN_FOUNDATION_CASES = Object.freeze({
  ...publicCases,
  "en-XA": pseudoCase,
} satisfies Readonly<
  Record<DesignFoundationPreviewLocale, DesignFoundationCase>
>);

export function isDesignFoundationPreviewEnabled(value: unknown): boolean {
  return value === "development" || value === "test" || value === "preview";
}
