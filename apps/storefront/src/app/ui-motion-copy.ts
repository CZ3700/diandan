import type { SupportedLocale } from "@fan-support/contracts";
import { FONT_PROFILE_BY_LOCALE } from "@fan-support/design-tokens";

import type { DesignFoundationPreviewLocale } from "../design-foundations";

export type UiMotionCopy = Readonly<{
  addAnnouncement: string;
  addBody: string;
  addConfirmed: string;
  addError: string;
  addErrorAnnouncement: string;
  addHeading: string;
  addLabel: string;
  addPending: string;
  cartCount: string;
  fixtureDescription: string;
  fixtureLabel: string;
  heroAction: string;
  heroDescription: string;
  heroEyebrow: string;
  heroHeading: string;
  idolLegend: string;
  mediaFallback: string;
  miraAlt: string;
  miraDescription: string;
  noaAlt: string;
  noaDescription: string;
  replayHero: string;
  replaySuccess: string;
  reset: string;
  selected: string;
  showError: string;
  successDescription: string;
  successNext: string;
  successOrder: string;
  successTitle: string;
}>;

const ENGLISH_COPY = Object.freeze({
  addAnnouncement: "Midnight keepsake for Mira Vale added. Cart count",
  addBody:
    "The controlled fixture confirms the action immediately; it does not own cart or payment truth.",
  addConfirmed: "Added to cart",
  addError: "Try adding again",
  addErrorAnnouncement: "The gift could not be added. Try again.",
  addHeading: "Action confirmation",
  addLabel: "Add gift to cart",
  addPending: "Adding gift",
  cartCount: "Cart count",
  fixtureDescription:
    "Hero presence, idol context changes, cart feedback, and a trusted confirmed endpoint.",
  fixtureLabel: "Internal interaction fixture",
  heroAction: "Choose a gift",
  heroDescription:
    "A restrained entrance establishes presence without delaying the first action.",
  heroEyebrow: "A quiet gesture",
  heroHeading: "Make the moment feel personal.",
  idolLegend: "Choose the performer for this gift",
  mediaFallback: "Performer portrait is temporarily unavailable",
  miraAlt: "Fictional performer Mira Vale in a midnight-blue studio",
  miraDescription:
    "A midnight-blue portrait with ivory flowers and a calm editorial silhouette.",
  noaAlt: "Fictional performer Noa Aster in an ivory and cobalt studio",
  noaDescription:
    "An ivory-and-cobalt portrait with a precise, modern stage presence.",
  replayHero: "Replay hero entrance",
  replaySuccess: "Replay confirmed success",
  reset: "Reset confirmation",
  selected: "Selected",
  showError: "Show recoverable error",
  successDescription:
    "Order details stay primary while the decorative confirmation settles once.",
  successNext: "Next: the studio prepares the gift",
  successOrder: "Fixture order FS-1024",
  successTitle: "Gift order confirmed",
} satisfies UiMotionCopy);

function copyForPublicLocale(locale: SupportedLocale): UiMotionCopy {
  switch (locale) {
    case "en":
      return ENGLISH_COPY;
    case "zh-CN":
      return {
        addAnnouncement: "送给 Mira Vale 的午夜纪念礼物已加入购物车，当前数量",
        addBody: "受控样板会立即确认操作，但不负责购物车或支付的真实状态。",
        addConfirmed: "已加入购物车",
        addError: "重新加入",
        addErrorAnnouncement: "礼物未能加入购物车，请重试。",
        addHeading: "操作确认",
        addLabel: "将礼物加入购物车",
        addPending: "正在加入礼物",
        cartCount: "购物车数量",
        fixtureDescription: "验证主海报、偶像切换、加购反馈与可信成功终态。",
        fixtureLabel: "内部交互样板",
        heroAction: "选择礼物",
        heroDescription: "以克制的进入效果建立人物存在感，不延迟首个操作。",
        heroEyebrow: "安静的心意",
        heroHeading: "让这一刻，更有专属感。",
        idolLegend: "选择这份礼物要送给的艺人",
        mediaFallback: "艺人肖像暂时无法显示",
        miraAlt: "虚构艺人 Mira Vale 位于午夜蓝摄影棚",
        miraDescription: "午夜蓝人物肖像，以象牙白花材和沉静轮廓构成画面。",
        noaAlt: "虚构艺人 Noa Aster 位于象牙白与钴蓝摄影棚",
        noaDescription: "象牙白与钴蓝人物肖像，呈现利落、现代的舞台气质。",
        replayHero: "重播海报进入效果",
        replaySuccess: "重播确认成功效果",
        reset: "重置确认状态",
        selected: "已选择",
        showError: "显示可恢复错误",
        successDescription: "订单信息始终优先，装饰性确认效果只播放一次。",
        successNext: "下一步：工作室开始准备礼物",
        successOrder: "样板订单 FS-1024",
        successTitle: "礼物订单已确认",
      };
    case "th":
      return {
        addAnnouncement:
          "เพิ่มของที่ระลึก Midnight สำหรับ Mira Vale แล้ว จำนวนในรถเข็น",
        addBody:
          "ตัวอย่างแบบควบคุมยืนยันการกระทำทันที แต่ไม่กำหนดสถานะจริงของรถเข็นหรือการชำระเงิน",
        addConfirmed: "เพิ่มลงรถเข็นแล้ว",
        addError: "ลองเพิ่มอีกครั้ง",
        addErrorAnnouncement: "ไม่สามารถเพิ่มของขวัญได้ โปรดลองอีกครั้ง",
        addHeading: "ยืนยันการกระทำ",
        addLabel: "เพิ่มของขวัญลงรถเข็น",
        addPending: "กำลังเพิ่มของขวัญ",
        cartCount: "จำนวนในรถเข็น",
        fixtureDescription:
          "ทดสอบภาพหลัก การเปลี่ยนศิลปิน ข้อความรถเข็น และสถานะยืนยันที่เชื่อถือได้",
        fixtureLabel: "ตัวอย่างการโต้ตอบภายใน",
        heroAction: "เลือกของขวัญ",
        heroDescription:
          "การปรากฏอย่างเรียบง่ายสร้างตัวตนโดยไม่ทำให้การกระทำแรกช้าลง",
        heroEyebrow: "ความตั้งใจอันสงบ",
        heroHeading: "ทำให้ช่วงเวลานี้เป็นของคุณโดยเฉพาะ",
        idolLegend: "เลือกศิลปินสำหรับของขวัญชิ้นนี้",
        mediaFallback: "ไม่สามารถแสดงภาพศิลปินได้ชั่วคราว",
        miraAlt: "ศิลปินสมมติ Mira Vale ในสตูดิโอสีน้ำเงินเที่ยงคืน",
        miraDescription:
          "ภาพสีน้ำเงินเที่ยงคืนกับดอกไม้สีงาช้างและองค์ประกอบแบบบรรณาธิการที่สงบ",
        noaAlt: "ศิลปินสมมติ Noa Aster ในสตูดิโอสีงาช้างและโคบอลต์",
        noaDescription:
          "ภาพสีงาช้างและโคบอลต์ที่มีบุคลิกบนเวทีอันทันสมัยและคมชัด",
        replayHero: "เล่นการปรากฏของภาพหลักอีกครั้ง",
        replaySuccess: "เล่นการยืนยันสำเร็จอีกครั้ง",
        reset: "รีเซ็ตการยืนยัน",
        selected: "เลือกแล้ว",
        showError: "แสดงข้อผิดพลาดที่แก้ไขได้",
        successDescription:
          "รายละเอียดคำสั่งซื้อมาก่อน ขณะที่การยืนยันตกแต่งเล่นเพียงครั้งเดียว",
        successNext: "ขั้นต่อไป: สตูดิโอเตรียมของขวัญ",
        successOrder: "คำสั่งซื้อตัวอย่าง FS-1024",
        successTitle: "ยืนยันคำสั่งซื้อของขวัญแล้ว",
      };
    case "vi":
      return {
        addAnnouncement:
          "Đã thêm kỷ vật Midnight cho Mira Vale. Số lượng trong giỏ",
        addBody:
          "Mẫu có kiểm soát xác nhận thao tác ngay; không quyết định trạng thái thật của giỏ hàng hay thanh toán.",
        addConfirmed: "Đã thêm vào giỏ",
        addError: "Thử thêm lại",
        addErrorAnnouncement: "Không thể thêm quà. Vui lòng thử lại.",
        addHeading: "Xác nhận thao tác",
        addLabel: "Thêm quà vào giỏ",
        addPending: "Đang thêm quà",
        cartCount: "Số lượng trong giỏ",
        fixtureDescription:
          "Kiểm tra ảnh chính, chuyển nghệ sĩ, phản hồi giỏ hàng và trạng thái xác nhận đáng tin cậy.",
        fixtureLabel: "Mẫu tương tác nội bộ",
        heroAction: "Chọn quà",
        heroDescription:
          "Hiệu ứng xuất hiện tiết chế tạo điểm nhấn mà không trì hoãn thao tác đầu tiên.",
        heroEyebrow: "Một cử chỉ lặng lẽ",
        heroHeading: "Biến khoảnh khắc thành điều thật riêng.",
        idolLegend: "Chọn nghệ sĩ nhận món quà này",
        mediaFallback: "Tạm thời không thể hiển thị chân dung nghệ sĩ",
        miraAlt: "Nghệ sĩ hư cấu Mira Vale trong studio xanh đêm",
        miraDescription:
          "Chân dung xanh đêm với hoa trắng ngà và đường nét biên tập điềm tĩnh.",
        noaAlt:
          "Nghệ sĩ hư cấu Noa Aster trong studio trắng ngà và xanh cobalt",
        noaDescription:
          "Chân dung trắng ngà và cobalt với thần thái sân khấu hiện đại, sắc nét.",
        replayHero: "Phát lại hiệu ứng ảnh chính",
        replaySuccess: "Phát lại xác nhận thành công",
        reset: "Đặt lại xác nhận",
        selected: "Đã chọn",
        showError: "Hiển thị lỗi có thể khắc phục",
        successDescription:
          "Chi tiết đơn hàng luôn được ưu tiên, hiệu ứng xác nhận chỉ diễn ra một lần.",
        successNext: "Tiếp theo: studio chuẩn bị quà",
        successOrder: "Đơn hàng mẫu FS-1024",
        successTitle: "Đã xác nhận đơn quà",
      };
    case "ja":
      return {
        addAnnouncement:
          "Mira Vale への Midnight keepsake をカートに追加しました。カート数量",
        addBody:
          "制御された見本は操作をすぐ確認しますが、カートや支払いの真実を決めません。",
        addConfirmed: "カートに追加済み",
        addError: "もう一度追加",
        addErrorAnnouncement:
          "ギフトを追加できませんでした。もう一度お試しください。",
        addHeading: "操作の確認",
        addLabel: "ギフトをカートに追加",
        addPending: "ギフトを追加中",
        cartCount: "カート数量",
        fixtureDescription:
          "メインビジュアル、アーティスト切替、カート反応、信頼できる確定状態を検証します。",
        fixtureLabel: "内部インタラクション見本",
        heroAction: "ギフトを選ぶ",
        heroDescription:
          "控えめな登場演出で存在感をつくり、最初の操作を遅らせません。",
        heroEyebrow: "静かな気持ち",
        heroHeading: "この瞬間を、あなただけのものに。",
        idolLegend: "このギフトを贈るアーティストを選択",
        mediaFallback: "アーティスト画像を一時的に表示できません",
        miraAlt:
          "ミッドナイトブルーのスタジオに立つ架空のアーティスト Mira Vale",
        miraDescription:
          "アイボリーの花と静かな輪郭で構成したミッドナイトブルーのポートレート。",
        noaAlt:
          "アイボリーとコバルトのスタジオに立つ架空のアーティスト Noa Aster",
        noaDescription:
          "精密で現代的な舞台の存在感を表すアイボリーとコバルトのポートレート。",
        replayHero: "メインビジュアルの登場を再生",
        replaySuccess: "確定成功演出を再生",
        reset: "確認状態をリセット",
        selected: "選択中",
        showError: "回復可能なエラーを表示",
        successDescription:
          "注文情報を優先し、装飾的な確認演出は一度だけ再生します。",
        successNext: "次へ：スタジオがギフトを準備します",
        successOrder: "見本注文 FS-1024",
        successTitle: "ギフト注文を確認しました",
      };
    case "es":
      return {
        addAnnouncement:
          "Recuerdo Midnight para Mira Vale añadido. Cantidad del carrito",
        addBody:
          "La muestra controlada confirma la acción al instante; no decide la verdad del carrito ni del pago.",
        addConfirmed: "Añadido al carrito",
        addError: "Volver a añadir",
        addErrorAnnouncement:
          "No se pudo añadir el regalo. Inténtalo de nuevo.",
        addHeading: "Confirmación de la acción",
        addLabel: "Añadir regalo al carrito",
        addPending: "Añadiendo regalo",
        cartCount: "Cantidad del carrito",
        fixtureDescription:
          "Comprueba la presencia del cartel, el cambio de artista, la respuesta del carrito y un final confirmado fiable.",
        fixtureLabel: "Muestra interna de interacción",
        heroAction: "Elegir un regalo",
        heroDescription:
          "Una entrada contenida crea presencia sin retrasar la primera acción.",
        heroEyebrow: "Un gesto sereno",
        heroHeading: "Haz que el momento se sienta personal.",
        idolLegend: "Elige al artista para este regalo",
        mediaFallback:
          "El retrato del artista no está disponible temporalmente",
        miraAlt: "Artista ficticia Mira Vale en un estudio azul medianoche",
        miraDescription:
          "Un retrato azul medianoche con flores marfil y una silueta editorial serena.",
        noaAlt: "Artista ficticio Noa Aster en un estudio marfil y cobalto",
        noaDescription:
          "Un retrato marfil y cobalto con una presencia escénica moderna y precisa.",
        replayHero: "Repetir entrada del cartel",
        replaySuccess: "Repetir confirmación completada",
        reset: "Restablecer confirmación",
        selected: "Seleccionado",
        showError: "Mostrar error recuperable",
        successDescription:
          "Los datos del pedido siguen primero y la confirmación decorativa termina una sola vez.",
        successNext: "Siguiente: el estudio prepara el regalo",
        successOrder: "Pedido de muestra FS-1024",
        successTitle: "Pedido de regalo confirmado",
      };
    case "pt":
      return {
        addAnnouncement:
          "Lembrança Midnight para Mira Vale adicionada. Quantidade no carrinho",
        addBody:
          "A amostra controlada confirma a ação imediatamente; não decide a verdade do carrinho nem do pagamento.",
        addConfirmed: "Adicionado ao carrinho",
        addError: "Tentar adicionar novamente",
        addErrorAnnouncement:
          "Não foi possível adicionar o presente. Tente novamente.",
        addHeading: "Confirmação da ação",
        addLabel: "Adicionar presente ao carrinho",
        addPending: "Adicionando o presente",
        cartCount: "Quantidade no carrinho",
        fixtureDescription:
          "Comprova a presença do cartaz, a troca de artista, o retorno do carrinho e um estado final confirmado e confiável.",
        fixtureLabel: "Amostra interna de interação",
        heroAction: "Escolher um presente",
        heroDescription:
          "Uma entrada contida cria presença sem atrasar a primeira ação.",
        heroEyebrow: "Um gesto sereno",
        heroHeading: "Faça este momento parecer verdadeiramente pessoal.",
        idolLegend: "Escolha o artista para este presente",
        mediaFallback: "O retrato do artista está temporariamente indisponível",
        miraAlt: "Artista fictícia Mira Vale em um estúdio azul meia-noite",
        miraDescription:
          "Um retrato azul meia-noite com flores marfim e uma silhueta editorial tranquila.",
        noaAlt: "Artista fictício Noa Aster em um estúdio marfim e cobalto",
        noaDescription:
          "Um retrato marfim e cobalto com presença de palco moderna e precisa.",
        replayHero: "Reproduzir novamente a entrada do cartaz",
        replaySuccess: "Reproduzir novamente a confirmação concluída",
        reset: "Redefinir a confirmação",
        selected: "Selecionado",
        showError: "Mostrar erro recuperável",
        successDescription:
          "Os detalhes do pedido permanecem em primeiro plano enquanto a confirmação decorativa termina uma única vez.",
        successNext: "Próximo passo: o estúdio prepara o presente",
        successOrder: "Pedido de amostra FS-1024",
        successTitle: "Pedido de presente confirmado",
      };
  }
}

const PSEUDO_MAP: Readonly<Record<string, string>> = Object.freeze({
  a: "à",
  c: "ç",
  e: "ë",
  g: "ğ",
  i: "ï",
  l: "ļ",
  n: "ñ",
  o: "ö",
  r: "ř",
  s: "š",
  t: "ţ",
  u: "ü",
  y: "ÿ",
});

function pseudoLocalize(value: string): string {
  const expanded = [...value]
    .map((character) => {
      const replacement = PSEUDO_MAP[character.toLowerCase()];
      if (replacement === undefined) {
        return character;
      }
      return character === character.toUpperCase()
        ? replacement.toUpperCase()
        : replacement;
    })
    .join("");
  return `[!! ${expanded} !!]`;
}

const PSEUDO_COPY = Object.freeze(
  Object.fromEntries(
    Object.entries(ENGLISH_COPY).map(([field, value]) => [
      field,
      pseudoLocalize(value),
    ]),
  ) as Record<keyof UiMotionCopy, string>,
) satisfies UiMotionCopy;

export function uiMotionCopyForLocale(
  locale: DesignFoundationPreviewLocale,
): Readonly<{ copy: UiMotionCopy; fontProfile: string }> {
  if (locale === "en-XA") {
    return { copy: PSEUDO_COPY, fontProfile: "latin" };
  }
  return {
    copy: copyForPublicLocale(locale),
    fontProfile: FONT_PROFILE_BY_LOCALE[locale].id,
  };
}
