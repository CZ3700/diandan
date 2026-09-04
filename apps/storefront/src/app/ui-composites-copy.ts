import type { SupportedLocale } from "@fan-support/contracts";

import {
  DESIGN_FOUNDATION_CASES,
  type DesignFoundationPreviewLocale,
} from "../design-foundations";

export type UiCompositesCopy = Readonly<{
  action: string;
  accepting: string;
  cartTitle: string;
  changeIdol: string;
  contextLabel: string;
  decreaseQuantity: string;
  delivered: string;
  editNote: string;
  emptyDescription: string;
  emptyTitle: string;
  errorDescription: string;
  errorTitle: string;
  forLabel: string;
  giftAlt: string;
  giftFallback: string;
  giftRemoved: string;
  giftSubtitle: string;
  giftTitle: string;
  heroDescription: string;
  heroAlt: string;
  heroEyebrow: string;
  heroFallback: string;
  heroHeading: string;
  imageUnavailable: string;
  increaseQuantity: string;
  intro: string;
  loading: string;
  lowStock: string;
  noteAdded: string;
  noNote: string;
  orderProgress: string;
  paid: string;
  paused: string;
  portraitAlt: string;
  portraitFallback: string;
  preparing: string;
  quantity: string;
  removeGift: string;
  restoreGift: string;
  selected: string;
  stateCompleted: string;
  stateCurrent: string;
  stateUpcoming: string;
  unavailable: string;
}>;

export type UiCompositesSpecimenCopy = Readonly<{
  copy: UiCompositesCopy;
  fontProfile: string;
  presentationLocale: SupportedLocale;
}>;

const ENGLISH_COPY = Object.freeze({
  action: "Choose a support gift",
  accepting: "Accepting gifts",
  cartTitle: "Your selected gift",
  changeIdol: "Change idol",
  contextLabel: "Gift for",
  decreaseQuantity: "Decrease quantity",
  delivered: "Delivered to the idol",
  editNote: "Edit private note",
  emptyDescription: "There is nothing to show here yet.",
  emptyTitle: "No content yet",
  errorDescription: "Please try this section again shortly.",
  errorTitle: "This section is unavailable",
  forLabel: "For",
  giftAlt: "Navy keepsake gift with ivory ribbon and dried flowers",
  giftFallback: "Gift image is temporarily unavailable",
  giftRemoved: "Gift removed from this preview cart",
  giftSubtitle: "Prepared and delivered by our team",
  giftTitle: "Midnight keepsake",
  heroAlt: "Fictional performer Mira Vale beside blue and ivory flowers",
  heroDescription: "Send a thoughtful gift prepared with care.",
  heroEyebrow: "For Mira Vale",
  heroFallback: "Featured performer image is temporarily unavailable",
  heroHeading: "Make the moment feel close",
  imageUnavailable: "Image unavailable",
  increaseQuantity: "Increase quantity",
  intro:
    "A product-code specimen for media-led selection, cart context and fulfillment progress.",
  loading: "Loading this component",
  lowStock: "Only a few remain",
  noteAdded: "Private note added",
  noNote: "No private note added",
  orderProgress: "Order progress",
  paid: "Payment confirmed",
  paused: "Gifts paused",
  portraitAlt: "Portrait of the fictional performer Mira Vale",
  portraitFallback: "Performer portrait is temporarily unavailable",
  preparing: "Preparing your gift",
  quantity: "Quantity",
  removeGift: "Remove gift",
  restoreGift: "Restore gift",
  selected: "Selected idol",
  stateCompleted: "Completed",
  stateCurrent: "In progress",
  stateUpcoming: "Next",
  unavailable: "Currently unavailable",
} satisfies UiCompositesCopy);

function publicCopy(locale: SupportedLocale): UiCompositesCopy {
  switch (locale) {
    case "en":
      return ENGLISH_COPY;
    case "zh-CN":
      return {
        action: "选择应援礼物",
        accepting: "正在接收礼物",
        cartTitle: "你选择的礼物",
        changeIdol: "更换偶像",
        contextLabel: "送给",
        decreaseQuantity: "减少数量",
        delivered: "已送达偶像",
        editNote: "编辑私密留言",
        emptyDescription: "这里暂时还没有可展示的内容。",
        emptyTitle: "暂无内容",
        errorDescription: "请稍后重新加载这个区域。",
        errorTitle: "暂时无法显示这个区域",
        forLabel: "送给",
        giftAlt: "配有象牙白缎带和干花的深蓝色纪念礼盒",
        giftFallback: "暂时无法显示礼物图片",
        giftRemoved: "已从预览购物车中移除礼物",
        giftSubtitle: "由我们的团队认真准备并送达",
        giftTitle: "午夜纪念礼盒",
        heroAlt: "虚构艺人 Mira Vale 与蓝白色花朵同框",
        heroDescription: "送出一份由团队认真准备的心意礼物。",
        heroEyebrow: "为 Mira Vale 应援",
        heroFallback: "暂时无法显示精选艺人图片",
        heroHeading: "让这一刻更贴近彼此",
        imageUnavailable: "图片不可用",
        increaseQuantity: "增加数量",
        intro: "用于验证人物选择、礼物归属、购物车与履约进度的产品组件样板。",
        loading: "正在加载组件",
        lowStock: "仅剩少量",
        noteAdded: "已添加私密留言",
        noNote: "未添加私密留言",
        orderProgress: "订单进度",
        paid: "付款已确认",
        paused: "暂不接收礼物",
        portraitAlt: "虚构艺人 Mira Vale 的肖像",
        portraitFallback: "暂时无法显示艺人肖像",
        preparing: "正在准备礼物",
        quantity: "数量",
        removeGift: "移除礼物",
        restoreGift: "恢复礼物",
        selected: "已选择的偶像",
        stateCompleted: "已完成",
        stateCurrent: "进行中",
        stateUpcoming: "下一步",
        unavailable: "暂时不可用",
      };
    case "ja":
      return {
        action: "応援ギフトを選ぶ",
        accepting: "ギフト受付中",
        cartTitle: "選択したギフト",
        changeIdol: "アイドルを変更",
        contextLabel: "贈り先",
        decreaseQuantity: "数量を減らす",
        delivered: "アイドルにお届け済み",
        editNote: "非公開メッセージを編集",
        emptyDescription: "現在表示できる内容はありません。",
        emptyTitle: "まだ内容がありません",
        errorDescription: "しばらくしてからもう一度お試しください。",
        errorTitle: "このセクションを表示できません",
        forLabel: "贈り先",
        giftAlt: "アイボリーのリボンとドライフラワーを添えた紺色の記念ギフト",
        giftFallback: "ギフト画像を一時的に表示できません",
        giftRemoved: "プレビューカートからギフトを削除しました",
        giftSubtitle: "チームが丁寧に準備してお届けします",
        giftTitle: "ミッドナイト記念ギフト",
        heroAlt: "青とアイボリーの花と並ぶ架空のアーティスト Mira Vale",
        heroDescription: "心を込めて準備する応援ギフトを贈りましょう。",
        heroEyebrow: "Mira Vale へ",
        heroFallback: "注目アーティストの画像を一時的に表示できません",
        heroHeading: "この瞬間をもっと近くに",
        imageUnavailable: "画像を表示できません",
        increaseQuantity: "数量を増やす",
        intro:
          "人物選択、ギフトの帰属、カート、配送進捗を確認する製品コンポーネント見本です。",
        loading: "コンポーネントを読み込んでいます",
        lowStock: "残りわずか",
        noteAdded: "非公開メッセージを追加済み",
        noNote: "非公開メッセージなし",
        orderProgress: "注文の進捗",
        paid: "お支払い確認済み",
        paused: "ギフト受付停止中",
        portraitAlt: "架空のアーティスト Mira Vale のポートレート",
        portraitFallback: "アーティストの肖像を一時的に表示できません",
        preparing: "ギフトを準備中",
        quantity: "数量",
        removeGift: "ギフトを削除",
        restoreGift: "ギフトを復元",
        selected: "選択中のアイドル",
        stateCompleted: "完了",
        stateCurrent: "進行中",
        stateUpcoming: "次の工程",
        unavailable: "現在利用できません",
      };
    case "th":
      return {
        action: "เลือกของขวัญสนับสนุน",
        accepting: "กำลังรับของขวัญ",
        cartTitle: "ของขวัญที่คุณเลือก",
        changeIdol: "เปลี่ยนศิลปิน",
        contextLabel: "ของขวัญสำหรับ",
        decreaseQuantity: "ลดจำนวน",
        delivered: "ส่งถึงศิลปินแล้ว",
        editNote: "แก้ไขข้อความส่วนตัว",
        emptyDescription: "ยังไม่มีเนื้อหาที่จะแสดงในส่วนนี้",
        emptyTitle: "ยังไม่มีเนื้อหา",
        errorDescription: "โปรดลองเปิดส่วนนี้อีกครั้งในภายหลัง",
        errorTitle: "ไม่สามารถแสดงส่วนนี้ได้",
        forLabel: "สำหรับ",
        giftAlt: "ของขวัญที่ระลึกสีน้ำเงินพร้อมริบบิ้นสีงาช้างและดอกไม้แห้ง",
        giftFallback: "ไม่สามารถแสดงภาพของขวัญได้ชั่วคราว",
        giftRemoved: "นำของขวัญออกจากตะกร้าตัวอย่างแล้ว",
        giftSubtitle: "ทีมงานของเราจัดเตรียมและนำส่งอย่างพิถีพิถัน",
        giftTitle: "กล่องที่ระลึกยามเที่ยงคืน",
        heroAlt: "ศิลปินสมมติ Mira Vale กับดอกไม้สีน้ำเงินและงาช้าง",
        heroDescription: "ส่งของขวัญแทนใจที่ทีมงานจัดเตรียมอย่างใส่ใจ",
        heroEyebrow: "เพื่อ Mira Vale",
        heroFallback: "ไม่สามารถแสดงภาพศิลปินเด่นได้ชั่วคราว",
        heroHeading: "ทำให้ช่วงเวลานี้ใกล้กันยิ่งขึ้น",
        imageUnavailable: "ไม่สามารถแสดงภาพได้",
        increaseQuantity: "เพิ่มจำนวน",
        intro:
          "ตัวอย่างคอมโพเนนต์ผลิตภัณฑ์สำหรับการเลือกศิลปิน บริบทตะกร้า และความคืบหน้าการจัดส่ง",
        loading: "กำลังโหลดคอมโพเนนต์",
        lowStock: "เหลือเพียงเล็กน้อย",
        noteAdded: "เพิ่มข้อความส่วนตัวแล้ว",
        noNote: "ยังไม่มีข้อความส่วนตัว",
        orderProgress: "ความคืบหน้าของคำสั่งซื้อ",
        paid: "ยืนยันการชำระเงินแล้ว",
        paused: "หยุดรับของขวัญชั่วคราว",
        portraitAlt: "ภาพบุคคลของศิลปินสมมติ Mira Vale",
        portraitFallback: "ไม่สามารถแสดงภาพศิลปินได้ชั่วคราว",
        preparing: "กำลังจัดเตรียมของขวัญ",
        quantity: "จำนวน",
        removeGift: "นำของขวัญออก",
        restoreGift: "นำของขวัญกลับคืน",
        selected: "ศิลปินที่เลือก",
        stateCompleted: "เสร็จแล้ว",
        stateCurrent: "กำลังดำเนินการ",
        stateUpcoming: "ขั้นตอนถัดไป",
        unavailable: "ยังไม่พร้อมใช้งาน",
      };
    case "vi":
      return {
        action: "Chọn quà ủng hộ",
        accepting: "Đang nhận quà",
        cartTitle: "Món quà bạn đã chọn",
        changeIdol: "Đổi nghệ sĩ",
        contextLabel: "Quà dành cho",
        decreaseQuantity: "Giảm số lượng",
        delivered: "Đã trao tận tay nghệ sĩ",
        editNote: "Sửa lời nhắn riêng tư",
        emptyDescription: "Hiện chưa có nội dung để hiển thị tại đây.",
        emptyTitle: "Chưa có nội dung",
        errorDescription: "Vui lòng thử mở lại phần này sau.",
        errorTitle: "Không thể hiển thị phần này",
        forLabel: "Dành cho",
        giftAlt: "Món quà lưu niệm xanh navy với nơ trắng ngà và hoa khô",
        giftFallback: "Tạm thời không thể hiển thị ảnh món quà",
        giftRemoved: "Đã xóa món quà khỏi giỏ hàng xem trước",
        giftSubtitle: "Đội ngũ của chúng tôi chuẩn bị và trao tặng cẩn thận",
        giftTitle: "Hộp kỷ niệm đêm xanh",
        heroAlt: "Nghệ sĩ hư cấu Mira Vale bên hoa xanh lam và trắng ngà",
        heroDescription: "Gửi món quà chân thành được chuẩn bị chu đáo.",
        heroEyebrow: "Dành cho Mira Vale",
        heroFallback: "Tạm thời không thể hiển thị ảnh nghệ sĩ nổi bật",
        heroHeading: "Đưa khoảnh khắc này đến gần hơn",
        imageUnavailable: "Không thể hiển thị ảnh",
        increaseQuantity: "Tăng số lượng",
        intro:
          "Mẫu mã sản phẩm kiểm chứng việc chọn nghệ sĩ, ngữ cảnh giỏ hàng và tiến trình trao quà.",
        loading: "Đang tải thành phần",
        lowStock: "Chỉ còn một vài món",
        noteAdded: "Đã thêm lời nhắn riêng tư",
        noNote: "Chưa thêm lời nhắn riêng tư",
        orderProgress: "Tiến trình đơn hàng",
        paid: "Đã xác nhận thanh toán",
        paused: "Tạm ngừng nhận quà",
        portraitAlt: "Chân dung nghệ sĩ hư cấu Mira Vale",
        portraitFallback: "Tạm thời không thể hiển thị chân dung nghệ sĩ",
        preparing: "Đang chuẩn bị món quà",
        quantity: "Số lượng",
        removeGift: "Xóa món quà",
        restoreGift: "Khôi phục món quà",
        selected: "Nghệ sĩ đã chọn",
        stateCompleted: "Hoàn tất",
        stateCurrent: "Đang thực hiện",
        stateUpcoming: "Tiếp theo",
        unavailable: "Hiện không khả dụng",
      };
    case "es":
      return {
        action: "Elegir este regalo de apoyo cuidadosamente preparado",
        accepting: "Acepta regalos",
        cartTitle: "El regalo que has elegido",
        changeIdol: "Cambiar de artista",
        contextLabel: "Regalo para",
        decreaseQuantity: "Reducir la cantidad",
        delivered: "Entregado a la artista",
        editNote: "Editar el mensaje privado",
        emptyDescription:
          "Todavía no hay contenido disponible en esta sección.",
        emptyTitle: "Aún no hay contenido",
        errorDescription:
          "Vuelve a intentar abrir esta sección dentro de unos instantes.",
        errorTitle: "Esta sección no está disponible",
        forLabel: "Para",
        giftAlt:
          "Regalo de recuerdo azul marino con cinta marfil y flores secas",
        giftFallback: "La imagen del regalo no está disponible temporalmente",
        giftRemoved: "Regalo eliminado del carrito de demostración",
        giftSubtitle: "Nuestro equipo lo prepara y lo entrega cuidadosamente",
        giftTitle: "Recuerdo de medianoche",
        heroAlt: "Artista ficticia Mira Vale junto a flores azules y marfil",
        heroDescription:
          "Envía un regalo significativo preparado con mucho cuidado.",
        heroEyebrow: "Para Mira Vale",
        heroFallback:
          "La imagen destacada de la artista no está disponible temporalmente",
        heroHeading: "Haz que este momento se sienta más cercano",
        imageUnavailable: "Imagen no disponible",
        increaseQuantity: "Aumentar la cantidad",
        intro:
          "Muestra de componentes de producto para selección, contexto del carrito y progreso de entrega.",
        loading: "Cargando este componente",
        lowStock: "Quedan muy pocas unidades",
        noteAdded: "Mensaje privado añadido",
        noNote: "No se ha añadido ningún mensaje privado",
        orderProgress: "Progreso del pedido",
        paid: "Pago confirmado",
        paused: "Recepción de regalos pausada",
        portraitAlt: "Retrato de la artista ficticia Mira Vale",
        portraitFallback:
          "El retrato de la artista no está disponible temporalmente",
        preparing: "Preparando tu regalo",
        quantity: "Cantidad",
        removeGift: "Eliminar regalo",
        restoreGift: "Restaurar regalo",
        selected: "Artista seleccionada",
        stateCompleted: "Completado",
        stateCurrent: "En curso",
        stateUpcoming: "Siguiente",
        unavailable: "No disponible actualmente",
      };
    case "pt":
      return {
        action: "Escolher este presente de apoio cuidadosamente preparado",
        accepting: "Aceitando presentes",
        cartTitle: "O presente que você escolheu",
        changeIdol: "Escolher outra artista",
        contextLabel: "Presente para",
        decreaseQuantity: "Diminuir a quantidade",
        delivered: "Entregue à artista",
        editNote: "Editar a mensagem privada",
        emptyDescription:
          "Ainda não há conteúdo disponível para mostrar nesta seção.",
        emptyTitle: "Ainda não há conteúdo",
        errorDescription:
          "Tente abrir novamente esta seção dentro de alguns instantes.",
        errorTitle: "Esta seção não está disponível",
        forLabel: "Para",
        giftAlt:
          "Presente de lembrança azul-marinho com fita marfim e flores secas",
        giftFallback: "A imagem do presente está temporariamente indisponível",
        giftRemoved: "Presente removido do carrinho de demonstração",
        giftSubtitle: "Nossa equipe prepara e entrega tudo com muito cuidado",
        giftTitle: "Lembrança cuidadosamente preparada da meia-noite",
        heroAlt: "Artista fictícia Mira Vale ao lado de flores azuis e marfim",
        heroDescription:
          "Envie um presente cheio de significado, preparado com todo cuidado.",
        heroEyebrow: "Para Mira Vale",
        heroFallback:
          "A imagem em destaque da artista está temporariamente indisponível",
        heroHeading: "Faça este momento parecer ainda mais próximo",
        imageUnavailable: "Imagem indisponível",
        increaseQuantity: "Aumentar a quantidade",
        intro:
          "Amostra de componentes de produto para seleção, contexto do carrinho e progresso da entrega.",
        loading: "Carregando este componente",
        lowStock: "Restam apenas algumas unidades",
        noteAdded: "Mensagem privada adicionada",
        noNote: "Nenhuma mensagem privada adicionada",
        orderProgress: "Progresso do pedido",
        paid: "Pagamento confirmado",
        paused: "Recebimento de presentes pausado",
        portraitAlt: "Retrato da artista fictícia Mira Vale",
        portraitFallback:
          "O retrato da artista está temporariamente indisponível",
        preparing: "Preparando cuidadosamente o seu presente",
        quantity: "Quantidade",
        removeGift: "Remover presente",
        restoreGift: "Restaurar presente",
        selected: "Artista selecionada",
        stateCompleted: "Concluído",
        stateCurrent: "Em andamento",
        stateUpcoming: "Próxima etapa",
        unavailable: "Indisponível no momento",
      };
    default: {
      const exhaustiveLocale: never = locale;
      return exhaustiveLocale;
    }
  }
}

const PSEUDO_COPY = Object.freeze({
  action: "[!! Çħööšë à çàřëfüļļÿ přëpàřëđ šüppöřţ ğïfţ !!]",
  accepting: "[!! Àççëpţïñğ šüppöřţ ğïfţš !!]",
  cartTitle: "[!! Ÿöüř çàřëfüļļÿ šëļëçţëđ ğïfţ !!]",
  changeIdol: "[!! Çħàñğë ţħë šëļëçţëđ ïđöļ !!]",
  contextLabel: "[!! Gïfţ çàřëfüļļÿ přëpàřëđ föř !!]",
  decreaseQuantity: "[!! Đëçřëàšë ţħë ǫüàñţïţÿ !!]",
  delivered: "[!! Đëļïvëřëđ ţö ţħë ïđöļ !!]",
  editNote: "[!! Ëđïţ ţħë přïvàţë ñöţë !!]",
  emptyDescription: "[!! Ţħëřë ïš ñöţħïñğ ţö šħöŵ ħëřë ÿëţ !!]",
  emptyTitle: "[!! Ñö çöñţëñţ ïš àvàïļàbļë ÿëţ !!]",
  errorDescription: "[!! Pļëàšë ţřÿ ţħïš šëçţïöñ àğàïñ šħöřţļÿ !!]",
  errorTitle: "[!! Ţħïš šëçţïöñ ïš ţëɱpöřàřïļÿ üñàvàïļàbļë !!]",
  forLabel: "[!! Föř ţħë šëļëçţëđ ïđöļ !!]",
  giftAlt: "[!! Ñàvÿ këëpšàkë ğïƒţ ŵïţħ ïvöřÿ řïbböñ àñđ đřïëđ ƒļöŵëřš !!]",
  giftFallback: "[!! Gïfţ ïɱàğë ïš ţëɱpöřàřïļÿ üñàvàïļàbļë !!]",
  giftRemoved: "[!! Gïƒţ řëɱövëđ ƒřöɱ ţħë přëvïëŵ çàřţ !!]",
  giftSubtitle: "[!! Přëpàřëđ àñđ đëļïvëřëđ çàřëfüļļÿ bÿ öüř ţëàɱ !!]",
  giftTitle: "[!! Mïđñïğħţ këëpšàkë çëļëbřàţïöñ ğïfţ !!]",
  heroAlt:
    "[!! Fïçţïöñàļ pëřföřɱëř Mïřà Vàļë bëšïđë bļüë àñđ ïvöřÿ ƒļöŵëřš !!]",
  heroDescription: "[!! Šëñđ à ţħöüğħţfüļ ğïfţ přëpàřëđ ŵïţħ ëxţřà çàřë !!]",
  heroEyebrow: "[!! Föř Mïřà Vàļë !!]",
  heroFallback: "[!! Fëàţüřëđ pëřföřɱëř ïɱàğë ïš ţëɱpöřàřïļÿ üñàvàïļàbļë !!]",
  heroHeading: "[!! Màkë ţħïš ɱëàñïñğfüļ ɱöɱëñţ fëëļ çļöšëř !!]",
  imageUnavailable: "[!! Ïɱàğë ïš üñàvàïļàbļë !!]",
  increaseQuantity: "[!! Ïñçřëàšë ţħë ǫüàñţïţÿ !!]",
  intro:
    "[!! Àñ ëxpàñđëđ přöđüçţ-çöđë špëçïɱëñ föř šëļëçţïöñ, çàřţ çöñţëxţ àñđ füļfïļļɱëñţ přöğřëšš !!]",
  loading: "[!! Ļöàđïñğ ţħïš çöɱpöñëñţ !!]",
  lowStock: "[!! Öñļÿ à vëřÿ šɱàļļ ñüɱbëř řëɱàïñ !!]",
  noteAdded: "[!! Přïvàţë ñöţë šàfëļÿ àđđëđ !!]",
  noNote: "[!! Ñö přïvàţë ñöţë àđđëđ ÿëţ !!]",
  orderProgress: "[!! Öřđëř přëpàřàţïöñ àñđ đëļïvëřÿ přöğřëšš !!]",
  paid: "[!! Pàÿɱëñţ ïš çöñfïřɱëđ !!]",
  paused: "[!! Gïfţ řëçëïvïñğ ïš pàüšëđ !!]",
  portraitAlt: "[!! Pöřţřàïţ öƒ ƒïçţïöñàļ pëřƒöřɱëř Mïřà Vàļë !!]",
  portraitFallback: "[!! Pëřföřɱëř pöřţřàïţ ïš ţëɱpöřàřïļÿ üñàvàïļàbļë !!]",
  preparing: "[!! Přëpàřïñğ ÿöüř ğïfţ ŵïţħ çàřë !!]",
  quantity: "[!! Gïfţ ǫüàñţïţÿ !!]",
  removeGift: "[!! Rëɱövë ţħïš šëļëçţëđ ğïfţ !!]",
  restoreGift: "[!! Rëšţöřë ţħë ğïƒţ !!]",
  selected: "[!! Çüřřëñţļÿ šëļëçţëđ ïđöļ !!]",
  stateCompleted: "[!! Çöɱpļëţëđ šţàğë !!]",
  stateCurrent: "[!! Çüřřëñţļÿ ïñ přöğřëšš !!]",
  stateUpcoming: "[!! Ñëxţ üpçöɱïñğ šţàğë !!]",
  unavailable: "[!! Çüřřëñţļÿ üñàvàïļàbļë !!]",
} satisfies UiCompositesCopy);

export function uiCompositesCopyForLocale(
  locale: DesignFoundationPreviewLocale,
): UiCompositesSpecimenCopy {
  return {
    copy: locale === "en-XA" ? PSEUDO_COPY : publicCopy(locale),
    fontProfile: DESIGN_FOUNDATION_CASES[locale].fontProfile,
    presentationLocale: locale === "en-XA" ? "en" : locale,
  };
}
