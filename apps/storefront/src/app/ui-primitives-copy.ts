import type { SupportedLocale } from "@fan-support/contracts";

import {
  DESIGN_FOUNDATION_CASES,
  type DesignFoundationPreviewLocale,
} from "../design-foundations";

export type UiPrimitiveCopy = Readonly<{
  action: string;
  buttonCount: string;
  decrease: string;
  disabledAction: string;
  fieldError: string;
  fieldHint: string;
  fieldLabel: string;
  iconLabel: string;
  increase: string;
  link: string;
  loadingAction: string;
  mediaAlt: string;
  mediaErrorAction: string;
  mediaFallback: string;
  quantity: string;
  status: string;
}>;

export type UiPrimitiveSpecimenCopy = Readonly<{
  controls: UiPrimitiveCopy;
  fontProfile: string;
  heading: string;
  intro: string;
  presentationLocale: SupportedLocale;
}>;

function publicCopy(locale: SupportedLocale): UiPrimitiveCopy {
  switch (locale) {
    case "en":
      return {
        action: "Continue with support gift",
        buttonCount: "Completed actions",
        decrease: "Decrease quantity",
        disabledAction: "Unavailable action",
        fieldError: "Enter a name that can be shown with the gift.",
        fieldHint:
          "Your full private message remains inside the protected order flow.",
        fieldLabel: "Display name",
        iconLabel: "Support gift bag",
        increase: "Increase quantity",
        link: "Review preparation and delivery details",
        loadingAction: "Preparing secure checkout",
        mediaAlt: "Abstract source-owned gift support artwork",
        mediaErrorAction: "Show the image error fallback",
        mediaFallback: "Gift artwork is temporarily unavailable",
        quantity: "Gift quantity",
        status: "Ready for careful preparation",
      };
    case "es":
      return {
        action: "Continuar con este regalo de apoyo cuidadosamente preparado",
        buttonCount: "Acciones completadas",
        decrease: "Disminuir la cantidad",
        disabledAction: "Acción no disponible",
        fieldError: "Introduce un nombre que pueda mostrarse junto al regalo.",
        fieldHint:
          "Tu mensaje privado completo permanece dentro del flujo protegido del pedido.",
        fieldLabel: "Nombre visible",
        iconLabel: "Bolsa de regalo de apoyo",
        increase: "Aumentar la cantidad",
        link: "Consultar todos los detalles de preparación y entrega del regalo",
        loadingAction: "Preparando el pago seguro",
        mediaAlt: "Ilustración abstracta propia para un regalo de apoyo",
        mediaErrorAction: "Mostrar la alternativa cuando falla la imagen",
        mediaFallback:
          "La ilustración del regalo no está disponible temporalmente",
        quantity: "Cantidad de regalos",
        status: "Listo para una preparación cuidadosa",
      };
    case "ja":
      return {
        action: "応援ギフトの手続きを続ける",
        buttonCount: "完了した操作",
        decrease: "数量を減らす",
        disabledAction: "現在利用できない操作",
        fieldError: "ギフトと一緒に表示できる名前を入力してください。",
        fieldHint:
          "非公開のメッセージ全文は保護された注文フロー内に保持されます。",
        fieldLabel: "表示名",
        iconLabel: "応援ギフトバッグ",
        increase: "数量を増やす",
        link: "準備と配送の詳細を確認する",
        loadingAction: "安全な決済を準備しています",
        mediaAlt: "応援ギフトを表現した自社制作の抽象アート",
        mediaErrorAction: "画像エラー時の代替表示を確認する",
        mediaFallback: "ギフト画像を一時的に表示できません",
        quantity: "ギフトの数量",
        status: "丁寧な準備を始められます",
      };
    case "pt":
      return {
        action: "Continuar com este presente de apoio cuidadosamente preparado",
        buttonCount: "Ações concluídas",
        decrease: "Diminuir a quantidade",
        disabledAction: "Ação indisponível",
        fieldError: "Insira um nome que possa aparecer junto ao presente.",
        fieldHint:
          "Sua mensagem privada completa permanece dentro do fluxo protegido do pedido.",
        fieldLabel: "Nome de exibição",
        iconLabel: "Sacola de presente de apoio",
        increase: "Aumentar a quantidade",
        link: "Consultar todos os detalhes de preparação e entrega do presente",
        loadingAction: "Preparando o pagamento seguro",
        mediaAlt: "Arte abstrata própria para um presente de apoio",
        mediaErrorAction: "Mostrar a alternativa quando a imagem falhar",
        mediaFallback: "A arte do presente está temporariamente indisponível",
        quantity: "Quantidade de presentes",
        status: "Pronto para uma preparação cuidadosa",
      };
    case "th":
      return {
        action: "ดำเนินการส่งของขวัญสนับสนุนต่อ",
        buttonCount: "จำนวนการดำเนินการที่เสร็จแล้ว",
        decrease: "ลดจำนวน",
        disabledAction: "ยังไม่สามารถดำเนินการนี้ได้",
        fieldError: "กรุณากรอกชื่อที่สามารถแสดงพร้อมของขวัญได้",
        fieldHint:
          "ข้อความส่วนตัวฉบับเต็มจะอยู่ภายในขั้นตอนคำสั่งซื้อที่ได้รับการปกป้อง",
        fieldLabel: "ชื่อที่แสดง",
        iconLabel: "ถุงของขวัญสนับสนุน",
        increase: "เพิ่มจำนวน",
        link: "ตรวจสอบรายละเอียดการจัดเตรียมและการจัดส่ง",
        loadingAction: "กำลังเตรียมการชำระเงินที่ปลอดภัย",
        mediaAlt: "ภาพนามธรรมที่เราสร้างขึ้นสำหรับของขวัญสนับสนุน",
        mediaErrorAction: "แสดงข้อความสำรองเมื่อรูปภาพผิดพลาด",
        mediaFallback: "ไม่สามารถแสดงภาพของขวัญได้ชั่วคราว",
        quantity: "จำนวนของขวัญ",
        status: "พร้อมสำหรับการจัดเตรียมอย่างพิถีพิถัน",
      };
    case "vi":
      return {
        action: "Tiếp tục với món quà ủng hộ",
        buttonCount: "Số thao tác đã hoàn tất",
        decrease: "Giảm số lượng",
        disabledAction: "Thao tác chưa khả dụng",
        fieldError: "Hãy nhập tên có thể hiển thị cùng món quà.",
        fieldHint:
          "Toàn bộ lời nhắn riêng tư luôn nằm trong quy trình đơn hàng được bảo vệ.",
        fieldLabel: "Tên hiển thị",
        iconLabel: "Túi quà ủng hộ",
        increase: "Tăng số lượng",
        link: "Xem chi tiết chuẩn bị và giao quà",
        loadingAction: "Đang chuẩn bị thanh toán an toàn",
        mediaAlt: "Minh họa trừu tượng do nền tảng tự tạo cho quà ủng hộ",
        mediaErrorAction: "Hiển thị nội dung thay thế khi hình ảnh bị lỗi",
        mediaFallback: "Hình ảnh món quà tạm thời chưa hiển thị được",
        quantity: "Số lượng quà",
        status: "Sẵn sàng để chuẩn bị cẩn thận",
      };
    case "zh-CN":
      return {
        action: "继续提交应援礼物",
        buttonCount: "已完成操作",
        decrease: "减少数量",
        disabledAction: "暂不可用的操作",
        fieldError: "请输入可随礼物展示的署名。",
        fieldHint: "把完整留言保留在安全流程中",
        fieldLabel: "公开署名",
        iconLabel: "应援礼物袋",
        increase: "增加数量",
        link: "查看礼物准备与送达说明",
        loadingAction: "正在准备安全结账",
        mediaAlt: "平台自制的抽象应援礼物插画",
        mediaErrorAction: "显示图片失败后的替代内容",
        mediaFallback: "暂时无法显示礼物插画",
        quantity: "礼物数量",
        status: "可以开始认真准备",
      };
    default: {
      const exhaustiveLocale: never = locale;
      return exhaustiveLocale;
    }
  }
}

const PSEUDO_COPY = Object.freeze({
  action: "[!! Çöñţïñüë ŵïţħ à đëļïbëřàţëļÿ ëxpàñđëđ àçţïöñ ļàbëļ !!]",
  buttonCount: "[!! Çöɱpļëţëđ àçţïöñš !!]",
  decrease: "[!! Đëçřëàšë ğïfţ qüàñţïţÿ !!]",
  disabledAction: "[!! Üñàvàïļàbļë àçţïöñ !!]",
  fieldError:
    "[!! Pļëàšë këëp ţħïš ëxpàñđëđ ħëļp àñđ ëřřöř ţëxţ füļļÿ vïšïbļë !!]",
  fieldHint:
    "[!! Ţħë ëñţïřë přïvàţë ɱëššàğë řëɱàïñš ïñ ţħë přöţëçţëđ öřđëř fļöŵ !!]",
  fieldLabel: "[!! Pübļïç đïšpļàÿ ñàɱë !!]",
  iconLabel: "[!! Süppöřţ ğïfţ bàğ !!]",
  increase: "[!! Ïñçřëàšë ğïfţ qüàñţïţÿ !!]",
  link: "[!! Rëvïëŵ àļļ přëpàřàţïöñ àñđ đëļïvëřÿ đëţàïļš !!]",
  loadingAction: "[!! Přëpàřïñğ šëçüřë çħëçköüţ !!]",
  mediaAlt: "[!! Söüřçë-öŵñëđ àbšţřàçţ ğïfţ àřţŵöřk !!]",
  mediaErrorAction: "[!! Sħöŵ ţħë ëxpàñđëđ ïɱàğë ëřřöř fàļļbàçk !!]",
  mediaFallback: "[!! Gïfţ àřţŵöřk ïš ţëɱpöřàřïļÿ üñàvàïļàbļë !!]",
  quantity: "[!! Gïfţ qüàñţïţÿ !!]",
  status: "[!! Rëàđÿ föř çàřëfüļ přëpàřàţïöñ !!]",
} satisfies UiPrimitiveCopy);

export function uiPrimitiveCopyForLocale(
  locale: DesignFoundationPreviewLocale,
): UiPrimitiveSpecimenCopy {
  const foundation = DESIGN_FOUNDATION_CASES[locale];
  return {
    controls: locale === "en-XA" ? PSEUDO_COPY : publicCopy(locale),
    fontProfile: foundation.fontProfile,
    heading: foundation.heading,
    intro: foundation.body,
    presentationLocale: locale === "en-XA" ? "en" : locale,
  };
}
