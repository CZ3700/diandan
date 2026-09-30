import type {
  StorefrontPresentation,
  StorefrontDetailTemplates,
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
  heroEffect: string;
  heroEffectHint: string;
  heroEffectOptions: Record<
    NonNullable<StorefrontPresentation["heroEffect"]>,
    string
  >;
  giftLayout: string;
  artistTemplate: string;
  giftTemplate: string;
  artistTemplateOptions: Record<StorefrontDetailTemplates["artist"], string>;
  giftTemplateOptions: Record<StorefrontDetailTemplates["gift"], string>;
  previewPages: {
    label: string;
    options: Record<"home" | "artist" | "gift", string>;
    sampleHint: string;
  };
  motion: string;
  motionSpeed: string;
  motionHint: string;
  replayPreview: string;
  palettes: Record<StorefrontTheme["palette"], string>;
  paletteGroups: Record<"DARK" | "LIGHT", string>;
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
        heroEffect: "Hero motion",
        heroEffectHint:
          "Hero effects play only with Standard motion. They stay still when the device’s reduced motion setting is on.",
        heroEffectOptions: {
          STARLIGHT: "Starlight",
          AURORA: "Aurora",
          SPOTLIGHT: "Spotlight",
          PETALS: "Petals",
        },
        title: "Storewide theme",
        intro: "Choose the storewide appearance, page layouts and motion.",
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
          "Preview the theme with published content. Links and purchases are disabled inside the preview.",
        palette: "Color palette",
        advanced: "Layout, text and motion",
        typography: "Text size",
        density: "Content spacing",
        corners: "Corners",
        heroLayout: "Homepage hero layout",
        giftLayout: "Gift display",
        artistTemplate: "Artist detail layout",
        giftTemplate: "Gift detail layout",
        artistTemplateOptions: {
          IMMERSIVE: "Immersive",
          SPLIT: "Image and text side by side",
        },
        giftTemplateOptions: {
          IMAGE_LEFT: "Image on the left",
          IMAGE_RIGHT: "Image on the right",
        },
        previewPages: {
          label: "Preview page",
          options: { home: "Home", artist: "Artist", gift: "Gift" },
          sampleHint:
            "Artist and gift pages automatically use the first published item as a sample. Availability and prices reflect the actual configuration.",
        },
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
          SAKURA_PINK: "Sakura pink",
          SKY_BLUE: "Sky blue",
          IVORY_GOLD: "Ivory & gold",
          PEARL_GRAY: "Pearl gray",
        },
        paletteGroups: { DARK: "Dark", LIGHT: "Light" },
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
        heroEffect: "海报动效",
        heroEffectHint:
          "海报动效仅在“标准动效”下播放；设备开启“减少动态效果”时，海报保持静止。",
        heroEffectOptions: {
          STARLIGHT: "星光漫游",
          AURORA: "极光流动",
          SPOTLIGHT: "舞台追光",
          PETALS: "花瓣轻舞",
        },
        title: "全站主题",
        intro: "统一调整全站外观、页面布局、详情模板与动效。",
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
        previewHint: "使用已发布内容预览当前主题，预览画面内无法跳转或购买。",
        palette: "配色",
        advanced: "布局、文字与动效",
        typography: "文字大小",
        density: "内容留白",
        corners: "圆角",
        heroLayout: "首页海报布局",
        giftLayout: "礼物展示",
        artistTemplate: "艺人详情布局",
        giftTemplate: "礼物详情布局",
        artistTemplateOptions: { IMMERSIVE: "沉浸海报", SPLIT: "图文分栏" },
        giftTemplateOptions: {
          IMAGE_LEFT: "图片在左",
          IMAGE_RIGHT: "图片在右",
        },
        previewPages: {
          label: "预览页面",
          options: { home: "首页", artist: "艺人", gift: "礼物" },
          sampleHint:
            "艺人和礼物页自动选取首个已发布内容作预览样本，选购状态与价格以实际配置为准。",
        },
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
          SAKURA_PINK: "樱花粉",
          SKY_BLUE: "晴空蓝",
          IVORY_GOLD: "象牙金",
          PEARL_GRAY: "珍珠灰",
        },
        paletteGroups: { DARK: "深色", LIGHT: "浅色" },
        typographyOptions: { STANDARD: "标准", LARGE: "较大" },
        densityOptions: { STANDARD: "标准", COMPACT: "紧凑", AIRY: "宽松" },
        cornerOptions: { SOFT: "柔和", SHARP: "方正", ROUND: "圆润" },
      };
    case "ja":
      return {
        heroEffect: "メイン画像の演出",
        heroEffectHint:
          "メイン画像の動く演出は、動きが「標準」の場合のみ表示されます。端末の「動きを減らす」設定が有効な場合は静止します。",
        heroEffectOptions: {
          STARLIGHT: "星のきらめき",
          AURORA: "オーロラ",
          SPOTLIGHT: "スポットライト",
          PETALS: "舞う花びら",
        },
        title: "ストア全体のテーマ",
        intro:
          "ストア全体の外観、ページの配置、詳細テンプレートと動きを調整します。",
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
          "公開中のコンテンツでテーマを確認できます。プレビュー内のリンクや購入操作は無効です。",
        palette: "配色",
        advanced: "配置・文字・動き",
        typography: "文字サイズ",
        density: "コンテンツの余白",
        corners: "角の形",
        heroLayout: "ホームのメイン画像の配置",
        giftLayout: "ギフトの表示",
        artistTemplate: "アーティスト詳細の配置",
        giftTemplate: "ギフト詳細の配置",
        artistTemplateOptions: {
          IMMERSIVE: "没入型",
          SPLIT: "画像と文字を横に配置",
        },
        giftTemplateOptions: {
          IMAGE_LEFT: "画像を左に配置",
          IMAGE_RIGHT: "画像を右に配置",
        },
        previewPages: {
          label: "プレビューページ",
          options: { home: "ホーム", artist: "アーティスト", gift: "ギフト" },
          sampleHint:
            "アーティストとギフトのページには、最初の公開済みコンテンツを自動で使用します。購入可否と価格は実際の設定を反映します。",
        },
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
          SAKURA_PINK: "サクラピンク",
          SKY_BLUE: "スカイブルー",
          IVORY_GOLD: "アイボリー＆ゴールド",
          PEARL_GRAY: "パールグレー",
        },
        paletteGroups: { DARK: "ダーク系", LIGHT: "ライト系" },
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
        heroEffect: "เอฟเฟกต์ภาพหลัก",
        heroEffectHint:
          "เอฟเฟกต์ภาพหลักจะเคลื่อนไหวเฉพาะเมื่อเลือกการเคลื่อนไหวแบบ “มาตรฐาน” หากอุปกรณ์เปิดการลดการเคลื่อนไหว ภาพจะอยู่นิ่ง",
        heroEffectOptions: {
          STARLIGHT: "แสงดาวระยิบระยับ",
          AURORA: "แสงออโรรา",
          SPOTLIGHT: "สปอตไลต์",
          PETALS: "กลีบดอกไม้พลิ้วไหว",
        },
        title: "ธีมทั้งร้าน",
        intro:
          "ปรับรูปลักษณ์ทั้งร้าน รูปแบบหน้าเว็บ หน้ารายละเอียด และการเคลื่อนไหว",
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
          "ดูธีมกับเนื้อหาที่เผยแพร่แล้ว ลิงก์และการซื้อสินค้าในภาพตัวอย่างถูกปิดไว้",
        palette: "ชุดสี",
        advanced: "รูปแบบ ข้อความ และการเคลื่อนไหว",
        typography: "ขนาดข้อความ",
        density: "ระยะห่างเนื้อหา",
        corners: "รูปแบบมุม",
        heroLayout: "รูปแบบภาพหลักหน้าแรก",
        giftLayout: "การแสดงของขวัญ",
        artistTemplate: "รูปแบบหน้ารายละเอียดศิลปิน",
        giftTemplate: "รูปแบบหน้ารายละเอียดของขวัญ",
        artistTemplateOptions: {
          IMMERSIVE: "ภาพเด่นเต็มพื้นที่",
          SPLIT: "ภาพและข้อความเคียงกัน",
        },
        giftTemplateOptions: {
          IMAGE_LEFT: "รูปภาพทางซ้าย",
          IMAGE_RIGHT: "รูปภาพทางขวา",
        },
        previewPages: {
          label: "หน้าตัวอย่าง",
          options: { home: "หน้าแรก", artist: "ศิลปิน", gift: "ของขวัญ" },
          sampleHint:
            "หน้าศิลปินและของขวัญใช้เนื้อหาที่เผยแพร่รายการแรกเป็นตัวอย่างโดยอัตโนมัติ สถานะการซื้อและราคาเป็นไปตามการตั้งค่าจริง",
        },
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
          SAKURA_PINK: "ชมพูซากุระ",
          SKY_BLUE: "ฟ้าใส",
          IVORY_GOLD: "งาช้างและทอง",
          PEARL_GRAY: "เทามุก",
        },
        paletteGroups: { DARK: "โทนเข้ม", LIGHT: "โทนอ่อน" },
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
        heroEffect: "Hiệu ứng ảnh chính",
        heroEffectHint:
          "Hiệu ứng ảnh chính chỉ chuyển động khi chọn chế độ “Tiêu chuẩn”. Nếu thiết bị bật giảm chuyển động, ảnh sẽ đứng yên.",
        heroEffectOptions: {
          STARLIGHT: "Ánh sao",
          AURORA: "Cực quang",
          SPOTLIGHT: "Đèn sân khấu",
          PETALS: "Cánh hoa bay",
        },
        title: "Giao diện toàn cửa hàng",
        intro:
          "Chỉnh giao diện toàn cửa hàng, bố cục trang, mẫu trang chi tiết và hiệu ứng chuyển động.",
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
          "Xem giao diện với nội dung đã xuất bản. Liên kết và thao tác mua hàng trong bản xem trước bị vô hiệu hóa.",
        palette: "Bảng màu",
        advanced: "Bố cục, chữ và chuyển động",
        typography: "Cỡ chữ",
        density: "Khoảng cách nội dung",
        corners: "Góc",
        heroLayout: "Bố cục ảnh chính trang chủ",
        giftLayout: "Hiển thị quà tặng",
        artistTemplate: "Bố cục chi tiết nghệ sĩ",
        giftTemplate: "Bố cục chi tiết quà tặng",
        artistTemplateOptions: {
          IMMERSIVE: "Ảnh nổi bật",
          SPLIT: "Ảnh và chữ cạnh nhau",
        },
        giftTemplateOptions: {
          IMAGE_LEFT: "Ảnh bên trái",
          IMAGE_RIGHT: "Ảnh bên phải",
        },
        previewPages: {
          label: "Trang xem trước",
          options: { home: "Trang chủ", artist: "Nghệ sĩ", gift: "Quà tặng" },
          sampleHint:
            "Trang nghệ sĩ và quà tặng tự động dùng mục đã xuất bản đầu tiên làm mẫu. Khả năng mua và giá phản ánh cấu hình thực tế.",
        },
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
          SAKURA_PINK: "Hồng anh đào",
          SKY_BLUE: "Xanh trời",
          IVORY_GOLD: "Ngà và vàng",
          PEARL_GRAY: "Xám ngọc trai",
        },
        paletteGroups: { DARK: "Tông tối", LIGHT: "Tông sáng" },
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
        heroEffect: "Efecto de portada",
        heroEffectHint:
          "Los efectos de portada solo se animan con el movimiento «Estándar». Permanecen estáticos si el dispositivo tiene activada la opción de reducir movimiento.",
        heroEffectOptions: {
          STARLIGHT: "Luz de estrellas",
          AURORA: "Aurora",
          SPOTLIGHT: "Focos de escenario",
          PETALS: "Pétalos",
        },
        title: "Tema de toda la tienda",
        intro:
          "Ajusta la apariencia de la tienda, los diseños de página, las plantillas de detalle y el movimiento.",
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
          "Vista del tema con contenido publicado. Los enlaces y las compras están desactivados dentro de la vista previa.",
        palette: "Paleta de colores",
        advanced: "Diseño, texto y movimiento",
        typography: "Tamaño del texto",
        density: "Espaciado del contenido",
        corners: "Esquinas",
        heroLayout: "Presentación de la imagen principal",
        giftLayout: "Presentación de regalos",
        artistTemplate: "Diseño del detalle del artista",
        giftTemplate: "Diseño del detalle del regalo",
        artistTemplateOptions: {
          IMMERSIVE: "Inmersivo",
          SPLIT: "Imagen y texto en columnas",
        },
        giftTemplateOptions: {
          IMAGE_LEFT: "Imagen a la izquierda",
          IMAGE_RIGHT: "Imagen a la derecha",
        },
        previewPages: {
          label: "Página de vista previa",
          options: { home: "Inicio", artist: "Artista", gift: "Regalo" },
          sampleHint:
            "Las páginas de artista y regalo usan automáticamente el primer contenido publicado como muestra. La disponibilidad y los precios reflejan la configuración real.",
        },
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
          SAKURA_PINK: "Rosa sakura",
          SKY_BLUE: "Azul cielo",
          IVORY_GOLD: "Marfil y oro",
          PEARL_GRAY: "Gris perla",
        },
        paletteGroups: { DARK: "Tonos oscuros", LIGHT: "Tonos claros" },
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
        heroEffect: "Efeito da imagem principal",
        heroEffectHint:
          "Os efeitos da imagem principal só são animados com o movimento “Padrão”. Ficam estáticos se a opção de reduzir movimento estiver ativada no dispositivo.",
        heroEffectOptions: {
          STARLIGHT: "Luz das estrelas",
          AURORA: "Aurora",
          SPOTLIGHT: "Luzes do palco",
          PETALS: "Pétalas",
        },
        title: "Tema de toda a loja",
        intro:
          "Ajuste a aparência da loja, os layouts de página, os modelos de detalhes e o movimento.",
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
          "Veja o tema com conteúdo publicado. Os links e as compras estão desativados dentro da prévia.",
        palette: "Paleta de cores",
        advanced: "Layout, texto e movimento",
        typography: "Tamanho do texto",
        density: "Espaçamento do conteúdo",
        corners: "Cantos",
        heroLayout: "Apresentação da imagem principal",
        giftLayout: "Apresentação dos presentes",
        artistTemplate: "Layout dos detalhes do artista",
        giftTemplate: "Layout dos detalhes do presente",
        artistTemplateOptions: {
          IMMERSIVE: "Imersivo",
          SPLIT: "Imagem e texto em colunas",
        },
        giftTemplateOptions: {
          IMAGE_LEFT: "Imagem à esquerda",
          IMAGE_RIGHT: "Imagem à direita",
        },
        previewPages: {
          label: "Página de prévia",
          options: { home: "Início", artist: "Artista", gift: "Presente" },
          sampleHint:
            "As páginas de artista e presente usam automaticamente o primeiro conteúdo publicado como amostra. A disponibilidade e os preços refletem a configuração real.",
        },
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
          SAKURA_PINK: "Rosa sakura",
          SKY_BLUE: "Azul-céu",
          IVORY_GOLD: "Marfim e dourado",
          PEARL_GRAY: "Cinza-pérola",
        },
        paletteGroups: { DARK: "Tons escuros", LIGHT: "Tons claros" },
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
