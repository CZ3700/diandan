/** Fictional local content copy; locale enumeration belongs to contracts. */
export function localHomepageCopy(locale) {
  switch (locale) {
    case "en":
      return {
        cta: "Meet the artist",
        portraits: ["Desktop portrait", "Mobile portrait"],
      };
    case "zh-CN":
      return { cta: "认识艺人", portraits: ["桌面横幅肖像", "手机竖幅肖像"] };
    case "th":
      return {
        cta: "พบกับศิลปิน",
        portraits: ["ภาพศิลปินสำหรับเดสก์ท็อป", "ภาพศิลปินสำหรับมือถือ"],
      };
    case "vi":
      return {
        cta: "Khám phá nghệ sĩ",
        portraits: ["Ảnh nghệ sĩ trên máy tính", "Ảnh nghệ sĩ trên điện thoại"],
      };
    case "ja":
      return {
        cta: "アーティストを知る",
        portraits: ["デスクトップ用の肖像", "モバイル用の肖像"],
      };
    case "es":
      return {
        cta: "Conoce al artista",
        portraits: ["Retrato para escritorio", "Retrato para móvil"],
      };
    case "pt":
      return {
        cta: "Conheça o artista",
        portraits: ["Retrato para computador", "Retrato para celular"],
      };
    default:
      throw new TypeError("Unsupported local fixture locale");
  }
}
