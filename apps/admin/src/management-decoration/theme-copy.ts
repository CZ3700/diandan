import type {
  StorefrontPresentation,
  StorefrontTheme,
  SupportedLocale,
} from "@fan-support/contracts";
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
  heroLayout: string;
  giftLayout: string;
  motion: string;
  motionSpeed: string;
  motionHint: string;
  replayPreview: string;
  palettes: Record<StorefrontTheme["palette"], string>;
  typographyOptions: Record<StorefrontTheme["typography"], string>;
  densityOptions: Record<StorefrontTheme["density"], string>;
  cornerOptions: Record<StorefrontTheme["corners"], string>;
  heroLayoutOptions: Record<StorefrontPresentation["heroLayout"], string>;
  giftLayoutOptions: Record<StorefrontPresentation["giftLayout"], string>;
  motionOptions: Record<StorefrontPresentation["motion"], string>;
  motionSpeedOptions: Record<StorefrontPresentation["motionSpeed"], string>;
};
function themeLabels(locale: SupportedLocale): ThemeLabels {
  switch (locale) {
    case "en":
      return {
        title: "Storewide theme",
        intro:
          "Choose the storewide appearance, homepage and gift layouts, and motion.",
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
          "Restore this theme? The current theme and its draft will be replaced. Homepage section order and visibility, images, gifts and orders stay as they are.",
        previewHint:
          "Preview the theme with published content and homepage layout. Browsing and purchases are disabled here.",
        palette: "Color palette",
        advanced: "Layout, text and motion",
        typography: "Text size",
        density: "Content spacing",
        corners: "Corners",
        heroLayout: "Homepage hero layout",
        giftLayout: "Gift display",
        motion: "Motion",
        motionSpeed: "Motion speed",
        motionHint:
          "Your device’s reduced motion setting always takes priority.",
        replayPreview: "Replay preview",
        heroLayoutOptions: {
          IMMERSIVE: "Immersive",
          SPLIT: "Image and text side by side",
        },
        giftLayoutOptions: { GRID: "Standard grid", SHOWCASE: "Large images" },
        motionOptions: { STANDARD: "Standard", SUBTLE: "Subtle", NONE: "Off" },
        motionSpeedOptions: { STANDARD: "Standard", QUICK: "Quick" },
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
        intro: "统一调整全站外观，以及首页海报、礼物展示与动效。",
        reset: "使用默认主题",
        history: "主题发布历史",
        noHistory: "发布后的主题会保存在这里。",
        published: "主题已发布",
        restored: "主题已恢复",
        live: "已发布主题",
        conflict: "其他人员已更新主题，请重新加载最新版本后继续。",
        discard: "离开并放弃尚未保存的主题修改？",
        restoreConfirm:
          "恢复这个主题？当前主题和主题草稿将被替换，首页区块顺序与显隐、图片、礼物和订单保持原样。",
        previewHint:
          "使用已发布的内容和首页布局预览当前主题，预览中无法跳转或购买。",
        palette: "配色",
        advanced: "布局、文字与动效",
        typography: "文字大小",
        density: "内容留白",
        corners: "圆角",
        heroLayout: "首页海报布局",
        giftLayout: "礼物展示",
        motion: "动效",
        motionSpeed: "动效速度",
        motionHint: "设备开启“减少动态效果”时，会优先遵循设备设置。",
        replayPreview: "重播预览",
        heroLayoutOptions: { IMMERSIVE: "沉浸海报", SPLIT: "图文分栏" },
        giftLayoutOptions: { GRID: "标准网格", SHOWCASE: "大图展示" },
        motionOptions: { STANDARD: "标准", SUBTLE: "轻柔", NONE: "关闭" },
        motionSpeedOptions: { STANDARD: "标准", QUICK: "快捷" },
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
        intro: "ストア全体の外観、ホームとギフトの配置、動きを調整します。",
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
          "このテーマを復元しますか？現在のテーマと下書きが置き換わります。ホームのセクション順序と表示設定、画像、ギフト、注文は変わりません。",
        previewHint:
          "公開中のコンテンツとホームの構成でテーマを確認できます。ページ移動や購入はできません。",
        palette: "配色",
        advanced: "配置・文字・動き",
        typography: "文字サイズ",
        density: "コンテンツの余白",
        corners: "角の形",
        heroLayout: "ホームのメイン画像の配置",
        giftLayout: "ギフトの表示",
        motion: "動き",
        motionSpeed: "動きの速さ",
        motionHint: "端末の「視差効果を減らす」設定が常に優先されます。",
        replayPreview: "プレビューを再生",
        heroLayoutOptions: {
          IMMERSIVE: "没入型",
          SPLIT: "画像と文字を横に配置",
        },
        giftLayoutOptions: { GRID: "標準グリッド", SHOWCASE: "大きな画像" },
        motionOptions: { STANDARD: "標準", SUBTLE: "控えめ", NONE: "オフ" },
        motionSpeedOptions: { STANDARD: "標準", QUICK: "速い" },
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
          "ปรับรูปลักษณ์ทั้งร้าน รูปแบบหน้าแรกและของขวัญ รวมถึงการเคลื่อนไหว",
        reset: "ใช้ธีมเริ่มต้น",
        history: "ประวัติการเผยแพร่ธีม",
        noHistory: "ธีมที่เผยแพร่แล้วจะแสดงที่นี่",
        published: "เผยแพร่ธีมแล้ว",
        restored: "คืนค่าธีมแล้ว",
        live: "ธีมที่เผยแพร่",
        conflict: "มีผู้ดูแลคนอื่นแก้ไขธีม โปรดโหลดเวอร์ชันล่าสุดก่อน",
        discard: "ออกจากหน้านี้และละทิ้งการแก้ไขธีมที่ยังไม่บันทึกหรือไม่?",
        restoreConfirm:
          "คืนค่าธีมนี้หรือไม่? ธีมและฉบับร่างปัจจุบันจะถูกแทนที่ ลำดับและการแสดงส่วนต่าง ๆ ของหน้าแรก รูปภาพ ของขวัญ และคำสั่งซื้อจะไม่เปลี่ยนแปลง",
        previewHint:
          "ดูธีมกับเนื้อหาและรูปแบบหน้าแรกที่เผยแพร่แล้ว ไม่สามารถเปลี่ยนหน้าหรือซื้อสินค้าในตัวอย่างได้",
        palette: "ชุดสี",
        advanced: "รูปแบบ ข้อความ และการเคลื่อนไหว",
        typography: "ขนาดข้อความ",
        density: "ระยะห่างเนื้อหา",
        corners: "รูปแบบมุม",
        heroLayout: "รูปแบบภาพหลักหน้าแรก",
        giftLayout: "การแสดงของขวัญ",
        motion: "การเคลื่อนไหว",
        motionSpeed: "ความเร็วการเคลื่อนไหว",
        motionHint: "การตั้งค่าลดการเคลื่อนไหวของอุปกรณ์จะมีผลก่อนเสมอ",
        replayPreview: "เล่นตัวอย่างอีกครั้ง",
        heroLayoutOptions: {
          IMMERSIVE: "ภาพเด่นเต็มพื้นที่",
          SPLIT: "ภาพและข้อความเคียงกัน",
        },
        giftLayoutOptions: { GRID: "ตารางมาตรฐาน", SHOWCASE: "ภาพขนาดใหญ่" },
        motionOptions: { STANDARD: "มาตรฐาน", SUBTLE: "นุ่มนวล", NONE: "ปิด" },
        motionSpeedOptions: { STANDARD: "มาตรฐาน", QUICK: "รวดเร็ว" },
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
          "Chỉnh giao diện toàn cửa hàng, bố cục trang chủ và quà tặng, cùng hiệu ứng chuyển động.",
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
          "Khôi phục giao diện này? Giao diện và bản nháp hiện tại sẽ được thay thế. Thứ tự và trạng thái hiển thị các mục trang chủ, hình ảnh, quà tặng và đơn hàng giữ nguyên.",
        previewHint:
          "Xem giao diện với nội dung và bố cục trang chủ đã xuất bản. Không thể chuyển trang hoặc mua hàng tại đây.",
        palette: "Bảng màu",
        advanced: "Bố cục, chữ và chuyển động",
        typography: "Cỡ chữ",
        density: "Khoảng cách nội dung",
        corners: "Góc",
        heroLayout: "Bố cục ảnh chính trang chủ",
        giftLayout: "Hiển thị quà tặng",
        motion: "Chuyển động",
        motionSpeed: "Tốc độ chuyển động",
        motionHint: "Cài đặt giảm chuyển động của thiết bị luôn được ưu tiên.",
        replayPreview: "Phát lại bản xem trước",
        heroLayoutOptions: {
          IMMERSIVE: "Ảnh nổi bật",
          SPLIT: "Ảnh và chữ cạnh nhau",
        },
        giftLayoutOptions: { GRID: "Lưới tiêu chuẩn", SHOWCASE: "Ảnh lớn" },
        motionOptions: {
          STANDARD: "Tiêu chuẩn",
          SUBTLE: "Nhẹ nhàng",
          NONE: "Tắt",
        },
        motionSpeedOptions: { STANDARD: "Tiêu chuẩn", QUICK: "Nhanh" },
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
          "Ajusta la apariencia de la tienda, la presentación de inicio y regalos, y el movimiento.",
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
          "¿Restaurar este tema? Sustituirá el tema y su borrador actuales. El orden y la visibilidad de las secciones de inicio, las imágenes, los regalos y los pedidos no cambiarán.",
        previewHint:
          "Tema con el contenido y la estructura de inicio publicados. Aquí no se puede navegar ni comprar.",
        palette: "Paleta de colores",
        advanced: "Diseño, texto y movimiento",
        typography: "Tamaño del texto",
        density: "Espaciado del contenido",
        corners: "Esquinas",
        heroLayout: "Presentación de la imagen principal",
        giftLayout: "Presentación de regalos",
        motion: "Movimiento",
        motionSpeed: "Velocidad del movimiento",
        motionHint:
          "La preferencia de movimiento reducido del dispositivo siempre tiene prioridad.",
        replayPreview: "Repetir vista previa",
        heroLayoutOptions: {
          IMMERSIVE: "Inmersiva",
          SPLIT: "Imagen y texto en columnas",
        },
        giftLayoutOptions: {
          GRID: "Cuadrícula estándar",
          SHOWCASE: "Imágenes grandes",
        },
        motionOptions: {
          STANDARD: "Estándar",
          SUBTLE: "Sutil",
          NONE: "Desactivado",
        },
        motionSpeedOptions: { STANDARD: "Estándar", QUICK: "Rápida" },
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
          "Ajuste a aparência da loja, a apresentação da página inicial e dos presentes, e o movimento.",
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
          "Restaurar este tema? O tema e seu rascunho atuais serão substituídos. A ordem e a visibilidade das seções da página inicial, as imagens, os presentes e os pedidos permanecerão iguais.",
        previewHint:
          "Tema com o conteúdo e layout da página inicial publicados. A navegação e as compras estão desativadas aqui.",
        palette: "Paleta de cores",
        advanced: "Layout, texto e movimento",
        typography: "Tamanho do texto",
        density: "Espaçamento do conteúdo",
        corners: "Cantos",
        heroLayout: "Apresentação da imagem principal",
        giftLayout: "Apresentação dos presentes",
        motion: "Movimento",
        motionSpeed: "Velocidade do movimento",
        motionHint:
          "A preferência de movimento reduzido do dispositivo sempre tem prioridade.",
        replayPreview: "Repetir prévia",
        heroLayoutOptions: {
          IMMERSIVE: "Imersiva",
          SPLIT: "Imagem e texto lado a lado",
        },
        giftLayoutOptions: {
          GRID: "Grade padrão",
          SHOWCASE: "Imagens grandes",
        },
        motionOptions: {
          STANDARD: "Padrão",
          SUBTLE: "Suave",
          NONE: "Desativado",
        },
        motionSpeedOptions: { STANDARD: "Padrão", QUICK: "Rápida" },
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
