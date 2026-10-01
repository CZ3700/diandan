import type { SupportedLocale } from "@fan-support/contracts";
import { decorationCopy, type DecorationCopy } from "./copy";

type BrandLabels = {
  title: string;
  intro: string;
  lightLogo: string;
  darkLogo: string;
  upload: string;
  replace: string;
  remove: string;
  empty: string;
  imageHint: string;
  uploading: string;
  uploadError: string;
  imageFormat: string;
  imageSize: string;
  imageUnavailable: string;
  uploadPermission: string;
  history: string;
  noHistory: string;
  published: string;
  restored: string;
  live: string;
  unset: string;
  cancelUpload: string;
  conflict: string;
  discard: string;
  restoreConfirm: string;
  previewHint: string;
  previewScheme: string;
  light: string;
  dark: string;
  retry: string;
};
function brandLabels(locale: SupportedLocale): BrandLabels {
  switch (locale) {
    case "en":
      return {
        title: "Brand logo",
        intro: "Upload a logo for light and dark backgrounds.",
        lightLogo: "On light backgrounds",
        darkLogo: "On dark backgrounds",
        upload: "Upload logo",
        replace: "Replace logo",
        remove: "Remove logo",
        empty: "The store name appears when no logo is set.",
        imageHint:
          "A horizontal PNG or WebP with a transparent background works best. JPEG and AVIF are also supported, up to 25 MiB. Use only logos you have permission to display.",
        uploading: "Preparing logo…",
        uploadError:
          "The logo could not be prepared. Your selection is kept; retry or choose another file.",
        imageFormat: "Choose a PNG, WebP, JPEG or AVIF image.",
        imageSize: "Choose a non-empty image no larger than 25 MiB.",
        imageUnavailable: "Logo unavailable",
        uploadPermission: "Your account cannot upload logos.",
        history: "Logo publication history",
        noHistory: "Published logo versions will appear here.",
        published: "Logo settings published",
        restored: "Logo settings restored",
        live: "Published logo settings",
        unset: "Logo not set yet",
        cancelUpload: "Cancel selection",
        conflict:
          "Another operator changed the logo settings. Reload the latest version before continuing.",
        discard: "Discard your unsaved logo changes?",
        restoreConfirm:
          "Restore these logos? The current logos and their draft will be replaced. Other store settings stay as they are.",
        previewHint:
          "Prepared logos appear in the real store preview. Save and publish to make them live.",
        previewScheme: "Preview background",
        light: "Light",
        dark: "Dark",
        retry: "Retry",
      };
    case "zh-CN":
      return {
        title: "品牌标识",
        intro: "分别设置浅色和深色背景使用的 Logo。",
        lightLogo: "浅色背景使用",
        darkLogo: "深色背景使用",
        upload: "上传 Logo",
        replace: "替换 Logo",
        remove: "移除 Logo",
        empty: "未设置 Logo 时显示店铺名称。",
        imageHint:
          "建议上传透明背景的横版 PNG 或 WebP，也支持 JPEG、AVIF，最大 25 MiB。请仅上传有权使用的 Logo。",
        uploading: "正在处理 Logo…",
        uploadError: "Logo 暂时无法处理。已保留所选文件，可重试或重新选择。",
        imageFormat: "请选择 PNG、WebP、JPEG 或 AVIF 图片。",
        imageSize: "请选择非空且不超过 25 MiB 的图片。",
        imageUnavailable: "Logo 无法显示",
        uploadPermission: "当前账号无上传 Logo 权限。",
        history: "品牌标识发布历史",
        noHistory: "发布后的品牌标识版本会显示在这里。",
        published: "品牌标识已发布",
        restored: "品牌标识已恢复",
        live: "已发布品牌标识",
        unset: "尚未设置品牌标识",
        cancelUpload: "取消选择",
        conflict: "其他操作员已修改品牌标识，请重新加载最新版本后继续。",
        discard: "放弃尚未保存的品牌标识修改？",
        restoreConfirm:
          "恢复此品牌标识？当前 Logo 及其草稿将被替换，其他店铺设置保持不变。",
        previewHint: "处理完成后即可在真实页面预览，保存并发布后才会对外生效。",
        previewScheme: "预览背景",
        light: "浅色",
        dark: "深色",
        retry: "重试",
      };
    case "th":
      return {
        title: "โลโก้ร้าน",
        intro: "ตั้งค่าโลโก้สำหรับพื้นหลังสว่างและมืด",
        lightLogo: "บนพื้นหลังสว่าง",
        darkLogo: "บนพื้นหลังมืด",
        upload: "อัปโหลดโลโก้",
        replace: "เปลี่ยนโลโก้",
        remove: "นำโลโก้ออก",
        empty: "เมื่อไม่มีโลโก้จะแสดงชื่อร้าน",
        imageHint:
          "แนะนำ PNG หรือ WebP แนวนอนพื้นหลังโปร่งใส รองรับ JPEG และ AVIF ขนาดไม่เกิน 25 MiB ใช้เฉพาะโลโก้ที่คุณมีสิทธิ์แสดง",
        uploading: "กำลังเตรียมโลโก้…",
        uploadError:
          "เตรียมโลโก้ไม่สำเร็จ เก็บไฟล์ที่เลือกไว้แล้ว ลองอีกครั้งหรือเลือกไฟล์อื่น",
        imageFormat: "เลือกภาพ PNG, WebP, JPEG หรือ AVIF",
        imageSize: "เลือกภาพที่ไม่ว่างและมีขนาดไม่เกิน 25 MiB",
        imageUnavailable: "แสดงโลโก้ไม่ได้",
        uploadPermission: "บัญชีนี้ไม่มีสิทธิ์อัปโหลดโลโก้",
        history: "ประวัติการเผยแพร่โลโก้",
        noHistory: "เวอร์ชันโลโก้ที่เผยแพร่จะแสดงที่นี่",
        published: "เผยแพร่การตั้งค่าโลโก้แล้ว",
        restored: "คืนค่าการตั้งค่าโลโก้แล้ว",
        live: "การตั้งค่าโลโก้ที่เผยแพร่",
        unset: "ยังไม่ได้ตั้งค่าโลโก้",
        cancelUpload: "ยกเลิกการเลือก",
        conflict: "ผู้ดูแลคนอื่นเปลี่ยนโลโก้แล้ว โปรดโหลดเวอร์ชันล่าสุด",
        discard: "ละทิ้งการเปลี่ยนแปลงโลโก้ที่ยังไม่บันทึกหรือไม่?",
        restoreConfirm:
          "คืนค่าโลโก้นี้หรือไม่? โลโก้และแบบร่างปัจจุบันจะถูกแทนที่ การตั้งค่าอื่นจะคงเดิม",
        previewHint:
          "โลโก้ที่เตรียมแล้วจะแสดงในตัวอย่างร้าน บันทึกและเผยแพร่เพื่อใช้งานจริง",
        previewScheme: "พื้นหลังตัวอย่าง",
        light: "สว่าง",
        dark: "มืด",
        retry: "ลองอีกครั้ง",
      };
    case "vi":
      return {
        title: "Logo cửa hàng",
        intro: "Đặt logo cho nền sáng và nền tối.",
        lightLogo: "Trên nền sáng",
        darkLogo: "Trên nền tối",
        upload: "Tải logo lên",
        replace: "Thay logo",
        remove: "Xóa logo",
        empty: "Tên cửa hàng sẽ hiện khi chưa đặt logo.",
        imageHint:
          "Nên dùng PNG hoặc WebP ngang có nền trong suốt. Cũng hỗ trợ JPEG và AVIF, tối đa 25 MiB. Chỉ dùng logo bạn có quyền hiển thị.",
        uploading: "Đang xử lý logo…",
        uploadError:
          "Không thể xử lý logo. Tệp đã chọn vẫn được giữ; hãy thử lại hoặc chọn tệp khác.",
        imageFormat: "Chọn ảnh PNG, WebP, JPEG hoặc AVIF.",
        imageSize: "Chọn ảnh không rỗng và không lớn hơn 25 MiB.",
        imageUnavailable: "Không thể hiển thị logo",
        uploadPermission: "Tài khoản này không có quyền tải logo lên.",
        history: "Lịch sử xuất bản logo",
        noHistory: "Các phiên bản logo đã xuất bản sẽ hiện ở đây.",
        published: "Đã xuất bản cài đặt logo",
        restored: "Đã khôi phục cài đặt logo",
        live: "Cài đặt logo đã xuất bản",
        unset: "Chưa đặt logo",
        cancelUpload: "Hủy lựa chọn",
        conflict:
          "Người quản lý khác đã đổi logo. Hãy tải lại phiên bản mới nhất.",
        discard: "Bỏ thay đổi logo chưa lưu?",
        restoreConfirm:
          "Khôi phục các logo này? Logo và bản nháp hiện tại sẽ được thay thế. Các cài đặt khác không đổi.",
        previewHint:
          "Logo đã xử lý sẽ hiện trong bản xem trước thực. Lưu và xuất bản để áp dụng.",
        previewScheme: "Nền xem trước",
        light: "Sáng",
        dark: "Tối",
        retry: "Thử lại",
      };
    case "ja":
      return {
        title: "ブランドロゴ",
        intro: "明るい背景と暗い背景に使うロゴを設定します。",
        lightLogo: "明るい背景用",
        darkLogo: "暗い背景用",
        upload: "ロゴをアップロード",
        replace: "ロゴを変更",
        remove: "ロゴを削除",
        empty: "ロゴがない場合はストア名を表示します。",
        imageHint:
          "背景が透明な横長のPNGまたはWebPを推奨します。JPEG・AVIFにも対応、最大25 MiB。使用権のあるロゴのみアップロードしてください。",
        uploading: "ロゴを処理中…",
        uploadError:
          "ロゴを処理できませんでした。選択したファイルは保持されています。再試行するか別のファイルを選んでください。",
        imageFormat: "PNG・WebP・JPEG・AVIF画像を選択してください。",
        imageSize: "空でない25 MiB以下の画像を選択してください。",
        imageUnavailable: "ロゴを表示できません",
        uploadPermission:
          "このアカウントにはロゴのアップロード権限がありません。",
        history: "ロゴの公開履歴",
        noHistory: "公開したロゴのバージョンがここに表示されます。",
        published: "ロゴ設定を公開しました",
        restored: "ロゴ設定を復元しました",
        live: "公開中のロゴ設定",
        unset: "ロゴは未設定です",
        cancelUpload: "選択を取り消す",
        conflict:
          "別の担当者がロゴを変更しました。最新版を再読み込みしてください。",
        discard: "未保存のロゴ変更を破棄しますか？",
        restoreConfirm:
          "このロゴを復元しますか？現在のロゴと下書きを置き換えます。他の設定は変わりません。",
        previewHint:
          "処理済みのロゴを実際のページでプレビューします。保存して公開すると反映されます。",
        previewScheme: "プレビューの背景",
        light: "ライト",
        dark: "ダーク",
        retry: "再試行",
      };
    case "es":
      return {
        title: "Logotipo de la tienda",
        intro: "Configura un logotipo para fondos claros y oscuros.",
        lightLogo: "Para fondos claros",
        darkLogo: "Para fondos oscuros",
        upload: "Subir logotipo",
        replace: "Reemplazar logotipo",
        remove: "Quitar logotipo",
        empty: "Sin logotipo, se muestra el nombre de la tienda.",
        imageHint:
          "Se recomienda PNG o WebP horizontal con fondo transparente. También se admiten JPEG y AVIF, hasta 25 MiB. Usa solo logotipos que tengas permiso para mostrar.",
        uploading: "Preparando logotipo…",
        uploadError:
          "No se pudo preparar el logotipo. Se conserva tu archivo; reintenta o elige otro.",
        imageFormat: "Elige una imagen PNG, WebP, JPEG o AVIF.",
        imageSize: "Elige una imagen no vacía de hasta 25 MiB.",
        imageUnavailable: "Logotipo no disponible",
        uploadPermission: "Tu cuenta no puede subir logotipos.",
        history: "Historial de publicación del logotipo",
        noHistory: "Las versiones publicadas del logotipo aparecerán aquí.",
        published: "Logotipo publicado",
        restored: "Logotipo restaurado",
        live: "Logotipo publicado",
        unset: "Logotipo aún sin configurar",
        cancelUpload: "Cancelar selección",
        conflict:
          "Otra persona cambió el logotipo. Recarga la última versión para continuar.",
        discard: "¿Descartar los cambios del logotipo sin guardar?",
        restoreConfirm:
          "¿Restaurar estos logotipos? Se reemplazarán los actuales y su borrador. Los demás ajustes no cambian.",
        previewHint:
          "Los logotipos preparados aparecen en la vista previa real. Guarda y publica para mostrarlos en la tienda.",
        previewScheme: "Fondo de la vista previa",
        light: "Claro",
        dark: "Oscuro",
        retry: "Reintentar",
      };
    case "pt":
      return {
        title: "Logotipo da loja",
        intro: "Defina um logotipo para fundos claros e escuros.",
        lightLogo: "Para fundos claros",
        darkLogo: "Para fundos escuros",
        upload: "Enviar logotipo",
        replace: "Substituir logotipo",
        remove: "Remover logotipo",
        empty: "Sem logotipo, aparece o nome da loja.",
        imageHint:
          "Prefira PNG ou WebP horizontal com fundo transparente. JPEG e AVIF também são aceitos, até 25 MiB. Use apenas logotipos que você tenha permissão para exibir.",
        uploading: "Preparando logotipo…",
        uploadError:
          "Não foi possível preparar o logotipo. Seu arquivo foi mantido; tente novamente ou escolha outro.",
        imageFormat: "Escolha uma imagem PNG, WebP, JPEG ou AVIF.",
        imageSize: "Escolha uma imagem não vazia de até 25 MiB.",
        imageUnavailable: "Logotipo indisponível",
        uploadPermission: "Sua conta não pode enviar logotipos.",
        history: "Histórico de publicação do logotipo",
        noHistory: "As versões publicadas do logotipo aparecerão aqui.",
        published: "Logotipo publicado",
        restored: "Logotipo restaurado",
        live: "Logotipo publicado",
        unset: "Logotipo ainda não definido",
        cancelUpload: "Cancelar seleção",
        conflict:
          "Outra pessoa alterou o logotipo. Recarregue a versão mais recente para continuar.",
        discard: "Descartar as alterações do logotipo não salvas?",
        restoreConfirm:
          "Restaurar estes logotipos? Os atuais e seu rascunho serão substituídos. As outras configurações não mudam.",
        previewHint:
          "Os logotipos preparados aparecem na prévia real. Salve e publique para aplicá-los na loja.",
        previewScheme: "Fundo da prévia",
        light: "Claro",
        dark: "Escuro",
        retry: "Tentar novamente",
      };
  }
}
export type BrandCopy = DecorationCopy & BrandLabels;
export function brandCopy(locale: SupportedLocale): BrandCopy {
  return { ...decorationCopy(locale), ...brandLabels(locale) };
}
