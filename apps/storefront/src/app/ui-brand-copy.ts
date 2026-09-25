import type { SupportedLocale } from "@fan-support/contracts";

import type { DesignFoundationPreviewLocale } from "../design-foundations";

export type BrandCopy = Readonly<{
  preview: string;
  navArtists: string;
  navGifts: string;
  navHow: string;
  language: string;
  bag: string;
  heroEyebrow: string;
  heroTitle: string;
  heroBody: string;
  heroAction: string;
  heroSecondary: string;
  featured: string;
  artistEyebrow: string;
  artistTitle: string;
  artistBody: string;
  chooseArtist: string;
  selected: string;
  giftEyebrow: string;
  giftTitle: string;
  giftBody: string;
  viewGift: string;
  forArtist: string;
  add: string;
  added: string;
  close: string;
  emptyBag: string;
  remove: string;
  total: string;
  continueBrowsing: string;
  previewCheckout: string;
  howTitle: string;
  footer: string;
  mediaFallback: string;
  noGifts: string;
  giftCount: string;
  bagHint: string;
  quantityLimit: string;
  categories: readonly [string, string, string, string];
  giftNames: readonly [string, string, string, string, string, string];
  giftDescriptions: readonly [string, string, string, string, string, string];
  howSteps: readonly [string, string, string];
  howBodies: readonly [string, string, string];
}>;

const ENGLISH_COPY = Object.freeze({
  preview:
    "Internal preview · Fictional artists and gifts, sample amounts. No payment is available.",
  navArtists: "Artists",
  navGifts: "Gifts",
  navHow: "How it works",
  language: "Language",
  bag: "Your gift bag",
  heroEyebrow: "A little closer, through a gift",
  heroTitle: "For the ones who inspire you.",
  heroBody:
    "For the songs on repeat and the moments that stay. Find a gift that says what they mean to you.",
  heroAction: "Explore gifts",
  heroSecondary: "Find your artist",
  featured: "In the spotlight",
  artistEyebrow: "Every gift starts with someone",
  artistTitle: "Who is on your mind?",
  artistBody: "Choose an artist, then find a gift that feels right for them.",
  chooseArtist: "Choose an artist",
  selected: "Selected",
  giftEyebrow: "Small gestures. Wonderful possibilities.",
  giftTitle: "Something that feels like you.",
  giftBody:
    "Dreamlike worlds, flowers with feeling, and everyday delights. A collection for all the ways you care.",
  viewGift: "View gift",
  forArtist: "For",
  add: "Add to gift bag",
  added: "Added to your gift bag",
  close: "Close",
  emptyBag: "Your next thoughtful gesture starts here.",
  remove: "Remove",
  total: "Sample total",
  continueBrowsing: "Keep exploring",
  previewCheckout: "Preview only · No payment",
  howTitle: "A thought, made into a gift.",
  footer: "For the moments that bring us closer.",
  mediaFallback: "This image is temporarily unavailable.",
  noGifts: "No gifts in this collection yet. Explore another collection.",
  giftCount: "Gifts",
  bagHint:
    "This preview keeps each gift with its chosen artist. Changing the artist does not change gifts already in your bag.",
  quantityLimit: "This preview allows up to five of each gift per artist.",
  categories: ["All gifts", "Dream worlds", "Flowers", "Everyday delights"],
  giftNames: [
    "Roseglass Palace",
    "Celestial Orbit",
    "Golden Daylight",
    "Ruby Rose Bouquet",
    "A Little Celebration",
    "Midnight Keepsake",
  ],
  giftDescriptions: [
    "A rose-and-lilac palace, made for a moment of wonder.",
    "Icy blue stars trace a world of their own.",
    "A sunlit scene in warm, luminous gold.",
    "Deep red roses for a feeling that needs few words.",
    "Cake and colorful fruit, a little reason to celebrate.",
    "A midnight-blue gift box for something worth remembering.",
  ],
  howSteps: ["Choose your artist", "Find your gift", "Make it personal"],
  howBodies: [
    "Start with the person who inspires you.",
    "Explore the collection and choose something that feels right.",
    "Try your gift bag here. Messages and payment are not available in this preview.",
  ],
} satisfies BrandCopy);

function localizedCopy(locale: SupportedLocale): BrandCopy {
  switch (locale) {
    case "en":
      return ENGLISH_COPY;
    case "zh-CN":
      return {
        preview: "内部样板 · 艺人与礼物均为虚构，金额仅作演示，不提供支付。",
        navArtists: "艺人",
        navGifts: "礼物",
        navHow: "如何送出心意",
        language: "语言",
        bag: "心意礼袋",
        heroEyebrow: "一份礼物，让心意更近一点",
        heroTitle: "让喜欢，成为一份心意。",
        heroBody:
          "送给反复循环的歌，送给念念不忘的瞬间。为那个带来光的人，挑一份属于你的心意。",
        heroAction: "挑选礼物",
        heroSecondary: "找到你喜欢的艺人",
        featured: "此刻，目光所向",
        artistEyebrow: "每一份心意，都有想起的人",
        artistTitle: "你想把心意送给谁？",
        artistBody: "先选一位艺人，再慢慢挑选适合对方的礼物。",
        chooseArtist: "选择艺人",
        selected: "已选择",
        giftEyebrow: "心意很轻，想象很远",
        giftTitle: "总有一份，刚好表达你。",
        giftBody:
          "幻想里的风景，鲜花里的情绪，日常里的小惊喜。让每一种喜欢，都有自己的表达。",
        viewGift: "查看礼物",
        forArtist: "送给",
        add: "加入礼袋",
        added: "已加入心意礼袋",
        close: "关闭",
        emptyBag: "下一份想送出的心意，从这里开始。",
        remove: "移除",
        total: "演示合计",
        continueBrowsing: "继续挑选",
        previewCheckout: "仅供体验 · 不提供支付",
        howTitle: "把一句想说的话，变成一份礼物。",
        footer: "为每一个让我们靠近的瞬间。",
        mediaFallback: "图片暂时无法显示。",
        noGifts: "这个分类暂时没有礼物，去看看其他分类吧。",
        giftCount: "礼物数量",
        bagHint:
          "样板会保留每份礼物对应的艺人。切换艺人，不会改变已加入礼袋的心意。",
        quantityLimit: "样板中，送给同一艺人的同款礼物最多可加入五份。",
        categories: ["全部礼物", "幻想礼物", "鲜花", "日常心意"],
        giftNames: [
          "粉紫宫殿",
          "冰蓝星轨",
          "金色日曜",
          "酒红玫瑰",
          "庆祝蛋糕果物",
          "深蓝心意礼盒",
        ],
        giftDescriptions: [
          "粉与紫交织的小小宫殿，装下一刻浪漫想象。",
          "冰蓝星光环绕，留住属于彼此的闪亮瞬间。",
          "把温暖日光化作金色风景，送给带来光的人。",
          "深酒红的玫瑰，把难以言说的心意轻轻盛放。",
          "蛋糕与缤纷果物，为值得纪念的时刻添一点甜。",
          "以午夜蓝收起小小心意，为日常留一份特别。",
        ],
        howSteps: ["选一位艺人", "挑一份礼物", "留一点专属"],
        howBodies: [
          "从那个让你想起就开心的人开始。",
          "慢慢看，找到最能表达你心意的那一份。",
          "先体验礼袋中的搭配；当前样板不提供留言或支付。",
        ],
      };
    case "th":
      return {
        preview:
          "ตัวอย่างภายใน · ศิลปินและของขวัญเป็นเรื่องสมมติ ราคาใช้สาธิตเท่านั้น ไม่รองรับการชำระเงิน",
        navArtists: "ศิลปิน",
        navGifts: "ของขวัญ",
        navHow: "วิธีส่งความรู้สึกดี ๆ",
        language: "ภาษา",
        bag: "ถุงของขวัญของคุณ",
        heroEyebrow: "ใกล้กันอีกนิด ผ่านของขวัญหนึ่งชิ้น",
        heroTitle: "แด่คนที่เป็นแรงบันดาลใจให้คุณ",
        heroBody:
          "แด่เพลงที่ฟังซ้ำและช่วงเวลาที่ไม่เคยลืม เลือกของขวัญแทนความรู้สึกที่อยากบอกเขา",
        heroAction: "เลือกชมของขวัญ",
        heroSecondary: "ค้นหาศิลปินที่คุณชอบ",
        featured: "ในแสงสปอตไลต์",
        artistEyebrow: "ทุกของขวัญ เริ่มต้นจากใครสักคน",
        artistTitle: "คุณกำลังนึกถึงใครอยู่?",
        artistBody: "เลือกศิลปิน แล้วค่อยหาของขวัญที่รู้สึกว่าเหมาะกับเขา",
        chooseArtist: "เลือกศิลปิน",
        selected: "เลือกแล้ว",
        giftEyebrow: "ความตั้งใจเล็ก ๆ จินตนาการที่กว้างไกล",
        giftTitle: "สักชิ้นที่บอกความเป็นคุณ",
        giftBody:
          "โลกในฝัน ดอกไม้แทนใจ และความสุขเล็ก ๆ ในทุกวัน มีของขวัญสำหรับทุกความรู้สึกดี ๆ",
        viewGift: "ดูของขวัญ",
        forArtist: "สำหรับ",
        add: "เพิ่มลงถุงของขวัญ",
        added: "เพิ่มลงถุงของขวัญแล้ว",
        close: "ปิด",
        emptyBag: "ความตั้งใจดี ๆ ครั้งต่อไปของคุณ เริ่มต้นที่นี่",
        remove: "นำออก",
        total: "ยอดรวมตัวอย่าง",
        continueBrowsing: "เลือกชมต่อ",
        previewCheckout: "ทดลองชมเท่านั้น · ไม่รองรับการชำระเงิน",
        howTitle: "เปลี่ยนความรู้สึกให้เป็นของขวัญ",
        footer: "แด่ทุกช่วงเวลาที่ทำให้เราใกล้กัน",
        mediaFallback: "ไม่สามารถแสดงรูปภาพนี้ได้ชั่วคราว",
        noGifts: "หมวดนี้ยังไม่มีของขวัญ ลองเลือกชมหมวดอื่น",
        giftCount: "จำนวนของขวัญ",
        bagHint:
          "ตัวอย่างนี้จะเก็บศิลปินที่คุณเลือกไว้กับของขวัญแต่ละชิ้น การเปลี่ยนศิลปินจะไม่เปลี่ยนของขวัญในถุง",
        quantityLimit:
          "ในตัวอย่างนี้ เพิ่มของขวัญแบบเดียวกันได้สูงสุดห้าชิ้นต่อศิลปินหนึ่งคน",
        categories: ["ของขวัญทั้งหมด", "โลกในฝัน", "ดอกไม้", "ความสุขในทุกวัน"],
        giftNames: [
          "ปราสาทชมพูม่วง",
          "วงโคจรสีฟ้าเย็น",
          "แสงตะวันสีทอง",
          "กุหลาบแดงไวน์",
          "เค้กและผลไม้ฉลองวันพิเศษ",
          "กล่องแทนใจสีน้ำเงินเข้ม",
        ],
        giftDescriptions: [
          "ปราสาทสีชมพูและม่วงอ่อน สำหรับช่วงเวลาแห่งจินตนาการ",
          "ดวงดาวสีฟ้าเย็นโคจรในโลกใบเล็กของตัวเอง",
          "เก็บความอบอุ่นของแสงตะวันไว้ในทิวทัศน์สีทอง",
          "กุหลาบสีแดงไวน์แทนความรู้สึกที่ไม่ต้องใช้คำมากมาย",
          "เค้กและผลไม้หลากสี เติมความหวานให้ช่วงเวลาน่าจดจำ",
          "กล่องของขวัญสีน้ำเงินยามค่ำคืน เก็บความตั้งใจที่แสนพิเศษ",
        ],
        howSteps: ["เลือกศิลปิน", "ค้นหาของขวัญ", "เติมความเป็นคุณ"],
        howBodies: [
          "เริ่มจากคนที่เป็นแรงบันดาลใจให้คุณ",
          "ค่อย ๆ เลือกชม แล้วหาชิ้นที่แทนความรู้สึกของคุณได้ดีที่สุด",
          "ทดลองจัดของขวัญในถุง ตัวอย่างนี้ยังไม่รองรับข้อความส่วนตัวหรือการชำระเงิน",
        ],
      };
    case "vi":
      return {
        preview:
          "Bản xem trước nội bộ · Nghệ sĩ và quà tặng hư cấu, giá minh họa. Không hỗ trợ thanh toán.",
        navArtists: "Nghệ sĩ",
        navGifts: "Quà tặng",
        navHow: "Cách gửi tâm ý",
        language: "Ngôn ngữ",
        bag: "Túi quà của bạn",
        heroEyebrow: "Gần nhau thêm một chút, qua một món quà",
        heroTitle: "Dành cho người truyền cảm hứng cho bạn.",
        heroBody:
          "Cho những bài hát nghe mãi và khoảnh khắc không quên. Chọn một món quà nói thay điều bạn trân quý ở họ.",
        heroAction: "Khám phá quà tặng",
        heroSecondary: "Tìm nghệ sĩ bạn yêu thích",
        featured: "Trong ánh đèn",
        artistEyebrow: "Mỗi món quà bắt đầu từ một người",
        artistTitle: "Bạn đang nghĩ đến ai?",
        artistBody: "Chọn một nghệ sĩ, rồi tìm món quà thật phù hợp với họ.",
        chooseArtist: "Chọn nghệ sĩ",
        selected: "Đã chọn",
        giftEyebrow: "Cử chỉ nhỏ. Muôn vàn điều đẹp đẽ.",
        giftTitle: "Một món quà mang dấu ấn của bạn.",
        giftBody:
          "Thế giới trong mơ, hoa gửi tâm tình và niềm vui thường ngày. Có một món quà cho mỗi cách bạn quan tâm.",
        viewGift: "Xem quà",
        forArtist: "Dành cho",
        add: "Thêm vào túi quà",
        added: "Đã thêm vào túi quà",
        close: "Đóng",
        emptyBag: "Món quà đầy tâm ý tiếp theo của bạn bắt đầu từ đây.",
        remove: "Xóa",
        total: "Tổng tiền minh họa",
        continueBrowsing: "Tiếp tục khám phá",
        previewCheckout: "Chỉ để trải nghiệm · Không thanh toán",
        howTitle: "Gửi tâm ý qua một món quà.",
        footer: "Cho những khoảnh khắc đưa chúng ta đến gần nhau.",
        mediaFallback: "Tạm thời không thể hiển thị ảnh này.",
        noGifts: "Danh mục này chưa có quà. Hãy khám phá danh mục khác.",
        giftCount: "Số món quà",
        bagHint:
          "Bản xem trước giữ nguyên nghệ sĩ đã chọn cho từng món quà. Đổi nghệ sĩ không làm thay đổi các món đã có trong túi.",
        quantityLimit:
          "Trong bản xem trước, mỗi nghệ sĩ có thể nhận tối đa năm món quà cùng loại.",
        categories: [
          "Tất cả quà",
          "Thế giới trong mơ",
          "Hoa",
          "Niềm vui mỗi ngày",
        ],
        giftNames: [
          "Cung điện hồng tím",
          "Quỹ đạo xanh băng",
          "Nắng vàng rực rỡ",
          "Bó hồng đỏ rượu",
          "Bánh và trái cây mừng ngày vui",
          "Hộp tâm ý xanh đêm",
        ],
        giftDescriptions: [
          "Cung điện hồng và tím nhạt, dành cho một thoáng mộng mơ.",
          "Những vì sao xanh băng vẽ nên một thế giới riêng.",
          "Khung cảnh ngập nắng trong sắc vàng ấm áp.",
          "Những đóa hồng đỏ thẫm nói thay điều khó thành lời.",
          "Bánh và trái cây rực rỡ, thêm chút ngọt ngào cho dịp đáng nhớ.",
          "Hộp quà xanh đêm cất giữ một điều thật đặc biệt.",
        ],
        howSteps: ["Chọn nghệ sĩ", "Tìm món quà", "Thêm dấu ấn riêng"],
        howBodies: [
          "Bắt đầu với người truyền cảm hứng cho bạn.",
          "Dành thời gian khám phá và chọn món quà nói đúng tâm ý.",
          "Thử kết hợp các món trong túi quà. Bản xem trước chưa hỗ trợ lời nhắn hay thanh toán.",
        ],
      };
    case "ja":
      return {
        preview:
          "内部プレビュー · アーティストとギフトは架空、金額はサンプルです。お支払いはできません。",
        navArtists: "アーティスト",
        navGifts: "ギフト",
        navHow: "想いを贈るには",
        language: "言語",
        bag: "ギフトバッグ",
        heroEyebrow: "ひとつの贈り物で、もう少し近くに",
        heroTitle: "「好き」を、ひとつの贈り物に。",
        heroBody:
          "何度も聴いた曲へ、忘れられない瞬間へ。あなたの毎日に光をくれる人に、想いの伝わるギフトを。",
        heroAction: "ギフトを探す",
        heroSecondary: "アーティストを探す",
        featured: "いま、心を惹かれる人",
        artistEyebrow: "贈り物は、誰かを想うことから",
        artistTitle: "誰に想いを届けたいですか？",
        artistBody:
          "アーティストを選んで、その人にぴったりのギフトを探しましょう。",
        chooseArtist: "アーティストを選ぶ",
        selected: "選択中",
        giftEyebrow: "小さな気持ちに、広がる想像",
        giftTitle: "あなたらしい想いのかたち。",
        giftBody:
          "夢のような景色、気持ちを託す花、日々の小さな喜び。いろいろな「好き」に寄り添うギフトを集めました。",
        viewGift: "ギフトを見る",
        forArtist: "贈る相手",
        add: "ギフトバッグに追加",
        added: "ギフトバッグに追加しました",
        close: "閉じる",
        emptyBag: "次に贈りたい気持ちは、ここから。",
        remove: "削除",
        total: "サンプル合計",
        continueBrowsing: "ギフト選びを続ける",
        previewCheckout: "体験用 · お支払いはできません",
        howTitle: "伝えたい気持ちを、贈り物に。",
        footer: "心の距離が近づく、すべての瞬間に。",
        mediaFallback: "画像を一時的に表示できません。",
        noGifts:
          "このカテゴリーにはまだギフトがありません。ほかもご覧ください。",
        giftCount: "ギフトの数",
        bagHint:
          "プレビューでは、ギフトごとに選んだアーティストを保持します。アーティストを切り替えても、追加済みのギフトの贈り先は変わりません。",
        quantityLimit:
          "プレビューでは、同じアーティストへの同じギフトは五点まで追加できます。",
        categories: ["すべて", "夢のギフト", "フラワー", "日々の小さな贈り物"],
        giftNames: [
          "ピンクと紫の宮殿",
          "アイスブルーの星めぐり",
          "黄金の陽だまり",
          "ワインレッドのバラ",
          "お祝いのケーキと果実",
          "ミッドナイトブルーの贈り物",
        ],
        giftDescriptions: [
          "ピンクと淡い紫の宮殿に、ひとときの夢を込めて。",
          "アイスブルーの星々が、小さな世界をめぐります。",
          "あたたかな日差しを、輝く金色の景色に。",
          "深い赤のバラに、言葉にならない想いを託して。",
          "ケーキと色とりどりの果実で、大切な日を少し甘く。",
          "ミッドナイトブルーの箱に、忘れたくない気持ちを。",
        ],
        howSteps: [
          "アーティストを選ぶ",
          "ギフトを見つける",
          "あなたらしさを添える",
        ],
        howBodies: [
          "あなたの毎日に光をくれる人から始めましょう。",
          "ゆっくり眺めて、気持ちにぴったりの一品を。",
          "ギフトバッグの組み合わせをお試しください。このプレビューではメッセージやお支払いは利用できません。",
        ],
      };
    case "es":
      return {
        preview:
          "Vista previa interna · Artistas y regalos ficticios, importes de ejemplo. No se pueden realizar pagos.",
        navArtists: "Artistas",
        navGifts: "Regalos",
        navHow: "Cómo funciona",
        language: "Idioma",
        bag: "Tu bolsa de regalos",
        heroEyebrow: "Un poco más cerca, con un regalo",
        heroTitle: "Para quienes te inspiran.",
        heroBody:
          "Por las canciones que no dejas de escuchar y los momentos que permanecen. Encuentra un regalo que diga lo que esa persona significa para ti.",
        heroAction: "Explorar regalos",
        heroSecondary: "Encontrar a tu artista",
        featured: "Bajo los focos",
        artistEyebrow: "Cada regalo empieza con alguien",
        artistTitle: "¿En quién estás pensando?",
        artistBody:
          "Elige a un artista y encuentra un regalo que sientas que va con esa persona.",
        chooseArtist: "Elegir artista",
        selected: "Seleccionado",
        giftEyebrow: "Pequeños gestos. Grandes posibilidades.",
        giftTitle: "Un regalo que hable de ti.",
        giftBody:
          "Mundos de ensueño, flores con sentimiento y pequeñas alegrías cotidianas. Un regalo para cada forma de demostrar cariño.",
        viewGift: "Ver regalo",
        forArtist: "Para",
        add: "Añadir a la bolsa",
        added: "Añadido a tu bolsa de regalos",
        close: "Cerrar",
        emptyBag: "Tu próximo detalle especial empieza aquí.",
        remove: "Eliminar",
        total: "Total de ejemplo",
        continueBrowsing: "Seguir explorando",
        previewCheckout: "Solo vista previa · Sin pagos",
        howTitle: "Un sentimiento convertido en regalo.",
        footer: "Por los momentos que nos acercan.",
        mediaFallback: "Esta imagen no está disponible temporalmente.",
        noGifts: "Aún no hay regalos en esta colección. Explora otra.",
        giftCount: "Número de regalos",
        bagHint:
          "Esta vista previa conserva el artista elegido para cada regalo. Cambiar de artista no modifica los regalos que ya están en tu bolsa.",
        quantityLimit:
          "Esta vista previa permite hasta cinco unidades de cada regalo por artista.",
        categories: [
          "Todos los regalos",
          "Mundos de ensueño",
          "Flores",
          "Alegrías cotidianas",
        ],
        giftNames: [
          "Palacio rosa y lila",
          "Órbita azul hielo",
          "Luz de sol dorada",
          "Ramo de rosas granate",
          "Pastel y frutas para celebrar",
          "Recuerdo azul medianoche",
        ],
        giftDescriptions: [
          "Un palacio rosa y lila para un instante de fantasía.",
          "Estrellas azul hielo trazan un universo propio.",
          "Un paisaje bañado de sol en un dorado cálido y luminoso.",
          "Rosas de rojo intenso para un sentimiento que necesita pocas palabras.",
          "Pastel y frutas de colores, un pequeño motivo para celebrar.",
          "Una caja azul medianoche para un detalle que merece recordarse.",
        ],
        howSteps: [
          "Elige a tu artista",
          "Encuentra tu regalo",
          "Dale tu toque personal",
        ],
        howBodies: [
          "Empieza por la persona que te inspira.",
          "Explora la colección y elige algo que exprese lo que sientes.",
          "Prueba tu bolsa de regalos. Los mensajes y los pagos no están disponibles en esta vista previa.",
        ],
      };
    case "pt":
      return {
        preview:
          "Prévia interna · Artistas e presentes fictícios, valores de exemplo. Não é possível realizar pagamentos.",
        navArtists: "Artistas",
        navGifts: "Presentes",
        navHow: "Como funciona",
        language: "Idioma",
        bag: "Sua sacola de presentes",
        heroEyebrow: "Um pouco mais perto, com um presente",
        heroTitle: "Para quem inspira você.",
        heroBody:
          "Pelas músicas que você ouve sem parar e pelos momentos que ficam. Encontre um presente que diga o quanto essa pessoa significa para você.",
        heroAction: "Explorar presentes",
        heroSecondary: "Encontrar seu artista",
        featured: "Sob os holofotes",
        artistEyebrow: "Todo presente começa com alguém",
        artistTitle: "Em quem você está pensando?",
        artistBody:
          "Escolha um artista e encontre um presente que combine com essa pessoa.",
        chooseArtist: "Escolher artista",
        selected: "Selecionado",
        giftEyebrow: "Pequenos gestos. Lindas possibilidades.",
        giftTitle: "Um presente com um pouco de você.",
        giftBody:
          "Mundos de sonho, flores cheias de sentimento e pequenas alegrias do dia a dia. Um presente para cada jeito de demonstrar carinho.",
        viewGift: "Ver presente",
        forArtist: "Para",
        add: "Adicionar à sacola",
        added: "Adicionado à sua sacola de presentes",
        close: "Fechar",
        emptyBag: "Seu próximo gesto de carinho começa aqui.",
        remove: "Remover",
        total: "Total de exemplo",
        continueBrowsing: "Continuar explorando",
        previewCheckout: "Apenas demonstração · Sem pagamentos",
        howTitle: "Um sentimento que vira presente.",
        footer: "Pelos momentos que nos aproximam.",
        mediaFallback: "Esta imagem está temporariamente indisponível.",
        noGifts: "Ainda não há presentes nesta coleção. Explore outra.",
        giftCount: "Quantidade de presentes",
        bagHint:
          "Esta prévia mantém o artista escolhido para cada presente. Trocar de artista não altera os presentes que já estão na sua sacola.",
        quantityLimit:
          "Nesta prévia, é possível adicionar até cinco unidades de cada presente por artista.",
        categories: [
          "Todos os presentes",
          "Mundos de sonho",
          "Flores",
          "Carinho no dia a dia",
        ],
        giftNames: [
          "Palácio rosa e lilás",
          "Órbita azul-gelo",
          "Luz dourada do sol",
          "Buquê de rosas vinho",
          "Bolo e frutas para celebrar",
          "Lembrança azul meia-noite",
        ],
        giftDescriptions: [
          "Um palácio rosa e lilás para um instante de encantamento.",
          "Estrelas azul-gelo desenham um universo só delas.",
          "Uma paisagem ensolarada em tons de dourado acolhedor.",
          "Rosas de vermelho profundo para um sentimento que dispensa muitas palavras.",
          "Bolo e frutas coloridas, um pequeno motivo para celebrar.",
          "Uma caixa azul meia-noite para um carinho que merece ser lembrado.",
        ],
        howSteps: [
          "Escolha seu artista",
          "Encontre seu presente",
          "Dê seu toque pessoal",
        ],
        howBodies: [
          "Comece por quem inspira você.",
          "Explore a coleção com calma e escolha algo que expresse seu carinho.",
          "Experimente sua sacola de presentes. Mensagens e pagamentos não estão disponíveis nesta prévia.",
        ],
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
  const accented = [...value]
    .map((character) => {
      const replacement = PSEUDO_MAP[character.toLowerCase()];
      if (replacement === undefined) return character;
      return character === character.toUpperCase()
        ? replacement.toUpperCase()
        : replacement;
    })
    .join("");
  return `[!! ${accented} ${"~".repeat(Math.ceil(value.length * 0.35))} !!]`;
}

const PSEUDO_COPY = Object.freeze(
  // Every source key is retained; only strings change, and array mapping keeps
  // each tuple's length. Object.fromEntries cannot express that preserved shape.
  Object.fromEntries(
    Object.entries(ENGLISH_COPY).map(([field, value]) => [
      field,
      typeof value === "string"
        ? pseudoLocalize(value)
        : value.map(pseudoLocalize),
    ]),
  ) as unknown as BrandCopy,
);

export function brandCopyForLocale(
  locale: DesignFoundationPreviewLocale,
): BrandCopy {
  return locale === "en-XA" ? PSEUDO_COPY : localizedCopy(locale);
}
