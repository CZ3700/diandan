import type {
  StorefrontNavigation,
  SupportedLocale,
} from "@fan-support/contracts";
import { decorationCopy, type DecorationCopy } from "./copy";

type NavigationLabels = {
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
  headerTitle: string;
  footerTitle: string;
  fixedControlsHint: string;
  regionHint: string;
  headerLabels: Record<StorefrontNavigation["header"][number], string>;
  footerLabels: Record<StorefrontNavigation["footer"][number]["id"], string>;
  previewViews: {
    label: string;
    options: Record<"header" | "menu" | "footer", string>;
  };
};
function navigationLabels(locale: SupportedLocale): NavigationLabels {
  switch (locale) {
    case "en":
      return {
        title: "Navigation and footer",
        intro:
          "Reorder navigation links and choose which footer sections to show.",
        reset: "Use default navigation",
        history: "Navigation publication history",
        noHistory: "Published navigation versions will appear here.",
        published: "Navigation published",
        restored: "Navigation restored",
        live: "Published navigation",
        conflict:
          "Another operator changed the navigation. Reload the latest version before continuing.",
        discard: "Leave and discard your unsaved navigation changes?",
        restoreConfirm:
          "Restore this navigation? The current navigation and its draft will be replaced. Theme, homepage layout and content stay as they are.",
        previewHint:
          "Preview published content with your navigation. Links and purchases are disabled inside the preview.",
        headerTitle: "Header and menu links",
        footerTitle: "Footer sections",
        fixedControlsHint:
          "Home, artists and gifts remain available. Language and cart controls stay in place; order lookup stays in the menu. Policy links cannot be hidden.",
        regionHint:
          "Region link visibility depends on the currently available markets and currencies. Policy links show published, available policies.",
        headerLabels: { HOME: "Home", ARTISTS: "Artists", GIFTS: "Gifts" },
        footerLabels: {
          DESCRIPTION: "Store description",
          REGION: "Region selection",
          ARTISTS: "Artists",
          GIFTS: "Gifts",
          POLICIES: "Policies",
        },
        previewViews: {
          label: "Preview area",
          options: { header: "Header", menu: "Menu", footer: "Footer" },
        },
      };
    case "zh-CN":
      return {
        title: "导航与页脚",
        intro: "调整导航顺序，选择页脚需要显示的内容。",
        reset: "使用默认导航",
        history: "导航发布历史",
        noHistory: "已发布的导航版本会显示在这里。",
        published: "导航已发布",
        restored: "导航已恢复",
        live: "已发布导航",
        conflict: "其他操作员已修改导航，请重新载入最新版本后继续。",
        discard: "离开并放弃尚未保存的导航修改？",
        restoreConfirm:
          "恢复此导航？当前导航及其草稿将被替换，全站主题、首页布局和内容保持不变。",
        previewHint: "使用已发布内容预览导航。预览内的链接和购买操作不可用。",
        headerTitle: "顶部与菜单链接",
        footerTitle: "页脚内容",
        fixedControlsHint:
          "首页、艺人和礼物始终保留。语言和购物车入口保持原位，查询订单保留在菜单中。政策链接不可隐藏。",
        regionHint:
          "地区入口是否显示，由当前可用市场和币种决定。显示已发布且可用的政策链接。",
        headerLabels: { HOME: "首页", ARTISTS: "艺人", GIFTS: "礼物" },
        footerLabels: {
          DESCRIPTION: "店铺简介",
          REGION: "地区选择",
          ARTISTS: "艺人",
          GIFTS: "礼物",
          POLICIES: "政策条款",
        },
        previewViews: {
          label: "预览区域",
          options: { header: "顶部导航", menu: "菜单", footer: "页脚" },
        },
      };
    case "ja":
      return {
        title: "ナビゲーションとフッター",
        intro: "リンクの順序とフッターの表示項目を設定します。",
        reset: "初期設定に戻す",
        history: "ナビゲーションの公開履歴",
        noHistory: "公開したナビゲーションがここに表示されます。",
        published: "ナビゲーションを公開しました",
        restored: "ナビゲーションを復元しました",
        live: "公開中のナビゲーション",
        conflict: "別の担当者が変更しました。最新版を再読み込みしてください。",
        discard: "未保存のナビゲーション変更を破棄して移動しますか？",
        restoreConfirm:
          "このナビゲーションを復元しますか？現在の設定と下書きを置き換えます。テーマ、ホームの構成、コンテンツは変わりません。",
        previewHint:
          "公開済みコンテンツで確認します。プレビュー内のリンクと購入は無効です。",
        headerTitle: "ヘッダーとメニューのリンク",
        footerTitle: "フッターの項目",
        fixedControlsHint:
          "ホーム、アーティスト、ギフトは常に表示します。言語とカートの位置は固定され、注文確認はメニュー内に残ります。ポリシーは非表示にできません。",
        regionHint:
          "地域選択の表示は、現在利用可能な市場と通貨によって決まります。公開済みで利用可能なポリシーへのリンクを表示します。",
        headerLabels: {
          HOME: "ホーム",
          ARTISTS: "アーティスト",
          GIFTS: "ギフト",
        },
        footerLabels: {
          DESCRIPTION: "ストア紹介",
          REGION: "地域選択",
          ARTISTS: "アーティスト",
          GIFTS: "ギフト",
          POLICIES: "ポリシー",
        },
        previewViews: {
          label: "プレビュー箇所",
          options: { header: "ヘッダー", menu: "メニュー", footer: "フッター" },
        },
      };
    case "th":
      return {
        title: "เมนูนำทางและส่วนท้าย",
        intro: "จัดลำดับลิงก์และเลือกส่วนที่แสดงในส่วนท้าย",
        reset: "ใช้การนำทางเริ่มต้น",
        history: "ประวัติการเผยแพร่การนำทาง",
        noHistory: "เวอร์ชันที่เผยแพร่จะแสดงที่นี่",
        published: "เผยแพร่การนำทางแล้ว",
        restored: "คืนค่าการนำทางแล้ว",
        live: "การนำทางที่เผยแพร่",
        conflict: "ผู้ดูแลคนอื่นเปลี่ยนการนำทางแล้ว โปรดโหลดเวอร์ชันล่าสุด",
        discard: "ออกและละทิ้งการเปลี่ยนแปลงการนำทางที่ยังไม่บันทึกหรือไม่?",
        restoreConfirm:
          "คืนค่าการนำทางนี้หรือไม่? การนำทางและแบบร่างปัจจุบันจะถูกแทนที่ ธีม รูปแบบหน้าแรก และเนื้อหาจะคงเดิม",
        previewHint:
          "ดูการนำทางกับเนื้อหาที่เผยแพร่ ลิงก์และการซื้อในตัวอย่างถูกปิดใช้งาน",
        headerTitle: "ลิงก์ส่วนหัวและเมนู",
        footerTitle: "เนื้อหาส่วนท้าย",
        fixedControlsHint:
          "หน้าแรก ศิลปิน และของขวัญยังคงแสดง ภาษาและตะกร้าอยู่ที่เดิม การค้นหาคำสั่งซื้ออยู่ในเมนู และซ่อนนโยบายไม่ได้",
        regionHint:
          "การแสดงลิงก์ภูมิภาคขึ้นอยู่กับตลาดและสกุลเงินที่พร้อมใช้งานในขณะนั้น แสดงลิงก์นโยบายที่เผยแพร่และพร้อมใช้งาน",
        headerLabels: { HOME: "หน้าแรก", ARTISTS: "ศิลปิน", GIFTS: "ของขวัญ" },
        footerLabels: {
          DESCRIPTION: "คำอธิบายร้าน",
          REGION: "เลือกภูมิภาค",
          ARTISTS: "ศิลปิน",
          GIFTS: "ของขวัญ",
          POLICIES: "นโยบาย",
        },
        previewViews: {
          label: "พื้นที่ตัวอย่าง",
          options: { header: "ส่วนหัว", menu: "เมนู", footer: "ส่วนท้าย" },
        },
      };
    case "vi":
      return {
        title: "Điều hướng và chân trang",
        intro: "Sắp xếp liên kết và chọn các mục hiển thị ở chân trang.",
        reset: "Dùng điều hướng mặc định",
        history: "Lịch sử xuất bản điều hướng",
        noHistory: "Các phiên bản đã xuất bản sẽ xuất hiện ở đây.",
        published: "Đã xuất bản điều hướng",
        restored: "Đã khôi phục điều hướng",
        live: "Điều hướng đã xuất bản",
        conflict:
          "Người quản lý khác đã thay đổi điều hướng. Hãy tải lại phiên bản mới nhất.",
        discard: "Rời trang và bỏ thay đổi điều hướng chưa lưu?",
        restoreConfirm:
          "Khôi phục điều hướng này? Điều hướng và bản nháp hiện tại sẽ được thay thế. Giao diện, bố cục trang chủ và nội dung được giữ nguyên.",
        previewHint:
          "Xem điều hướng với nội dung đã xuất bản. Liên kết và mua hàng bị vô hiệu hóa trong bản xem trước.",
        headerTitle: "Liên kết đầu trang và menu",
        footerTitle: "Nội dung chân trang",
        fixedControlsHint:
          "Trang chủ, nghệ sĩ và quà tặng luôn có sẵn. Ngôn ngữ và giỏ hàng giữ nguyên vị trí; tra cứu đơn hàng nằm trong menu. Không thể ẩn chính sách.",
        regionHint:
          "Việc hiển thị liên kết khu vực phụ thuộc vào các thị trường và loại tiền tệ hiện có. Hiển thị liên kết đến các chính sách đã xuất bản và có sẵn.",
        headerLabels: {
          HOME: "Trang chủ",
          ARTISTS: "Nghệ sĩ",
          GIFTS: "Quà tặng",
        },
        footerLabels: {
          DESCRIPTION: "Giới thiệu cửa hàng",
          REGION: "Chọn khu vực",
          ARTISTS: "Nghệ sĩ",
          GIFTS: "Quà tặng",
          POLICIES: "Chính sách",
        },
        previewViews: {
          label: "Khu vực xem trước",
          options: { header: "Đầu trang", menu: "Menu", footer: "Chân trang" },
        },
      };
    case "es":
      return {
        title: "Navegación y pie de página",
        intro:
          "Ordena los enlaces y elige las secciones visibles del pie de página.",
        reset: "Usar navegación predeterminada",
        history: "Historial de navegación publicada",
        noHistory: "Las versiones publicadas aparecerán aquí.",
        published: "Navegación publicada",
        restored: "Navegación restaurada",
        live: "Navegación publicada",
        conflict:
          "Otra persona cambió la navegación. Recarga la versión más reciente.",
        discard: "¿Salir y descartar los cambios de navegación sin guardar?",
        restoreConfirm:
          "¿Restaurar esta navegación? Sustituirá la navegación y su borrador actuales. El tema, la estructura de inicio y el contenido no cambiarán.",
        previewHint:
          "Vista con contenido publicado. Los enlaces y las compras están desactivados dentro de la vista previa.",
        headerTitle: "Enlaces de cabecera y menú",
        footerTitle: "Secciones del pie de página",
        fixedControlsHint:
          "Inicio, artistas y regalos siguen disponibles. Idioma y carrito mantienen su lugar; la consulta de pedidos sigue en el menú. Las políticas no se pueden ocultar.",
        regionHint:
          "La visibilidad del enlace de región depende de los mercados y las monedas disponibles. Se muestran enlaces a las políticas publicadas y disponibles.",
        headerLabels: { HOME: "Inicio", ARTISTS: "Artistas", GIFTS: "Regalos" },
        footerLabels: {
          DESCRIPTION: "Descripción de la tienda",
          REGION: "Selección de región",
          ARTISTS: "Artistas",
          GIFTS: "Regalos",
          POLICIES: "Políticas",
        },
        previewViews: {
          label: "Área de vista previa",
          options: {
            header: "Cabecera",
            menu: "Menú",
            footer: "Pie de página",
          },
        },
      };
    case "pt":
      return {
        title: "Navegação e rodapé",
        intro: "Ordene os links e escolha as seções visíveis do rodapé.",
        reset: "Usar navegação padrão",
        history: "Histórico de navegação publicada",
        noHistory: "As versões publicadas aparecerão aqui.",
        published: "Navegação publicada",
        restored: "Navegação restaurada",
        live: "Navegação publicada",
        conflict:
          "Outra pessoa alterou a navegação. Recarregue a versão mais recente.",
        discard: "Sair e descartar as alterações de navegação não salvas?",
        restoreConfirm:
          "Restaurar esta navegação? A navegação e seu rascunho atuais serão substituídos. O tema, o layout inicial e o conteúdo permanecerão iguais.",
        previewHint:
          "Veja a navegação com conteúdo publicado. Links e compras estão desativados dentro da prévia.",
        headerTitle: "Links do cabeçalho e menu",
        footerTitle: "Seções do rodapé",
        fixedControlsHint:
          "Início, artistas e presentes continuam disponíveis. Idioma e carrinho mantêm sua posição; a consulta de pedidos fica no menu. As políticas não podem ser ocultadas.",
        regionHint:
          "A exibição do link de região depende dos mercados e das moedas disponíveis. São exibidos links para as políticas publicadas e disponíveis.",
        headerLabels: {
          HOME: "Início",
          ARTISTS: "Artistas",
          GIFTS: "Presentes",
        },
        footerLabels: {
          DESCRIPTION: "Descrição da loja",
          REGION: "Seleção de região",
          ARTISTS: "Artistas",
          GIFTS: "Presentes",
          POLICIES: "Políticas",
        },
        previewViews: {
          label: "Área de prévia",
          options: { header: "Cabeçalho", menu: "Menu", footer: "Rodapé" },
        },
      };
  }
}
export type NavigationCopy = Omit<DecorationCopy, "sections"> &
  NavigationLabels;
export function navigationCopy(locale: SupportedLocale): NavigationCopy {
  return { ...decorationCopy(locale), ...navigationLabels(locale) };
}
