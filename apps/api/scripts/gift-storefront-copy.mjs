import { SUPPORTED_LOCALES } from "@fan-support/contracts";

/** Fictional internal content only; these translations are not launch approvals. */
function copyForLocale(locale) {
  switch (locale) {
    case "en":
      return {
        bio: "Music, movement, and moments worth sharing.",
        story:
          "A fictional adult artist exploring the connection between music and everyday life.",
        subtitle: "A thoughtful gift, prepared for your artist",
        care: "Our studio prepares or procures your chosen gift and hands it to the artist. Internal test content; service timing and final terms await confirmation.",
        heading: "Prepared with care",
        edition: "Studio edition",
        limited: "Limited edition",
        preorder: "Studio preorder",
        material: "Presentation",
        materialValue: "Prepared by the studio",
        recipient: "Recipient",
        recipientValue: "Your selected artist",
        caption: "Original fictional gift artwork for internal testing.",
        policyTitles: [
          "Terms of service",
          "Privacy",
          "Refunds",
          "Delivery to the artist",
        ],
      };
    case "zh-CN":
      return {
        bio: "以音乐与舞台，分享值得珍藏的瞬间。",
        story: "这是一位虚构的成年艺人，在音乐与日常生活之间寻找共鸣。",
        subtitle: "用一份礼物，传递你的支持",
        care: "工作室准备或采购你选择的礼物，再转交艺人。此为内部测试内容，服务时效和正式条款待确认。",
        heading: "每一份心意，用心准备",
        edition: "工作室款",
        limited: "限量款",
        preorder: "工作室预售款",
        material: "准备方式",
        materialValue: "由工作室准备",
        recipient: "收礼人",
        recipientValue: "你选择的艺人",
        caption: "仅用于内部测试的原创虚构礼物插画。",
        policyTitles: ["服务条款", "隐私说明", "退款说明", "转交艺人说明"],
      };
    case "th":
      return {
        bio: "แบ่งปันช่วงเวลาที่น่าจดจำผ่านเสียงเพลงและการแสดง",
        story:
          "ศิลปินผู้ใหญ่ในเรื่องสมมติที่ค้นหาความสัมพันธ์ระหว่างเสียงเพลงและชีวิตประจำวัน",
        subtitle: "ของขวัญที่ใส่ใจ เพื่อศิลปินของคุณ",
        care: "สตูดิโอจัดเตรียมหรือจัดซื้อของขวัญที่คุณเลือกและส่งต่อให้ศิลปิน เนื้อหาทดสอบภายใน ระยะเวลาบริการและเงื่อนไขฉบับสมบูรณ์รอการยืนยัน",
        heading: "เตรียมด้วยความใส่ใจ",
        edition: "รุ่นสตูดิโอ",
        limited: "รุ่นจำนวนจำกัด",
        preorder: "รุ่นสั่งจองล่วงหน้า",
        material: "การจัดเตรียม",
        materialValue: "จัดเตรียมโดยสตูดิโอ",
        recipient: "ผู้รับ",
        recipientValue: "ศิลปินที่คุณเลือก",
        caption: "ภาพของขวัญสมมติที่สร้างขึ้นเพื่อการทดสอบภายใน",
        policyTitles: [
          "ข้อกำหนดการใช้บริการ",
          "ความเป็นส่วนตัว",
          "การคืนเงิน",
          "การส่งมอบให้ศิลปิน",
        ],
      };
    case "vi":
      return {
        bio: "Chia sẻ những khoảnh khắc đáng nhớ qua âm nhạc và sân khấu.",
        story:
          "Nghệ sĩ trưởng thành hư cấu tìm kiếm sự kết nối giữa âm nhạc và đời sống thường ngày.",
        subtitle: "Món quà chu đáo dành cho nghệ sĩ của bạn",
        care: "Studio chuẩn bị hoặc mua món quà bạn chọn rồi trao cho nghệ sĩ. Nội dung thử nghiệm nội bộ; thời gian dịch vụ và điều khoản chính thức chờ xác nhận.",
        heading: "Chuẩn bị bằng sự quan tâm",
        edition: "Phiên bản studio",
        limited: "Phiên bản giới hạn",
        preorder: "Phiên bản đặt trước",
        material: "Chuẩn bị",
        materialValue: "Do studio chuẩn bị",
        recipient: "Người nhận",
        recipientValue: "Nghệ sĩ bạn đã chọn",
        caption: "Hình minh họa quà tặng hư cấu dành cho thử nghiệm nội bộ.",
        policyTitles: [
          "Điều khoản dịch vụ",
          "Quyền riêng tư",
          "Hoàn tiền",
          "Trao quà cho nghệ sĩ",
        ],
      };
    case "ja":
      return {
        bio: "音楽とステージを通して、大切な瞬間を分かち合う。",
        story: "音楽と日常のつながりを探す、架空の成人アーティストです。",
        subtitle: "大切なアーティストへ、心を込めた贈り物",
        care: "スタジオが選ばれたギフトを準備または購入し、アーティストにお渡しします。内部テスト用の内容です。サービス期間と正式な条件は確認待ちです。",
        heading: "心を込めて準備します",
        edition: "スタジオ版",
        limited: "限定版",
        preorder: "予約版",
        material: "準備方法",
        materialValue: "スタジオが準備",
        recipient: "贈り先",
        recipientValue: "選択したアーティスト",
        caption: "内部テスト用に作成した架空のギフトのイラストです。",
        policyTitles: [
          "利用規約",
          "プライバシー",
          "返金について",
          "アーティストへのお届け",
        ],
      };
    case "es":
      return {
        bio: "Música, movimiento y momentos que merece la pena compartir.",
        story:
          "Artista adulto de ficción que explora la conexión entre la música y la vida cotidiana.",
        subtitle: "Un regalo especial, preparado para tu artista",
        care: "Nuestro estudio prepara o compra el regalo elegido y se lo entrega al artista. Contenido de prueba interna; los plazos y las condiciones definitivas están pendientes de confirmación.",
        heading: "Preparado con cuidado",
        edition: "Edición del estudio",
        limited: "Edición limitada",
        preorder: "Reserva del estudio",
        material: "Preparación",
        materialValue: "A cargo del estudio",
        recipient: "Destinatario",
        recipientValue: "El artista que has elegido",
        caption:
          "Ilustración original de un regalo ficticio para pruebas internas.",
        policyTitles: [
          "Condiciones del servicio",
          "Privacidad",
          "Reembolsos",
          "Entrega al artista",
        ],
      };
    case "pt":
      return {
        bio: "Música, movimento e momentos que vale a pena partilhar.",
        story:
          "Artista adulto fictício que explora a ligação entre a música e o quotidiano.",
        subtitle: "Um presente especial, preparado para o seu artista",
        care: "O estúdio prepara ou compra o presente escolhido e entrega-o ao artista. Conteúdo de teste interno; os prazos e as condições finais aguardam confirmação.",
        heading: "Preparado com carinho",
        edition: "Edição do estúdio",
        limited: "Edição limitada",
        preorder: "Pré-venda do estúdio",
        material: "Preparação",
        materialValue: "Preparado pelo estúdio",
        recipient: "Destinatário",
        recipientValue: "O artista que escolheu",
        caption:
          "Ilustração original de um presente fictício para testes internos.",
        policyTitles: [
          "Termos do serviço",
          "Privacidade",
          "Reembolsos",
          "Entrega ao artista",
        ],
      };
    default:
      throw new Error("Unsupported gift storefront fixture locale");
  }
}

export const giftStorefrontCopy = Object.fromEntries(
  SUPPORTED_LOCALES.map((locale) => [locale, copyForLocale(locale)]),
);
