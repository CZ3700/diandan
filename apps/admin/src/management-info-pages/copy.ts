import type { SupportedLocale } from "@fan-support/contracts";
import { decorationCopy } from "../management-decoration/copy";
function labels(locale: SupportedLocale) {
  switch (locale) {
    case "en":
      return {
        title: "Information pages",
        about: "About",
        faq: "FAQ",
        support: "Support",
        pageTitle: "Page title",
        summary: "Short introduction",
        heading: "Section heading",
        body: "Body",
        question: "Question",
        answer: "Answer",
        contactEmail: "Public contact email (optional)",
        addSection: "Add section",
        removeSection: "Remove section",
        translations: "Translations and review",
        source: "English source",
        previewMissing:
          "No saved translation is ready to preview. Save this language first.",
        reviewSubmit: "Submit for review",
        approve: "Approve translation",
        unpublish: "Unpublish",
        unpublishConfirm:
          "Unpublish this page? Visitors will no longer see it. The saved draft is kept.",
        publishHint:
          "All seven languages need independent approval before publication.",
        savedOnly:
          "This preview shows the saved version. Save changes to update it.",
        sourceFirst: "Save the English source before adding translations.",
        sourceChanged:
          "The English source changed. Compare it and update the translation before review.",
        restoreConfirm:
          "Restore this page? Its current draft and publication will be replaced. Other pages and settings stay unchanged.",
        intro: "Edit a page, review its translations, then publish.",
        unpublished: "Page unpublished",
        published: "Page published",
        restored: "Page restored",
        live: "Published page",
        noHistory: "Published versions will appear here.",
        conflict:
          "Another operator updated this page. Reload before continuing.",
        discard: "Discard unsaved changes and leave this page?",
        newTranslation: "New section: translation required",
      };
    case "zh-CN":
      return {
        title: "信息页面",
        about: "关于",
        faq: "常见问题",
        support: "客服",
        pageTitle: "页面标题",
        summary: "简短介绍",
        heading: "段落标题",
        body: "正文",
        question: "问题",
        answer: "回答",
        contactEmail: "公开联系邮箱（选填）",
        addSection: "添加段落",
        removeSection: "删除段落",
        translations: "翻译与审核",
        source: "英文源稿",
        previewMissing: "暂无可预览的已保存译文，请先保存当前语言草稿。",
        reviewSubmit: "提交审核",
        approve: "审核通过",
        unpublish: "下架页面",
        unpublishConfirm:
          "下架此页面？访客将无法再看到它，已保存的草稿会保留。",
        publishHint: "七种语言均须由另一人审核通过后才可发布。",
        savedOnly: "此处仅预览已保存的版本，保存修改后即可更新预览。",
        sourceFirst: "请先保存英文源稿，再添加译文。",
        sourceChanged: "英文源稿已更新，请对照并更新译文后再提交审核。",
        restoreConfirm:
          "恢复此页面？当前草稿和发布版本将被替换，其他页面和设置保持不变。",
        intro: "编辑页面，完成译文审核后发布。",
        unpublished: "页面已下架",
        published: "页面已发布",
        restored: "页面已恢复",
        live: "已发布页面",
        noHistory: "已发布的版本会显示在这里。",
        conflict: "其他人员已更新此页面，请重新加载后继续。",
        discard: "离开并放弃尚未保存的页面修改？",
        newTranslation: "新增段落：待翻译",
      };
    case "ja":
      return {
        title: "情報ページ",
        about: "紹介",
        faq: "よくある質問",
        support: "サポート",
        pageTitle: "ページタイトル",
        summary: "短い紹介",
        heading: "見出し",
        body: "本文",
        question: "質問",
        answer: "回答",
        contactEmail: "公開連絡先メール（任意）",
        addSection: "段落を追加",
        removeSection: "段落を削除",
        translations: "翻訳と審査",
        source: "英語の原稿",
        previewMissing:
          "プレビューできる保存済み翻訳がありません。この言語の下書きを保存してください。",
        reviewSubmit: "審査に提出",
        approve: "翻訳を承認",
        unpublish: "公開を停止",
        unpublishConfirm:
          "このページを非公開にしますか？保存済みの下書きは残ります。",
        publishHint: "公開には全7言語について別の担当者の承認が必要です。",
        savedOnly:
          "保存済みの内容を表示しています。変更を保存すると更新されます。",
        sourceFirst: "翻訳を追加する前に英語の原稿を保存してください。",
        sourceChanged:
          "英語の原稿が変わりました。比較して翻訳を更新してから審査に提出してください。",
        restoreConfirm:
          "このページを復元しますか？現在の下書きと公開版を置き換えます。他のページや設定は変わりません。",
        intro: "ページを編集し、翻訳を審査してから公開します。",
        unpublished: "ページを非公開にしました",
        published: "ページを公開しました",
        restored: "ページを復元しました",
        live: "公開中のページ",
        noHistory: "公開済みのバージョンがここに表示されます。",
        conflict: "別の担当者が更新しました。再読み込みしてください。",
        discard: "未保存の変更を破棄して移動しますか？",
        newTranslation: "新しい段落：翻訳が必要",
      };
    case "th":
      return {
        title: "หน้าข้อมูล",
        about: "เกี่ยวกับ",
        faq: "คำถามที่พบบ่อย",
        support: "ฝ่ายช่วยเหลือ",
        pageTitle: "ชื่อหน้า",
        summary: "คำแนะนำสั้นๆ",
        heading: "หัวข้อย่อหน้า",
        body: "เนื้อหา",
        question: "คำถาม",
        answer: "คำตอบ",
        contactEmail: "อีเมลติดต่อสาธารณะ (ไม่บังคับ)",
        addSection: "เพิ่มย่อหน้า",
        removeSection: "ลบย่อหน้า",
        translations: "การแปลและการตรวจทาน",
        source: "ต้นฉบับภาษาอังกฤษ",
        previewMissing: "ยังไม่มีคำแปลที่บันทึกพร้อมแสดง โปรดบันทึกภาษานี้ก่อน",
        reviewSubmit: "ส่งตรวจทาน",
        approve: "อนุมัติคำแปล",
        unpublish: "ยกเลิกเผยแพร่",
        unpublishConfirm:
          "ยกเลิกเผยแพร่หน้านี้หรือไม่? ผู้เข้าชมจะไม่เห็นหน้านี้ แต่แบบร่างที่บันทึกจะยังอยู่",
        publishHint: "ต้องให้ผู้ตรวจทานอีกคนอนุมัติครบทั้งเจ็ดภาษาก่อนเผยแพร่",
        savedOnly:
          "ตัวอย่างนี้แสดงเวอร์ชันที่บันทึกแล้ว บันทึกการเปลี่ยนแปลงเพื่ออัปเดต",
        sourceFirst: "บันทึกต้นฉบับภาษาอังกฤษก่อนเพิ่มคำแปล",
        sourceChanged:
          "ต้นฉบับภาษาอังกฤษเปลี่ยนแล้ว โปรดเปรียบเทียบและอัปเดตคำแปลก่อนส่งตรวจทาน",
        restoreConfirm:
          "คืนค่าหน้านี้หรือไม่? แบบร่างและเวอร์ชันเผยแพร่ปัจจุบันจะถูกแทนที่ หน้าและการตั้งค่าอื่นคงเดิม",
        intro: "แก้ไขหน้า ตรวจทานคำแปล แล้วเผยแพร่",
        unpublished: "ยกเลิกเผยแพร่หน้าแล้ว",
        published: "เผยแพร่หน้าแล้ว",
        restored: "คืนค่าหน้าแล้ว",
        live: "หน้าที่เผยแพร่",
        noHistory: "เวอร์ชันที่เผยแพร่จะแสดงที่นี่",
        conflict: "ผู้ดูแลคนอื่นอัปเดตหน้านี้แล้ว โปรดโหลดใหม่",
        discard: "ละทิ้งการเปลี่ยนแปลงที่ยังไม่บันทึกและออกหรือไม่?",
        newTranslation: "ย่อหน้าใหม่: ต้องแปล",
      };
    case "vi":
      return {
        title: "Trang thông tin",
        about: "Giới thiệu",
        faq: "Câu hỏi thường gặp",
        support: "Hỗ trợ",
        pageTitle: "Tiêu đề trang",
        summary: "Giới thiệu ngắn",
        heading: "Tiêu đề đoạn",
        body: "Nội dung",
        question: "Câu hỏi",
        answer: "Trả lời",
        contactEmail: "Email liên hệ công khai (tùy chọn)",
        addSection: "Thêm đoạn",
        removeSection: "Xóa đoạn",
        translations: "Bản dịch và xét duyệt",
        source: "Bản gốc tiếng Anh",
        previewMissing:
          "Chưa có bản dịch đã lưu để xem trước. Hãy lưu ngôn ngữ này trước.",
        reviewSubmit: "Gửi xét duyệt",
        approve: "Duyệt bản dịch",
        unpublish: "Ngừng xuất bản",
        unpublishConfirm:
          "Ngừng xuất bản trang này? Khách truy cập sẽ không còn thấy trang. Bản nháp đã lưu vẫn được giữ.",
        publishHint:
          "Cả bảy ngôn ngữ cần được người khác duyệt trước khi xuất bản.",
        savedOnly:
          "Bản xem trước chỉ hiển thị nội dung đã lưu. Hãy lưu thay đổi để cập nhật.",
        sourceFirst: "Lưu bản gốc tiếng Anh trước khi thêm bản dịch.",
        sourceChanged:
          "Bản gốc tiếng Anh đã đổi. Hãy đối chiếu và cập nhật bản dịch trước khi gửi duyệt.",
        restoreConfirm:
          "Khôi phục trang này? Bản nháp và phiên bản đã xuất bản sẽ được thay thế. Các trang và cài đặt khác không đổi.",
        intro: "Chỉnh sửa trang, xét duyệt bản dịch rồi xuất bản.",
        unpublished: "Đã ngừng xuất bản trang",
        published: "Đã xuất bản trang",
        restored: "Đã khôi phục trang",
        live: "Trang đã xuất bản",
        noHistory: "Các phiên bản đã xuất bản sẽ xuất hiện ở đây.",
        conflict: "Người quản lý khác đã cập nhật trang. Hãy tải lại.",
        discard: "Bỏ thay đổi chưa lưu và rời trang?",
        newTranslation: "Đoạn mới: cần bản dịch",
      };
    case "es":
      return {
        title: "Páginas de información",
        about: "Acerca de",
        faq: "Preguntas frecuentes",
        support: "Ayuda",
        pageTitle: "Título de la página",
        summary: "Introducción breve",
        heading: "Título de sección",
        body: "Contenido",
        question: "Pregunta",
        answer: "Respuesta",
        contactEmail: "Correo de contacto público (opcional)",
        addSection: "Añadir sección",
        removeSection: "Eliminar sección",
        translations: "Traducciones y revisión",
        source: "Original en inglés",
        previewMissing:
          "No hay una traducción guardada lista para la vista previa. Guarda este idioma primero.",
        reviewSubmit: "Enviar a revisión",
        approve: "Aprobar traducción",
        unpublish: "Retirar publicación",
        unpublishConfirm:
          "¿Retirar esta página? Los visitantes dejarán de verla. Se conserva el borrador guardado.",
        publishHint:
          "Los siete idiomas deben ser aprobados por otra persona antes de publicar.",
        savedOnly:
          "Esta vista muestra la versión guardada. Guarda los cambios para actualizarla.",
        sourceFirst:
          "Guarda el original en inglés antes de añadir traducciones.",
        sourceChanged:
          "El original en inglés cambió. Compáralo y actualiza la traducción antes de solicitar revisión.",
        restoreConfirm:
          "¿Restaurar esta página? Sustituirá el borrador y la publicación actuales. Otras páginas y ajustes no cambiarán.",
        intro: "Edita la página, revisa las traducciones y publica.",
        unpublished: "Página retirada",
        published: "Página publicada",
        restored: "Página restaurada",
        live: "Página publicada",
        noHistory: "Las versiones publicadas aparecerán aquí.",
        conflict: "Otra persona actualizó esta página. Recarga para continuar.",
        discard: "¿Descartar los cambios sin guardar y salir?",
        newTranslation: "Sección nueva: traducción pendiente",
      };
    case "pt":
      return {
        title: "Páginas de informações",
        about: "Sobre",
        faq: "Perguntas frequentes",
        support: "Suporte",
        pageTitle: "Título da página",
        summary: "Introdução breve",
        heading: "Título da seção",
        body: "Conteúdo",
        question: "Pergunta",
        answer: "Resposta",
        contactEmail: "Email público de contato (opcional)",
        addSection: "Adicionar seção",
        removeSection: "Remover seção",
        translations: "Traduções e revisão",
        source: "Original em inglês",
        previewMissing:
          "Não há tradução salva pronta para a prévia. Salve este idioma primeiro.",
        reviewSubmit: "Enviar para revisão",
        approve: "Aprovar tradução",
        unpublish: "Despublicar",
        unpublishConfirm:
          "Despublicar esta página? Os visitantes deixarão de vê-la. O rascunho salvo será mantido.",
        publishHint:
          "Os sete idiomas precisam da aprovação de outra pessoa antes da publicação.",
        savedOnly:
          "Esta prévia mostra a versão salva. Salve as alterações para atualizá-la.",
        sourceFirst: "Salve o original em inglês antes de adicionar traduções.",
        sourceChanged:
          "O original em inglês mudou. Compare e atualize a tradução antes de enviar para revisão.",
        restoreConfirm:
          "Restaurar esta página? O rascunho e a publicação atuais serão substituídos. Outras páginas e configurações não mudarão.",
        intro: "Edite a página, revise as traduções e publique.",
        unpublished: "Página despublicada",
        published: "Página publicada",
        restored: "Página restaurada",
        live: "Página publicada",
        noHistory: "As versões publicadas aparecerão aqui.",
        conflict:
          "Outra pessoa atualizou esta página. Recarregue para continuar.",
        discard: "Descartar as alterações não salvas e sair?",
        newTranslation: "Nova seção: tradução necessária",
      };
  }
}
export function informationCopy(locale: SupportedLocale) {
  return { ...decorationCopy(locale), ...labels(locale) };
}
export type InformationCopy = ReturnType<typeof informationCopy>;
