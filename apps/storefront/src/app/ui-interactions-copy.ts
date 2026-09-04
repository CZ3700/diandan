import type { SupportedLocale } from "@fan-support/contracts";

import {
  DESIGN_FOUNDATION_CASES,
  type DesignFoundationPreviewLocale,
} from "../design-foundations";

export type InteractionOptionCopy = Readonly<{
  detail?: string;
  disabled?: boolean;
  label: string;
  value: string;
}>;

export type UiInteractionsCopy = Readonly<{
  close: string;
  dialog: Readonly<{
    body: string;
    description: string;
    title: string;
    trigger: string;
  }>;
  drawer: Readonly<{
    body: string;
    description: string;
    title: string;
    trigger: string;
  }>;
  fontProfile: string;
  heading: string;
  intro: string;
  language: string;
  menu: Readonly<{
    label: string;
    options: readonly InteractionOptionCopy[];
  }>;
  region: string;
  regionChanged: string;
  regions: readonly InteractionOptionCopy[];
  toast: Readonly<{
    close: string;
    description: string;
    title: string;
    trigger: string;
    viewport: string;
  }>;
}>;

type PublicInteractionCopy = Omit<UiInteractionsCopy, "fontProfile">;

const SHARED_REGIONS = Object.freeze([
  Object.freeze({
    detail: "Market: Americas · Currency: USD",
    label: "United States",
    value: "US",
  }),
  Object.freeze({
    detail: "Market: Canada · Currency: CAD",
    label: "Canada",
    value: "CA",
  }),
  Object.freeze({
    detail: "Market: Brazil · Currency: BRL",
    label: "Brasil",
    value: "BR",
  }),
]) satisfies readonly InteractionOptionCopy[];

function publicCopy(locale: SupportedLocale): PublicInteractionCopy {
  switch (locale) {
    case "en":
      return {
        close: "Close",
        dialog: {
          body: "Keyboard focus stays inside this focused layer until it closes.",
          description: "A quiet surface for a short, deliberate decision.",
          title: "Review this support detail",
          trigger: "Open dialog",
        },
        drawer: {
          body: "The background remains still while this edge panel is open.",
          description: "A compact mobile-ready surface without cart behavior.",
          title: "Interaction drawer",
          trigger: "Open drawer",
        },
        heading: "Calm layers for confident choices.",
        intro:
          "Dialog, drawer, menu, toast, and independent language and region controls share one restrained interaction system.",
        language: "Language",
        menu: {
          label: "Preview density",
          options: [
            { label: "Comfortable", value: "comfortable" },
            { label: "Compact", value: "compact" },
            { disabled: true, label: "Unavailable", value: "unavailable" },
          ],
        },
        region: "Region",
        regionChanged: "Region selection updated",
        regions: SHARED_REGIONS,
        toast: {
          close: "Dismiss notification",
          description: "This confirmation is announced without moving focus.",
          title: "Preference preview saved",
          trigger: "Create notification",
          viewport: "Notifications",
        },
      };
    case "zh-CN":
      return {
        close: "关闭",
        dialog: {
          body: "在弹层关闭前，键盘焦点会始终留在当前操作范围内。",
          description: "用克制的弹层完成一次简短且明确的确认。",
          title: "确认这项应援信息",
          trigger: "打开对话框",
        },
        drawer: {
          body: "边缘面板打开时，背景内容会保持静止且无法误触。",
          description: "这里只验证移动端抽屉原语，不包含真实购物车功能。",
          title: "交互抽屉",
          trigger: "打开抽屉",
        },
        heading: "让每一次选择都清晰而从容。",
        intro:
          "对话框、抽屉、菜单、通知，以及独立的语言和地区控件，共用一套克制的交互系统。更改展示语言不会重建购物车或支付状态。",
        language: "语言",
        menu: {
          label: "预览密度",
          options: [
            { label: "舒适", value: "comfortable" },
            { label: "紧凑", value: "compact" },
            { disabled: true, label: "暂不可用", value: "unavailable" },
          ],
        },
        region: "地区",
        regionChanged: "地区选择已更新",
        regions: SHARED_REGIONS,
        toast: {
          close: "关闭通知",
          description: "这条确认消息会被读屏宣告，但不会抢走当前焦点。",
          title: "偏好预览已保存",
          trigger: "创建通知",
          viewport: "通知",
        },
      };
    case "th":
      return {
        close: "ปิด",
        dialog: {
          body: "โฟกัสของแป้นพิมพ์จะอยู่ภายในชั้นนี้จนกว่าจะปิด",
          description: "พื้นผิวที่สงบสำหรับการตัดสินใจสั้น ๆ อย่างตั้งใจ",
          title: "ตรวจสอบรายละเอียดการสนับสนุน",
          trigger: "เปิดกล่องโต้ตอบ",
        },
        drawer: {
          body: "พื้นหลังจะอยู่นิ่งและไม่ถูกแตะโดยไม่ได้ตั้งใจขณะที่แผงเปิดอยู่",
          description: "ตัวอย่างแผงสำหรับมือถือโดยยังไม่มีพฤติกรรมตะกร้าจริง",
          title: "แผงการโต้ตอบ",
          trigger: "เปิดแผง",
        },
        heading: "ทุกการเลือกชัดเจนและมั่นใจ",
        intro:
          "กล่องโต้ตอบ แผง เมนู การแจ้งเตือน และตัวเลือกภาษาและภูมิภาคที่แยกจากกันใช้ระบบเดียวกัน",
        language: "ภาษา",
        menu: {
          label: "ความหนาแน่นของตัวอย่าง",
          options: [
            { label: "สบาย", value: "comfortable" },
            { label: "กะทัดรัด", value: "compact" },
            { disabled: true, label: "ยังไม่พร้อม", value: "unavailable" },
          ],
        },
        region: "ภูมิภาค",
        regionChanged: "อัปเดตภูมิภาคแล้ว",
        regions: SHARED_REGIONS,
        toast: {
          close: "ปิดการแจ้งเตือน",
          description: "ข้อความยืนยันนี้จะถูกประกาศโดยไม่ย้ายโฟกัส",
          title: "บันทึกตัวอย่างการตั้งค่าแล้ว",
          trigger: "สร้างการแจ้งเตือน",
          viewport: "การแจ้งเตือน",
        },
      };
    case "vi":
      return {
        close: "Đóng",
        dialog: {
          body: "Tiêu điểm bàn phím luôn ở trong lớp này cho đến khi đóng.",
          description: "Một bề mặt yên tĩnh cho quyết định ngắn và rõ ràng.",
          title: "Xem lại chi tiết ủng hộ",
          trigger: "Mở hộp thoại",
        },
        drawer: {
          body: "Nội dung nền đứng yên khi bảng ở cạnh màn hình đang mở.",
          description:
            "Bảng nhỏ gọn cho di động, chưa có hành vi giỏ hàng thật.",
          title: "Ngăn tương tác",
          trigger: "Mở ngăn",
        },
        heading: "Những lớp tương tác nhẹ nhàng cho lựa chọn tự tin.",
        intro:
          "Hộp thoại, ngăn, trình đơn, thông báo cùng bộ chọn ngôn ngữ và khu vực độc lập dùng chung một hệ thống nhất quán.",
        language: "Ngôn ngữ",
        menu: {
          label: "Mật độ xem trước",
          options: [
            { label: "Thoải mái", value: "comfortable" },
            { label: "Gọn", value: "compact" },
            { disabled: true, label: "Chưa khả dụng", value: "unavailable" },
          ],
        },
        region: "Khu vực",
        regionChanged: "Đã cập nhật khu vực",
        regions: SHARED_REGIONS,
        toast: {
          close: "Đóng thông báo",
          description: "Xác nhận này được đọc mà không di chuyển tiêu điểm.",
          title: "Đã lưu bản xem trước tùy chọn",
          trigger: "Tạo thông báo",
          viewport: "Thông báo",
        },
      };
    case "ja":
      return {
        close: "閉じる",
        dialog: {
          body: "閉じるまで、キーボードフォーカスはこのレイヤー内に保たれます。",
          description: "短く明確な判断に集中できる、落ち着いた表示です。",
          title: "応援情報を確認する",
          trigger: "ダイアログを開く",
        },
        drawer: {
          body: "パネルが開いている間、背景は固定され誤操作を防ぎます。",
          description:
            "実際のカート機能を含まない、モバイル向けの確認用表示です。",
          title: "操作ドロワー",
          trigger: "ドロワーを開く",
        },
        heading: "迷わず選べる、静かな操作レイヤー。",
        intro:
          "ダイアログ、ドロワー、メニュー、通知、独立した言語と地域の選択を一貫した仕組みで整えます。",
        language: "言語",
        menu: {
          label: "表示密度",
          options: [
            { label: "ゆったり", value: "comfortable" },
            { label: "コンパクト", value: "compact" },
            { disabled: true, label: "利用不可", value: "unavailable" },
          ],
        },
        region: "地域",
        regionChanged: "地域を更新しました",
        regions: SHARED_REGIONS,
        toast: {
          close: "通知を閉じる",
          description: "現在のフォーカスを移動せずに確認内容を読み上げます。",
          title: "設定プレビューを保存しました",
          trigger: "通知を作成",
          viewport: "通知",
        },
      };
    case "es":
      return {
        close: "Cerrar",
        dialog: {
          body: "El foco del teclado permanece dentro de esta capa hasta que se cierre.",
          description:
            "Una superficie tranquila para una decisión breve y deliberada.",
          title: "Revisar este detalle de apoyo",
          trigger: "Abrir el cuadro de diálogo",
        },
        drawer: {
          body: "El fondo permanece inmóvil mientras este panel lateral está abierto.",
          description:
            "Una superficie compacta para móvil sin funciones reales del carrito.",
          title: "Panel de interacción",
          trigger: "Abrir el panel lateral",
        },
        heading: "Capas serenas para tomar decisiones con confianza.",
        intro:
          "El diálogo, el panel, el menú, las notificaciones y los controles independientes de idioma y región comparten un sistema de interacción sobrio.",
        language: "Idioma",
        menu: {
          label: "Densidad de la vista previa",
          options: [
            { label: "Cómoda", value: "comfortable" },
            { label: "Compacta", value: "compact" },
            { disabled: true, label: "No disponible", value: "unavailable" },
          ],
        },
        region: "Región",
        regionChanged: "Selección de región actualizada",
        regions: SHARED_REGIONS,
        toast: {
          close: "Descartar notificación",
          description:
            "Esta confirmación se anuncia sin desplazar el foco actual.",
          title: "Vista previa de preferencias guardada",
          trigger: "Crear una notificación",
          viewport: "Notificaciones",
        },
      };
    case "pt":
      return {
        close: "Fechar",
        dialog: {
          body: "O foco do teclado permanece nesta camada até que ela seja fechada.",
          description:
            "Uma superfície tranquila para uma decisão breve e intencional.",
          title: "Revisar este detalhe de apoio",
          trigger: "Abrir a caixa de diálogo",
        },
        drawer: {
          body: "O conteúdo ao fundo permanece parado enquanto este painel lateral está aberto.",
          description:
            "Uma superfície compacta para celular sem comportamento real de carrinho.",
          title: "Painel de interação",
          trigger: "Abrir o painel lateral",
        },
        heading: "Camadas serenas para escolhas feitas com confiança.",
        intro:
          "Caixa de diálogo, painel, menu, notificações e controles independentes de idioma e região compartilham um sistema de interação discreto.",
        language: "Idioma",
        menu: {
          label: "Densidade da visualização",
          options: [
            { label: "Confortável", value: "comfortable" },
            { label: "Compacta", value: "compact" },
            { disabled: true, label: "Indisponível", value: "unavailable" },
          ],
        },
        region: "Região",
        regionChanged: "Seleção de região atualizada",
        regions: SHARED_REGIONS,
        toast: {
          close: "Dispensar notificação",
          description:
            "Esta confirmação é anunciada sem deslocar o foco atual.",
          title: "Visualização das preferências salva",
          trigger: "Criar uma notificação",
          viewport: "Notificações",
        },
      };
    default: {
      const exhaustiveLocale: never = locale;
      return exhaustiveLocale;
    }
  }
}

const PSEUDO_COPY = Object.freeze({
  close: "[!! Çļöšë !!]",
  dialog: Object.freeze({
    body: "[!! Këÿböàřđ föçüš řëɱàïñš ïñšïđë ţħïš föçüšëđ ļàÿëř üñţïļ ïţ çļöšëš !!]",
    description: "[!! À qüïëţ šüřfàçë föř à šħöřţ àñđ đëļïbëřàţë đëçïšïöñ !!]",
    title: "[!! Rëvïëŵ ţħïš šüppöřţ đëţàïļ !!]",
    trigger: "[!! Öpëñ đïàļöğ !!]",
  }),
  drawer: Object.freeze({
    body: "[!! Ţħë bàçkğřöüñđ řëɱàïñš šţïļļ ŵħïļë ţħïš ëđğë pàñëļ ïš öpëñ !!]",
    description: "[!! À çöɱpàçţ ɱöbïļë-řëàđÿ šüřfàçë ŵïţħöüţ çàřţ bëħàvïöř !!]",
    title: "[!! Ïñţëřàçţïöñ đřàŵëř !!]",
    trigger: "[!! Öpëñ đřàŵëř !!]",
  }),
  heading: "[!! Ïñţëřàçţïöñ ļàÿëřš ŵïţħ ëxpàñđëđ ļàbëļš !!]",
  intro:
    "[!! Đïàļöğ, đřàŵëř, ɱëñü, ţöàšţ, àñđ ïñđëpëñđëñţ ļàñğüàğë àñđ řëğïöñ çöñţřöļš šħàřë öñë řëšţřàïñëđ šÿšţëɱ !!]",
  language: "[!! Ļàñğüàğë !!]",
  menu: Object.freeze({
    label: "[!! Přëvïëŵ đëñšïţÿ !!]",
    options: Object.freeze([
      Object.freeze({ label: "[!! Çöɱföřţàbļë !!]", value: "comfortable" }),
      Object.freeze({ label: "[!! Çöɱpàçţ !!]", value: "compact" }),
      Object.freeze({
        disabled: true,
        label: "[!! Üñàvàïļàbļë !!]",
        value: "unavailable",
      }),
    ]),
  }),
  region: "[!! Rëğïöñ !!]",
  regionChanged: "[!! Rëğïöñ šëļëçţïöñ üpđàţëđ !!]",
  regions: SHARED_REGIONS,
  toast: Object.freeze({
    close: "[!! Đïšɱïšš ñöţïfïçàţïöñ !!]",
    description: "[!! Ţħïš çöñfïřɱàţïöñ ïš àññöüñçëđ ŵïţħöüţ ɱövïñğ föçüš !!]",
    title: "[!! Přëfëřëñçë přëvïëŵ šàvëđ !!]",
    trigger: "[!! Çřëàţë ñöţïfïçàţïöñ !!]",
    viewport: "[!! Ñöţïfïçàţïöñš !!]",
  }),
} satisfies PublicInteractionCopy);

export function uiInteractionsCopyForLocale(
  locale: DesignFoundationPreviewLocale,
): UiInteractionsCopy {
  return {
    ...(locale === "en-XA" ? PSEUDO_COPY : publicCopy(locale)),
    fontProfile: DESIGN_FOUNDATION_CASES[locale].fontProfile,
  };
}
