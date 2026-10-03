import type { SupportedLocale } from "@fan-support/contracts";

type PageManagementCopy = {
  title: string;
  information: string;
  policies: string;
};
const en: PageManagementCopy = {
  title: "Page management",
  information: "Information pages",
  policies: "Policies and terms",
};
const zhCN: PageManagementCopy = {
  title: "页面管理",
  information: "信息页面",
  policies: "政策条款",
};
const th: PageManagementCopy = {
  title: "จัดการหน้า",
  information: "หน้าข้อมูล",
  policies: "นโยบายและข้อกำหนด",
};
const vi: PageManagementCopy = {
  title: "Quản lý trang",
  information: "Trang thông tin",
  policies: "Chính sách và điều khoản",
};
const ja: PageManagementCopy = {
  title: "ページ管理",
  information: "情報ページ",
  policies: "ポリシーと規約",
};
const es: PageManagementCopy = {
  title: "Gestión de páginas",
  information: "Páginas informativas",
  policies: "Políticas y condiciones",
};
const pt: PageManagementCopy = {
  title: "Gestão de páginas",
  information: "Páginas informativas",
  policies: "Políticas e termos",
};
export function pageManagementCopy(
  locale: SupportedLocale,
): PageManagementCopy {
  switch (locale) {
    case "en":
      return en;
    case "zh-CN":
      return zhCN;
    case "th":
      return th;
    case "vi":
      return vi;
    case "ja":
      return ja;
    case "es":
      return es;
    case "pt":
      return pt;
  }
}
