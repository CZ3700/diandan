import type { StorefrontTheme, SupportedLocale } from "@fan-support/contracts";
import { decorationCopy, type DecorationCopy } from "./copy";

type ThemeLabels = {
  title: string;
  intro: string;
  reset: string;
  history: string;
  noHistory: string;
  published: string;
  restored: string;
  live: string;
  conflict: string;
  discard: string;
  restoreConfirm: string;
  previewHint: string;
  palette: string;
  advanced: string;
  typography: string;
  density: string;
  corners: string;
  palettes: Record<StorefrontTheme["palette"], string>;
  typographyOptions: Record<StorefrontTheme["typography"], string>;
  densityOptions: Record<StorefrontTheme["density"], string>;
  cornerOptions: Record<StorefrontTheme["corners"], string>;
};
function themeLabels(locale: SupportedLocale): ThemeLabels {
  switch (locale) {
    case "en":
      return {
        title: "Storewide theme",
        intro:
          "Choose the appearance used across browsing, checkout and order pages.",
        reset: "Use default theme",
        history: "Theme publication history",
        noHistory: "Your published themes will appear here.",
        published: "Theme published",
        restored: "Theme restored",
        live: "Published theme",
        conflict:
          "Another operator changed the theme. Reload the latest version before continuing.",
        discard: "Leave and discard your unsaved theme changes?",
        restoreConfirm:
          "Restore this theme? The current theme and its draft will be replaced. Homepage layout, images, gifts and orders stay as they are.",
        previewHint:
          "Preview the theme with published content and homepage layout. Browsing and purchases are disabled here.",
        palette: "Color palette",
        advanced: "Text, spacing and corners",
        typography: "Text size",
        density: "Content spacing",
        corners: "Corners",
        palettes: {
          BLACK_GOLD: "Black & gold",
          GRAPHITE_PEARL: "Graphite & pearl",
          MIDNIGHT_BLUE: "Midnight blue",
        },
        typographyOptions: { STANDARD: "Standard", LARGE: "Larger" },
        densityOptions: {
          STANDARD: "Standard",
          COMPACT: "Compact",
          AIRY: "Spacious",
        },
        cornerOptions: { SOFT: "Soft", SHARP: "Square", ROUND: "Rounded" },
      };
    case "zh-CN":
      return {
        title: "全站主题",
        intro: "统一调整浏览、结账和查单页面的外观。",
        reset: "使用默认主题",
        history: "主题发布历史",
        noHistory: "发布后的主题会保存在这里。",
        published: "主题已发布",
        restored: "主题已恢复",
        live: "已发布主题",
        conflict: "其他人员已更新主题，请重新加载最新版本后继续。",
        discard: "离开并放弃尚未保存的主题修改？",
        restoreConfirm:
          "恢复这个主题？当前主题和主题草稿将被替换，首页布局、图片、礼物和订单保持原样。",
        previewHint:
          "使用已发布的内容和首页布局预览当前主题，预览中无法跳转或购买。",
        palette: "配色",
        advanced: "文字、留白与圆角",
        typography: "文字大小",
        density: "内容留白",
        corners: "圆角",
        palettes: {
          BLACK_GOLD: "经典黑金",
          GRAPHITE_PEARL: "石墨珍珠",
          MIDNIGHT_BLUE: "午夜蓝",
        },
        typographyOptions: { STANDARD: "标准", LARGE: "较大" },
        densityOptions: { STANDARD: "标准", COMPACT: "紧凑", AIRY: "宽松" },
        cornerOptions: { SOFT: "柔和", SHARP: "方正", ROUND: "圆润" },
      };
    case "ja":
      return {
        title: "ストア全体のテーマ",
        intro: "閲覧、決済、注文確認ページの外観を統一します。",
        reset: "標準テーマに戻す",
        history: "テーマの公開履歴",
        noHistory: "公開したテーマがここに表示されます。",
        published: "テーマを公開しました",
        restored: "テーマを復元しました",
        live: "公開中のテーマ",
        conflict:
          "他の担当者がテーマを更新しました。最新の内容を読み込んでください。",
        discard: "未保存のテーマの変更を破棄して移動しますか？",
        restoreConfirm:
          "このテーマを復元しますか？現在のテーマと下書きが置き換わります。ホームの構成、画像、ギフト、注文は変わりません。",
        previewHint:
          "公開中のコンテンツとホームの構成でテーマを確認できます。ページ移動や購入はできません。",
        palette: "配色",
        advanced: "文字・余白・角",
        typography: "文字サイズ",
        density: "コンテンツの余白",
        corners: "角の形",
        palettes: {
          BLACK_GOLD: "ブラック＆ゴールド",
          GRAPHITE_PEARL: "グラファイト＆パール",
          MIDNIGHT_BLUE: "ミッドナイトブルー",
        },
        typographyOptions: { STANDARD: "標準", LARGE: "大きめ" },
        densityOptions: {
          STANDARD: "標準",
          COMPACT: "コンパクト",
          AIRY: "ゆったり",
        },
        cornerOptions: { SOFT: "やわらかい", SHARP: "四角", ROUND: "丸い" },
      };
    case "th":
      return {
        title: "ธีมทั้งร้าน",
        intro:
          "ปรับรูปแบบหน้าดูสินค้า ชำระเงิน และตรวจสอบคำสั่งซื้อให้สอดคล้องกัน",
        reset: "ใช้ธีมเริ่มต้น",
        history: "ประวัติการเผยแพร่ธีม",
        noHistory: "ธีมที่เผยแพร่แล้วจะแสดงที่นี่",
        published: "เผยแพร่ธีมแล้ว",
        restored: "คืนค่าธีมแล้ว",
        live: "ธีมที่เผยแพร่",
        conflict: "มีผู้ดูแลคนอื่นแก้ไขธีม โปรดโหลดเวอร์ชันล่าสุดก่อน",
        discard: "ออกจากหน้านี้และละทิ้งการแก้ไขธีมที่ยังไม่บันทึกหรือไม่?",
        restoreConfirm:
          "คืนค่าธีมนี้หรือไม่? ธีมและฉบับร่างปัจจุบันจะถูกแทนที่ ลำดับหน้าแรก รูปภาพ ของขวัญ และคำสั่งซื้อจะไม่เปลี่ยนแปลง",
        previewHint:
          "ดูธีมกับเนื้อหาและรูปแบบหน้าแรกที่เผยแพร่แล้ว ไม่สามารถเปลี่ยนหน้าหรือซื้อสินค้าในตัวอย่างได้",
        palette: "ชุดสี",
        advanced: "ข้อความ ระยะห่าง และมุม",
        typography: "ขนาดข้อความ",
        density: "ระยะห่างเนื้อหา",
        corners: "รูปแบบมุม",
        palettes: {
          BLACK_GOLD: "ดำและทอง",
          GRAPHITE_PEARL: "เทากราไฟต์และมุก",
          MIDNIGHT_BLUE: "น้ำเงินมิดไนต์",
        },
        typographyOptions: { STANDARD: "มาตรฐาน", LARGE: "ใหญ่ขึ้น" },
        densityOptions: {
          STANDARD: "มาตรฐาน",
          COMPACT: "กระชับ",
          AIRY: "โปร่ง",
        },
        cornerOptions: { SOFT: "นุ่มนวล", SHARP: "เหลี่ยม", ROUND: "โค้งมน" },
      };
    case "vi":
      return {
        title: "Giao diện toàn cửa hàng",
        intro:
          "Đồng bộ giao diện các trang xem hàng, thanh toán và tra cứu đơn.",
        reset: "Dùng giao diện mặc định",
        history: "Lịch sử xuất bản giao diện",
        noHistory: "Giao diện đã xuất bản sẽ hiển thị ở đây.",
        published: "Đã xuất bản giao diện",
        restored: "Đã khôi phục giao diện",
        live: "Giao diện đã xuất bản",
        conflict:
          "Người quản lý khác đã đổi giao diện. Hãy tải phiên bản mới nhất.",
        discard: "Rời trang và bỏ thay đổi giao diện chưa lưu?",
        restoreConfirm:
          "Khôi phục giao diện này? Giao diện và bản nháp hiện tại sẽ được thay thế. Bố cục trang chủ, hình ảnh, quà tặng và đơn hàng giữ nguyên.",
        previewHint:
          "Xem giao diện với nội dung và bố cục trang chủ đã xuất bản. Không thể chuyển trang hoặc mua hàng tại đây.",
        palette: "Bảng màu",
        advanced: "Chữ, khoảng cách và góc",
        typography: "Cỡ chữ",
        density: "Khoảng cách nội dung",
        corners: "Góc",
        palettes: {
          BLACK_GOLD: "Đen và vàng",
          GRAPHITE_PEARL: "Than chì và ngọc trai",
          MIDNIGHT_BLUE: "Xanh đêm",
        },
        typographyOptions: { STANDARD: "Tiêu chuẩn", LARGE: "Lớn hơn" },
        densityOptions: {
          STANDARD: "Tiêu chuẩn",
          COMPACT: "Gọn",
          AIRY: "Thoáng",
        },
        cornerOptions: { SOFT: "Mềm mại", SHARP: "Vuông", ROUND: "Bo tròn" },
      };
    case "es":
      return {
        title: "Tema de toda la tienda",
        intro:
          "Unifica la apariencia de navegación, pago y consulta de pedidos.",
        reset: "Usar tema predeterminado",
        history: "Historial de temas publicados",
        noHistory: "Los temas publicados aparecerán aquí.",
        published: "Tema publicado",
        restored: "Tema restaurado",
        live: "Tema publicado",
        conflict:
          "Otra persona actualizó el tema. Recarga la versión más reciente para continuar.",
        discard: "¿Salir y descartar los cambios de tema sin guardar?",
        restoreConfirm:
          "¿Restaurar este tema? Sustituirá el tema y su borrador actuales. La estructura de inicio, imágenes, regalos y pedidos no cambiarán.",
        previewHint:
          "Tema con el contenido y la estructura de inicio publicados. Aquí no se puede navegar ni comprar.",
        palette: "Paleta de colores",
        advanced: "Texto, espaciado y esquinas",
        typography: "Tamaño del texto",
        density: "Espaciado del contenido",
        corners: "Esquinas",
        palettes: {
          BLACK_GOLD: "Negro y oro",
          GRAPHITE_PEARL: "Grafito y perla",
          MIDNIGHT_BLUE: "Azul medianoche",
        },
        typographyOptions: { STANDARD: "Estándar", LARGE: "Más grande" },
        densityOptions: {
          STANDARD: "Estándar",
          COMPACT: "Compacto",
          AIRY: "Amplio",
        },
        cornerOptions: {
          SOFT: "Suaves",
          SHARP: "Cuadradas",
          ROUND: "Redondeadas",
        },
      };
    case "pt":
      return {
        title: "Tema de toda a loja",
        intro:
          "Unifique a aparência das páginas de navegação, pagamento e consulta de pedidos.",
        reset: "Usar tema padrão",
        history: "Histórico de temas publicados",
        noHistory: "Os temas publicados aparecerão aqui.",
        published: "Tema publicado",
        restored: "Tema restaurado",
        live: "Tema publicado",
        conflict:
          "Outra pessoa atualizou o tema. Recarregue a versão mais recente para continuar.",
        discard: "Sair e descartar as alterações de tema não salvas?",
        restoreConfirm:
          "Restaurar este tema? O tema e seu rascunho atuais serão substituídos. O layout da página inicial, imagens, presentes e pedidos permanecerão iguais.",
        previewHint:
          "Tema com o conteúdo e layout da página inicial publicados. A navegação e as compras estão desativadas aqui.",
        palette: "Paleta de cores",
        advanced: "Texto, espaçamento e cantos",
        typography: "Tamanho do texto",
        density: "Espaçamento do conteúdo",
        corners: "Cantos",
        palettes: {
          BLACK_GOLD: "Preto e dourado",
          GRAPHITE_PEARL: "Grafite e pérola",
          MIDNIGHT_BLUE: "Azul meia-noite",
        },
        typographyOptions: { STANDARD: "Padrão", LARGE: "Maior" },
        densityOptions: {
          STANDARD: "Padrão",
          COMPACT: "Compacto",
          AIRY: "Amplo",
        },
        cornerOptions: {
          SOFT: "Suaves",
          SHARP: "Quadrados",
          ROUND: "Arredondados",
        },
      };
  }
}
export type ThemeCopy = Omit<DecorationCopy, "sections"> & ThemeLabels;
export function themeCopy(locale: SupportedLocale): ThemeCopy {
  return { ...decorationCopy(locale), ...themeLabels(locale) };
}

export function decorationNavigationCopy(locale: SupportedLocale): {
  layout: string;
  theme: string;
  discard: string;
} {
  switch (locale) {
    case "en":
      return {
        layout: "Homepage layout",
        theme: "Storewide theme",
        discard: "Leave and discard your unsaved storefront changes?",
      };
    case "zh-CN":
      return {
        layout: "首页布局",
        theme: "全站主题",
        discard: "离开并放弃尚未保存的装修修改？",
      };
    case "ja":
      return {
        layout: "ホームの構成",
        theme: "ストア全体のテーマ",
        discard: "未保存のストアの変更を破棄して移動しますか？",
      };
    case "th":
      return {
        layout: "รูปแบบหน้าแรก",
        theme: "ธีมทั้งร้าน",
        discard: "ออกจากหน้านี้และละทิ้งการตกแต่งร้านที่ยังไม่บันทึกหรือไม่?",
      };
    case "vi":
      return {
        layout: "Bố cục trang chủ",
        theme: "Giao diện toàn cửa hàng",
        discard: "Rời trang và bỏ các thay đổi cửa hàng chưa lưu?",
      };
    case "es":
      return {
        layout: "Estructura de inicio",
        theme: "Tema de toda la tienda",
        discard: "¿Salir y descartar los cambios de la tienda sin guardar?",
      };
    case "pt":
      return {
        layout: "Layout da página inicial",
        theme: "Tema de toda a loja",
        discard: "Sair e descartar as alterações da loja não salvas?",
      };
  }
}
