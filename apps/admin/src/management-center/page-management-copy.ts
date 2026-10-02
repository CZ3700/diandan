import type { SupportedLocale } from "@fan-support/contracts";

const copy: Record<
  SupportedLocale,
  { title: string; information: string; policies: string }
> = {
  en: {
    title: "Page management",
    information: "Information pages",
    policies: "Policies and terms",
  },
  "zh-CN": { title: "页面管理", information: "信息页面", policies: "政策条款" },
  th: {
    title: "จัดการหน้า",
    information: "หน้าข้อมูล",
    policies: "นโยบายและข้อกำหนด",
  },
  vi: {
    title: "Quản lý trang",
    information: "Trang thông tin",
    policies: "Chính sách và điều khoản",
  },
  ja: {
    title: "ページ管理",
    information: "情報ページ",
    policies: "ポリシーと規約",
  },
  es: {
    title: "Gestión de páginas",
    information: "Páginas informativas",
    policies: "Políticas y condiciones",
  },
  pt: {
    title: "Gestão de páginas",
    information: "Páginas informativas",
    policies: "Políticas e termos",
  },
};
export const pageManagementCopy = (locale: SupportedLocale) => copy[locale];
