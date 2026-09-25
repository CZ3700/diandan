import {
  SUPPORTED_LOCALES,
  baseContentTextSchema,
  supportedLocaleSchema,
} from "@fan-support/contracts";

/** Fictional local training copy, never a production translation approval. */
function copy(locale) {
  switch (supportedLocaleSchema.parse(locale)) {
    case "en":
      return {
        title: "UAT studio gift",
        description: "A sample gift for a local operations exercise.",
        fulfillment:
          "The studio prepares this gift and hands it to the artist. No public response is promised.",
        label: "Studio edition",
        bio: "An independent artist creating music and sharing thoughtful moments with fans.",
      };
    case "zh-CN":
      return {
        title: "运营验收礼物",
        description: "用于本地运营练习的示例礼物。",
        fulfillment: "工作室准备礼物并转交艺人，不承诺公开回应。",
        label: "工作室款",
        bio: "一位独立音乐人，用音乐与粉丝分享温暖时刻。",
      };
    case "th":
      return {
        title: "ของขวัญทดสอบสตูดิโอ",
        description: "ของขวัญตัวอย่างสำหรับการฝึกปฏิบัติงานในเครื่อง",
        fulfillment:
          "สตูดิโอเตรียมของขวัญและส่งต่อให้ศิลปิน โดยไม่รับประกันการตอบกลับต่อสาธารณะ",
        label: "รุ่นสตูดิโอ",
        bio: "ศิลปินอิสระที่สร้างสรรค์ดนตรีและแบ่งปันช่วงเวลาดี ๆ กับแฟนคลับ",
      };
    case "vi":
      return {
        title: "Quà tặng thử nghiệm",
        description: "Quà tặng mẫu dành cho buổi thực hành vận hành cục bộ.",
        fulfillment:
          "Studio chuẩn bị và chuyển quà cho nghệ sĩ. Không cam kết phản hồi công khai.",
        label: "Phiên bản studio",
        bio: "Nghệ sĩ độc lập sáng tạo âm nhạc và chia sẻ những khoảnh khắc ý nghĩa với người hâm mộ.",
      };
    case "ja":
      return {
        title: "運用テスト用ギフト",
        description: "ローカル環境での運用練習に使うサンプルギフトです。",
        fulfillment:
          "スタジオがギフトを準備してアーティストに届けます。公開の返答は約束しません。",
        label: "スタジオ版",
        bio: "音楽を制作し、ファンと心温まる時間を分かち合う独立系アーティスト。",
      };
    case "es":
      return {
        title: "Regalo de prueba del estudio",
        description:
          "Un regalo de ejemplo para practicar la gestión en un entorno local.",
        fulfillment:
          "El estudio prepara el regalo y lo entrega al artista. No se promete una respuesta pública.",
        label: "Edición de estudio",
        bio: "Artista independiente que crea música y comparte momentos especiales con sus seguidores.",
      };
    case "pt":
      return {
        title: "Presente de teste do estúdio",
        description:
          "Um presente de exemplo para praticar a operação em ambiente local.",
        fulfillment:
          "O estúdio prepara o presente e o entrega ao artista. Não há promessa de resposta pública.",
        label: "Edição de estúdio",
        bio: "Artista independente que cria música e compartilha momentos especiais com os fãs.",
      };
  }
}
function giftFields(value) {
  return {
    title: value.title,
    shortDescription: value.description,
    description: `<p>${value.description}</p>`,
    fulfillmentDescription: value.fulfillment,
    seoTitle: value.title,
    seoDescription: value.description,
  };
}
export function operationsText(kind, locale, variantIds = []) {
  const value = copy(locale);
  if (kind === "idol")
    return baseContentTextSchema.parse({
      kind: "IDOL",
      fields: {
        displayName: "Luna Mira",
        shortBio: value.bio,
        fullBio: `<p>${value.bio}</p>`,
        seoTitle: "Luna Mira",
        seoDescription: value.bio,
      },
    });
  if (kind !== "gift") throw new Error("INVALID_CASE");
  return baseContentTextSchema.parse({
    kind: "GIFT",
    fields: {
      ...giftFields(value),
      variantLabels: variantIds.map((giftVariantId) => ({
        giftVariantId,
        label: value.label,
      })),
    },
  });
}
export function operationsMaterials() {
  return {
    schemaVersion: 1,
    environment: "LOCAL_TEST_ONLY",
    humanTranslationApproval: false,
    texts: SUPPORTED_LOCALES.map((locale) => ({
      locale,
      idol: operationsText("idol", locale),
      giftFieldsToEnter: giftFields(copy(locale)),
      variantLabel: copy(locale).label,
    })),
  };
}
