import type { SupportedLocale } from "@fan-support/contracts";
const en = {
  title: "Policies",
  intro:
    "Edit a new revision, review each language, then publish all seven together.",
  choose: "Policy",
  empty: "No registered policies are available.",
  contentLanguage: "Content language",
  source: "English source",
  policyTitle: "Title",
  summary: "Summary",
  body: "Policy text",
  markupHint:
    "Supported HTML: p, br, strong, em, ul, ol, li. Attributes and links are not allowed.",
  effectiveAt: "Effective time (UTC)",
  effectiveHint:
    "Choose a time after this new revision is saved. Publication becomes available at that time; all seven languages must be approved first.",
  provenance: "Content origin",
  human: "Human authored",
  machine: "Machine assisted",
  imported: "Verified import",
  save: "Save new revision",
  saved:
    "New revision saved. Review the current language statuses before publishing.",
  pending: "Unsaved changes",
  preview: "Content preview",
  previewHint:
    "Preview of the text in this editor. Saving and publishing are separate actions.",
  invalid:
    "Check the required fields, text limits and allowed HTML before saving or previewing.",
  importTitle: "Seven language content package",
  importHint:
    "Loads draft text only. Select a JSON package, then apply its matching policy. Existing approvals are never imported.",
  importFile: "JSON content package",
  applyImport: "Apply to this policy",
  packageReady:
    "Package loaded. Apply each policy separately and save its new revision.",
  invalidPackage:
    "This package is invalid. Each policy needs seven distinct languages, valid text and explicit HUMAN or MACHINE origin.",
  packageMismatch: "The package has no document matching this policy type.",
  reviewHint:
    "Each language, including English, requires approval by an authorized reviewer other than its editor and structure editor. Machine text is never automatically approved.",
  submit: "Submit this language",
  approve: "Approve this language",
  reviewed: "I have checked this language against the English source.",
  independent: "Another authorized reviewer must approve this text.",
  scope: "Your permissions do not allow this action or all required languages.",
  noRevision:
    "This policy has no readable revision. Ask an authorized content administrator to prepare its source.",
  discard: "Discard unsaved policy changes?",
  reload: "Reload current version",
  stale:
    "The saved version has changed. Keep your edits for reference, then reload before trying again.",
  expired: "Your session has expired. Sign in again before continuing.",
  requestFailed:
    "The request could not be confirmed. Your unsaved text is retained; retry or reload the current version.",
  saveFirst: "Save or discard your edits before reviewing or publishing.",
  reviewSaved: "Review action recorded. Current status has been reloaded.",
  importedDraft:
    "Package text is staged locally. Save a new revision to request review.",
  futureTime: "Enter a valid future UTC time for the new revision.",
  missing: "Missing",
  restricted: "Restricted",
  latest: "Current saved version",
  localOnly: "Local edits",
  terms: "Terms",
  privacy: "Privacy",
  refund: "Refunds",
  delivery: "Delivery",
};
type BaseCopy = { [K in keyof typeof en]: string };
const zhCN: BaseCopy = {
  title: "政策",
  intro: "编辑新版本，逐语言审核，再同步发布全部七种语言。",
  choose: "政策",
  empty: "暂无已登记的政策。",
  contentLanguage: "内容语言",
  source: "英文原文",
  policyTitle: "标题",
  summary: "摘要",
  body: "政策正文",
  markupHint: "支持 HTML：p、br、strong、em、ul、ol、li，不允许属性或链接。",
  effectiveAt: "生效时间（UTC）",
  effectiveHint: "请选择晚于新版本保存的时间；到时且七语言全部批准后方可发布。",
  provenance: "内容来源",
  human: "人工撰写",
  machine: "机器辅助",
  imported: "已验证导入",
  save: "保存新版本",
  saved: "新版本已保存。发布前请核对当前语言审核状态。",
  pending: "未保存的修改",
  preview: "正文预览",
  previewHint: "预览编辑器中的正文；保存和发布是独立操作。",
  invalid: "请检查必填内容、字数限制及允许的 HTML 格式。",
  importTitle: "七语言内容包",
  importHint:
    "仅载入草稿正文。选择 JSON 内容包后应用对应政策，不导入或伪造批准记录。",
  importFile: "JSON 内容包",
  applyImport: "应用到当前政策",
  packageReady: "内容包已载入。请逐政策应用并保存新版本。",
  invalidPackage:
    "内容包无效：每份政策必须包含七种不同语言、有效正文及明确的 HUMAN 或 MACHINE 来源。",
  packageMismatch: "内容包未包含当前政策类型。",
  reviewHint:
    "包括英文在内的每种语言均须由非正文编辑者、非结构编辑者的授权审校人批准；机器文案不会自动获批。",
  submit: "提交本语言审核",
  approve: "批准本语言",
  reviewed: "我已对照英文原文核对本语言。",
  independent: "须由另一位授权审校人批准。",
  scope: "当前权限未涵盖此操作或所需的全部语言。",
  noRevision: "此政策暂无可读取的版本，请联系有权限的内容管理员准备原文。",
  discard: "放弃未保存的政策修改？",
  reload: "重新读取当前版本",
  stale: "已保存版本发生变化。请保留修改供参考，再重新读取后操作。",
  expired: "登录已过期，请重新登录后继续。",
  requestFailed: "请求未得到确认，未保存正文仍保留；可重试或重新读取当前版本。",
  saveFirst: "审核或发布前，请先保存或放弃修改。",
  reviewSaved: "审核操作已记录，当前状态已重新读取。",
  importedDraft: "内容包已填入本地草稿，保存新版本后才能提交审核。",
  futureTime: "请输入有效且晚于当前时间的 UTC 生效时间。",
  missing: "缺少译文",
  restricted: "无读取权限",
  latest: "当前保存版本",
  localOnly: "本地修改",
  terms: "服务条款",
  privacy: "隐私",
  refund: "退款",
  delivery: "交付",
};
const th: BaseCopy = {
  title: "นโยบาย",
  intro: "แก้ไขฉบับใหม่ ตรวจทานแต่ละภาษา แล้วเผยแพร่ทั้งเจ็ดภาษาพร้อมกัน",
  choose: "นโยบาย",
  empty: "ไม่มีนโยบายที่ลงทะเบียนไว้",
  contentLanguage: "ภาษาเนื้อหา",
  source: "ต้นฉบับภาษาอังกฤษ",
  policyTitle: "ชื่อเรื่อง",
  summary: "สรุป",
  body: "ข้อความนโยบาย",
  markupHint:
    "รองรับ HTML: p, br, strong, em, ul, ol, li ไม่อนุญาตแอตทริบิวต์หรือลิงก์",
  effectiveAt: "เวลาเริ่มใช้ (UTC)",
  effectiveHint:
    "เลือกเวลาหลังบันทึกฉบับใหม่ เผยแพร่ได้เมื่อถึงเวลานั้นและทั้งเจ็ดภาษาได้รับอนุมัติแล้ว",
  provenance: "ที่มาของเนื้อหา",
  human: "เขียนโดยมนุษย์",
  machine: "ใช้เครื่องมือช่วยเขียน",
  imported: "การนำเข้าที่ตรวจสอบแล้ว",
  save: "บันทึกฉบับใหม่",
  saved: "บันทึกฉบับใหม่แล้ว ตรวจสอบสถานะภาษาก่อนเผยแพร่",
  pending: "มีการแก้ไขที่ยังไม่บันทึก",
  preview: "ตัวอย่างเนื้อหา",
  previewHint: "แสดงข้อความในตัวแก้ไข การบันทึกและการเผยแพร่เป็นคนละขั้นตอน",
  invalid: "ตรวจสอบช่องที่จำเป็น ความยาวข้อความ และรูปแบบ HTML ที่อนุญาต",
  importTitle: "ชุดเนื้อหาเจ็ดภาษา",
  importHint:
    "โหลดเฉพาะข้อความร่าง เลือกไฟล์ JSON แล้วใช้กับนโยบายที่ตรงกัน ไม่ได้นำเข้าการอนุมัติ",
  importFile: "ชุดเนื้อหา JSON",
  applyImport: "ใช้กับนโยบายนี้",
  packageReady: "โหลดชุดเนื้อหาแล้ว ใช้และบันทึกแต่ละนโยบายแยกกัน",
  invalidPackage:
    "ชุดเนื้อหาไม่ถูกต้อง แต่ละนโยบายต้องมีเจ็ดภาษาที่ไม่ซ้ำ เนื้อหาที่ถูกต้อง และที่มา HUMAN หรือ MACHINE",
  packageMismatch: "ไม่มีเอกสารประเภทนโยบายนี้ในชุดเนื้อหา",
  reviewHint:
    "ทุกภาษารวมทั้งอังกฤษต้องได้รับอนุมัติจากผู้ตรวจทานที่มีสิทธิ์ซึ่งไม่ใช่ผู้แก้ไขข้อความหรือโครงสร้าง ข้อความจากเครื่องมือไม่ได้รับอนุมัติอัตโนมัติ",
  submit: "ส่งภาษานี้ตรวจทาน",
  approve: "อนุมัติภาษานี้",
  reviewed: "ฉันตรวจภาษานี้เทียบกับต้นฉบับภาษาอังกฤษแล้ว",
  independent: "ต้องให้ผู้ตรวจทานที่มีสิทธิ์คนอื่นอนุมัติ",
  scope: "สิทธิ์ของคุณไม่ครอบคลุมการดำเนินการนี้หรือทุกภาษาที่จำเป็น",
  noRevision:
    "นโยบายนี้ยังไม่มีฉบับที่อ่านได้ โปรดให้ผู้ดูแลเนื้อหาที่มีสิทธิ์เตรียมต้นฉบับ",
  discard: "ทิ้งการแก้ไขนโยบายที่ยังไม่บันทึกหรือไม่",
  reload: "โหลดฉบับปัจจุบันใหม่",
  stale:
    "ฉบับที่บันทึกเปลี่ยนไปแล้ว เก็บข้อความแก้ไขไว้อ้างอิงและโหลดใหม่ก่อนลองอีกครั้ง",
  expired: "เซสชันหมดอายุแล้ว โปรดเข้าสู่ระบบอีกครั้ง",
  requestFailed:
    "ยังยืนยันคำขอไม่ได้ ข้อความที่ยังไม่บันทึกยังอยู่ ลองอีกครั้งหรือโหลดฉบับปัจจุบันใหม่",
  saveFirst: "บันทึกหรือทิ้งการแก้ไขก่อนตรวจทานหรือเผยแพร่",
  reviewSaved: "บันทึกการตรวจทานและโหลดสถานะปัจจุบันแล้ว",
  importedDraft:
    "ใส่ข้อความในร่างภายในเครื่องแล้ว บันทึกฉบับใหม่ก่อนส่งตรวจทาน",
  futureTime: "ระบุเวลา UTC ในอนาคตที่ถูกต้องสำหรับฉบับใหม่",
  missing: "ยังไม่มี",
  restricted: "จำกัดสิทธิ์",
  latest: "ฉบับที่บันทึกปัจจุบัน",
  localOnly: "การแก้ไขในเครื่อง",
  terms: "ข้อกำหนด",
  privacy: "ความเป็นส่วนตัว",
  refund: "การคืนเงิน",
  delivery: "การส่งมอบ",
};
const vi: BaseCopy = {
  title: "Chính sách",
  intro:
    "Soạn phiên bản mới, duyệt từng ngôn ngữ rồi xuất bản đồng thời cả bảy ngôn ngữ.",
  choose: "Chính sách",
  empty: "Chưa có chính sách đã đăng ký.",
  contentLanguage: "Ngôn ngữ nội dung",
  source: "Bản gốc tiếng Anh",
  policyTitle: "Tiêu đề",
  summary: "Tóm tắt",
  body: "Nội dung chính sách",
  markupHint:
    "HTML được phép: p, br, strong, em, ul, ol, li. Không dùng thuộc tính hoặc liên kết.",
  effectiveAt: "Thời điểm có hiệu lực (UTC)",
  effectiveHint:
    "Chọn thời điểm sau khi lưu phiên bản mới. Chỉ có thể xuất bản từ thời điểm đó khi cả bảy ngôn ngữ đã được duyệt.",
  provenance: "Nguồn nội dung",
  human: "Do người viết",
  machine: "Có máy hỗ trợ",
  imported: "Bản nhập đã xác minh",
  save: "Lưu phiên bản mới",
  saved:
    "Đã lưu phiên bản mới. Kiểm tra trạng thái ngôn ngữ trước khi xuất bản.",
  pending: "Thay đổi chưa lưu",
  preview: "Xem trước nội dung",
  previewHint:
    "Xem nội dung trong trình soạn thảo. Lưu và xuất bản là hai thao tác riêng.",
  invalid: "Kiểm tra nội dung bắt buộc, giới hạn độ dài và HTML được phép.",
  importTitle: "Gói nội dung bảy ngôn ngữ",
  importHint:
    "Chỉ tải văn bản nháp. Chọn gói JSON rồi áp dụng đúng chính sách. Không nhập trạng thái phê duyệt.",
  importFile: "Gói nội dung JSON",
  applyImport: "Áp dụng cho chính sách này",
  packageReady:
    "Đã tải gói. Áp dụng từng chính sách và lưu phiên bản mới riêng.",
  invalidPackage:
    "Gói không hợp lệ. Mỗi chính sách cần bảy ngôn ngữ khác nhau, nội dung hợp lệ và nguồn HUMAN hoặc MACHINE.",
  packageMismatch: "Gói không có tài liệu thuộc loại chính sách này.",
  reviewHint:
    "Mỗi ngôn ngữ, kể cả tiếng Anh, cần người duyệt có quyền khác với người sửa nội dung và cấu trúc. Văn bản máy không tự động được duyệt.",
  submit: "Gửi duyệt ngôn ngữ này",
  approve: "Duyệt ngôn ngữ này",
  reviewed: "Tôi đã đối chiếu ngôn ngữ này với bản gốc tiếng Anh.",
  independent: "Cần một người duyệt có quyền khác phê duyệt.",
  scope: "Quyền của bạn không bao gồm thao tác hoặc đủ các ngôn ngữ cần thiết.",
  noRevision:
    "Chính sách chưa có phiên bản có thể đọc. Hãy nhờ quản trị viên nội dung có quyền chuẩn bị bản gốc.",
  discard: "Bỏ các thay đổi chính sách chưa lưu?",
  reload: "Tải lại phiên bản hiện tại",
  stale:
    "Phiên bản đã lưu đã thay đổi. Giữ nội dung sửa để tham khảo rồi tải lại trước khi thử.",
  expired: "Phiên đăng nhập hết hạn. Hãy đăng nhập lại.",
  requestFailed:
    "Chưa xác nhận được yêu cầu. Nội dung chưa lưu vẫn được giữ; hãy thử lại hoặc tải phiên bản hiện tại.",
  saveFirst: "Lưu hoặc bỏ thay đổi trước khi duyệt hay xuất bản.",
  reviewSaved: "Đã ghi nhận thao tác duyệt và tải lại trạng thái.",
  importedDraft:
    "Nội dung gói đã được điền vào bản nháp cục bộ. Lưu phiên bản mới trước khi gửi duyệt.",
  futureTime: "Nhập thời điểm UTC hợp lệ trong tương lai cho phiên bản mới.",
  missing: "Còn thiếu",
  restricted: "Hạn chế",
  latest: "Phiên bản đã lưu hiện tại",
  localOnly: "Thay đổi cục bộ",
  terms: "Điều khoản",
  privacy: "Quyền riêng tư",
  refund: "Hoàn tiền",
  delivery: "Giao tặng",
};
const ja: BaseCopy = {
  title: "ポリシー",
  intro: "新しい版を編集し、言語ごとに審査してから全7言語を同時に公開します。",
  choose: "ポリシー",
  empty: "登録済みのポリシーがありません。",
  contentLanguage: "コンテンツの言語",
  source: "英語の原文",
  policyTitle: "タイトル",
  summary: "概要",
  body: "ポリシー本文",
  markupHint:
    "使用可能なHTML：p、br、strong、em、ul、ol、li。属性とリンクは使用できません。",
  effectiveAt: "適用開始日時（UTC）",
  effectiveHint:
    "新しい版の保存後の日時を指定してください。その日時以降、全7言語の承認が揃うと公開できます。",
  provenance: "文章の作成元",
  human: "人による執筆",
  machine: "機械による支援",
  imported: "検証済みインポート",
  save: "新しい版を保存",
  saved: "新しい版を保存しました。公開前に各言語の審査状況をご確認ください。",
  pending: "未保存の変更",
  preview: "本文プレビュー",
  previewHint: "編集中の本文を表示します。保存と公開は別の操作です。",
  invalid: "必須項目、文字数制限、使用可能なHTMLをご確認ください。",
  importTitle: "7言語のコンテンツパッケージ",
  importHint:
    "下書きの本文のみ読み込みます。JSONを選択して対応するポリシーに適用してください。承認情報は読み込みません。",
  importFile: "JSONコンテンツパッケージ",
  applyImport: "このポリシーに適用",
  packageReady:
    "読み込みました。ポリシーごとに適用し、新しい版を保存してください。",
  invalidPackage:
    "無効なパッケージです。各ポリシーに重複しない7言語、有効な本文、HUMANまたはMACHINEの作成元が必要です。",
  packageMismatch: "この種類のポリシーはパッケージに含まれていません。",
  reviewHint:
    "英語を含む各言語は、本文・構造の編集者とは別の権限ある審査者の承認が必要です。機械生成文は自動承認されません。",
  submit: "この言語を審査に提出",
  approve: "この言語を承認",
  reviewed: "英語の原文と照合してこの言語を確認しました。",
  independent: "別の権限ある審査者による承認が必要です。",
  scope: "この操作または必要な全言語に対する権限がありません。",
  noRevision:
    "読み取り可能な版がありません。権限のある管理者に原文の準備を依頼してください。",
  discard: "未保存のポリシー変更を破棄しますか？",
  reload: "現在の版を再読み込み",
  stale:
    "保存済みの版が変更されました。編集内容を控えたうえで再読み込みしてください。",
  expired: "セッションが切れました。再度ログインしてください。",
  requestFailed:
    "リクエストを確認できませんでした。未保存の本文は保持されています。再試行するか現在の版を読み込んでください。",
  saveFirst: "審査・公開の前に変更を保存または破棄してください。",
  reviewSaved: "審査操作を記録し、現在の状態を再読み込みしました。",
  importedDraft:
    "本文をローカルの下書きに適用しました。新しい版を保存してから審査に提出してください。",
  futureTime: "新しい版の適用開始日時を有効な将来のUTC日時で入力してください。",
  missing: "未作成",
  restricted: "閲覧制限",
  latest: "現在の保存済みの版",
  localOnly: "ローカルの編集",
  terms: "利用規約",
  privacy: "プライバシー",
  refund: "返金",
  delivery: "お届け",
};
const es: BaseCopy = {
  title: "Políticas",
  intro:
    "Edita una nueva versión, revisa cada idioma y publica los siete juntos.",
  choose: "Política",
  empty: "No hay políticas registradas disponibles.",
  contentLanguage: "Idioma del contenido",
  source: "Original en inglés",
  policyTitle: "Título",
  summary: "Resumen",
  body: "Texto de la política",
  markupHint:
    "HTML permitido: p, br, strong, em, ul, ol, li. No se permiten atributos ni enlaces.",
  effectiveAt: "Fecha de entrada en vigor (UTC)",
  effectiveHint:
    "Elige una fecha posterior al guardado. Podrás publicar desde esa fecha cuando los siete idiomas estén aprobados.",
  provenance: "Origen del contenido",
  human: "Redacción humana",
  machine: "Asistencia automática",
  imported: "Importación verificada",
  save: "Guardar nueva versión",
  saved:
    "Nueva versión guardada. Comprueba el estado de los idiomas antes de publicar.",
  pending: "Cambios sin guardar",
  preview: "Vista previa del contenido",
  previewHint:
    "Muestra el texto del editor. Guardar y publicar son acciones independientes.",
  invalid:
    "Comprueba los campos obligatorios, los límites de texto y el HTML permitido.",
  importTitle: "Paquete de contenido en siete idiomas",
  importHint:
    "Solo carga texto de borrador. Selecciona un JSON y aplícalo a la política correspondiente. No se importan aprobaciones.",
  importFile: "Paquete de contenido JSON",
  applyImport: "Aplicar a esta política",
  packageReady:
    "Paquete cargado. Aplica y guarda una nueva versión de cada política por separado.",
  invalidPackage:
    "Paquete no válido. Cada política necesita siete idiomas distintos, texto válido y origen HUMAN o MACHINE explícito.",
  packageMismatch: "El paquete no contiene este tipo de política.",
  reviewHint:
    "Cada idioma, incluido el inglés, requiere un revisor autorizado distinto del editor del texto y de la estructura. El texto automático nunca se aprueba por sí solo.",
  submit: "Enviar este idioma a revisión",
  approve: "Aprobar este idioma",
  reviewed: "He comparado este idioma con el original en inglés.",
  independent: "Debe aprobarlo otro revisor autorizado.",
  scope: "Tus permisos no incluyen esta acción o todos los idiomas necesarios.",
  noRevision:
    "No hay una versión legible de esta política. Pide a un administrador autorizado que prepare el original.",
  discard: "¿Descartar los cambios sin guardar?",
  reload: "Recargar la versión actual",
  stale:
    "La versión guardada ha cambiado. Conserva tus cambios como referencia y recarga antes de reintentar.",
  expired: "La sesión ha caducado. Inicia sesión de nuevo.",
  requestFailed:
    "No se pudo confirmar la solicitud. Se conserva el texto sin guardar; reintenta o recarga la versión actual.",
  saveFirst: "Guarda o descarta los cambios antes de revisar o publicar.",
  reviewSaved: "Revisión registrada. Se ha recargado el estado actual.",
  importedDraft:
    "El texto se ha aplicado al borrador local. Guarda una nueva versión antes de solicitar revisión.",
  futureTime: "Introduce una fecha UTC futura válida para la nueva versión.",
  missing: "Falta",
  restricted: "Restringido",
  latest: "Versión guardada actual",
  localOnly: "Cambios locales",
  terms: "Condiciones",
  privacy: "Privacidad",
  refund: "Reembolsos",
  delivery: "Entrega",
};
const pt: BaseCopy = {
  title: "Políticas",
  intro: "Edite uma nova versão, revise cada idioma e publique os sete juntos.",
  choose: "Política",
  empty: "Não há políticas registradas disponíveis.",
  contentLanguage: "Idioma do conteúdo",
  source: "Original em inglês",
  policyTitle: "Título",
  summary: "Resumo",
  body: "Texto da política",
  markupHint:
    "HTML permitido: p, br, strong, em, ul, ol, li. Atributos e links não são permitidos.",
  effectiveAt: "Data de vigência (UTC)",
  effectiveHint:
    "Escolha uma data posterior ao salvamento. A publicação estará disponível nessa data, com os sete idiomas aprovados.",
  provenance: "Origem do conteúdo",
  human: "Redação humana",
  machine: "Assistência automática",
  imported: "Importação verificada",
  save: "Salvar nova versão",
  saved: "Nova versão salva. Confira os estados dos idiomas antes de publicar.",
  pending: "Alterações não salvas",
  preview: "Prévia do conteúdo",
  previewHint:
    "Exibe o texto do editor. Salvar e publicar são ações separadas.",
  invalid:
    "Confira os campos obrigatórios, os limites de texto e o HTML permitido.",
  importTitle: "Pacote de conteúdo em sete idiomas",
  importHint:
    "Carrega apenas texto de rascunho. Selecione um JSON e aplique à política correspondente. Aprovações não são importadas.",
  importFile: "Pacote de conteúdo JSON",
  applyImport: "Aplicar a esta política",
  packageReady:
    "Pacote carregado. Aplique cada política e salve uma nova versão separadamente.",
  invalidPackage:
    "Pacote inválido. Cada política precisa de sete idiomas distintos, texto válido e origem HUMAN ou MACHINE explícita.",
  packageMismatch: "O pacote não contém este tipo de política.",
  reviewHint:
    "Cada idioma, inclusive o inglês, exige aprovação de um revisor autorizado diferente dos editores do texto e da estrutura. Texto automático nunca é aprovado automaticamente.",
  submit: "Enviar este idioma para revisão",
  approve: "Aprovar este idioma",
  reviewed: "Conferi este idioma com o original em inglês.",
  independent: "Outro revisor autorizado precisa aprovar este texto.",
  scope:
    "Suas permissões não incluem esta ação ou todos os idiomas necessários.",
  noRevision:
    "Esta política não tem uma versão disponível para leitura. Peça a um administrador autorizado que prepare o original.",
  discard: "Descartar alterações não salvas?",
  reload: "Recarregar versão atual",
  stale:
    "A versão salva mudou. Guarde as alterações como referência e recarregue antes de tentar novamente.",
  expired: "A sessão expirou. Entre novamente para continuar.",
  requestFailed:
    "Não foi possível confirmar a solicitação. O texto não salvo foi mantido; tente novamente ou recarregue a versão atual.",
  saveFirst: "Salve ou descarte as alterações antes de revisar ou publicar.",
  reviewSaved: "Revisão registrada. O estado atual foi recarregado.",
  importedDraft:
    "O texto foi aplicado ao rascunho local. Salve uma nova versão antes de solicitar revisão.",
  futureTime: "Informe uma data UTC futura válida para a nova versão.",
  missing: "Ausente",
  restricted: "Restrito",
  latest: "Versão salva atual",
  localOnly: "Alterações locais",
  terms: "Termos",
  privacy: "Privacidade",
  refund: "Reembolsos",
  delivery: "Entrega",
};
function baseCopy(locale: SupportedLocale): BaseCopy {
  switch (locale) {
    case "en":
      return en;
    case "zh-CN":
      return zhCN;
    case "th":
      return th;
    case "vi":
      return vi;
    case "ja":
      return ja;
    case "es":
      return es;
    case "pt":
      return pt;
  }
}
type RegistrationCopy = {
  create: string;
  key: string;
  type: string;
  keyHint: string;
};
function registrationCopy(locale: SupportedLocale): RegistrationCopy {
  switch (locale) {
    case "en":
      return {
        create: "Register a policy",
        key: "Policy key",
        type: "Policy type",
        keyHint:
          "Choose a unique stable key using lowercase letters, digits and hyphens. Registration does not publish content.",
      };
    case "zh-CN":
      return {
        create: "登记政策",
        key: "政策标识",
        type: "政策类型",
        keyHint:
          "使用小写字母、数字和连字符填写唯一且稳定的标识；登记不会发布正文。",
      };
    case "th":
      return {
        create: "ลงทะเบียนนโยบาย",
        key: "รหัสนโยบาย",
        type: "ประเภทนโยบาย",
        keyHint:
          "เลือกรหัสถาวรที่ไม่ซ้ำโดยใช้อักษรอังกฤษตัวเล็ก ตัวเลข และขีดกลาง การลงทะเบียนไม่ใช่การเผยแพร่",
      };
    case "vi":
      return {
        create: "Đăng ký chính sách",
        key: "Mã chính sách",
        type: "Loại chính sách",
        keyHint:
          "Chọn mã cố định duy nhất bằng chữ thường, chữ số và dấu gạch nối. Đăng ký không xuất bản nội dung.",
      };
    case "ja":
      return {
        create: "ポリシーを登録",
        key: "ポリシー識別子",
        type: "ポリシーの種類",
        keyHint:
          "英小文字・数字・ハイフンで重複しない固定識別子を指定してください。登録だけでは公開されません。",
      };
    case "es":
      return {
        create: "Registrar una política",
        key: "Identificador de política",
        type: "Tipo de política",
        keyHint:
          "Elige un identificador único y estable con minúsculas, números y guiones. Registrar no publica el contenido.",
      };
    case "pt":
      return {
        create: "Registrar política",
        key: "Identificador da política",
        type: "Tipo de política",
        keyHint:
          "Escolha um identificador único e estável com minúsculas, números e hífens. Registrar não publica o conteúdo.",
      };
  }
}
function sourceRefresh(locale: SupportedLocale): string {
  switch (locale) {
    case "en":
      return "Confirm this text matches the current English source";
    case "zh-CN":
      return "确认本译文已对应当前英文原文";
    case "th":
      return "ยืนยันว่าข้อความนี้ตรงกับต้นฉบับภาษาอังกฤษปัจจุบัน";
    case "vi":
      return "Xác nhận bản dịch khớp với bản gốc tiếng Anh hiện tại";
    case "ja":
      return "この訳文が現在の英語原文に対応していることを確認";
    case "es":
      return "Confirmar que este texto corresponde al original inglés actual";
    case "pt":
      return "Confirmar que o texto corresponde ao original inglês atual";
  }
}
export type PoliciesCopy = BaseCopy &
  RegistrationCopy & { sourceRefresh: string };
export const policiesCopy = (locale: SupportedLocale): PoliciesCopy => ({
  ...baseCopy(locale),
  ...registrationCopy(locale),
  sourceRefresh: sourceRefresh(locale),
});
