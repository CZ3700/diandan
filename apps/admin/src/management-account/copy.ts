import type { SupportedLocale } from "@fan-support/contracts";

// ADR-021 account settings. English is the source. Field labels and password/code errors come
// from the sign-in copy so the two pages always use the same words.
type AccountCopy = Readonly<
  Record<
    | "title"
    | "loginName"
    | "warningBadge"
    | "warningBanner"
    | "passwordTitle"
    | "passwordChangedOn"
    | "currentPassword"
    | "changePassword"
    | "changingPassword"
    | "passwordChanged"
    | "twoFactorTitle"
    | "twoFactorOn"
    | "twoFactorOff"
    | "setUp"
    | "setUpPrompt"
    | "continue"
    | "checking"
    | "scanIntro"
    | "qrLabel"
    | "manualKey"
    | "setUpExpires"
    | "turnOn"
    | "turningOn"
    | "turnedOn"
    | "recoveryTitle"
    | "recoveryIntro"
    | "download"
    | "saved"
    | "remaining"
    | "newCodes"
    | "newCodesIntro"
    | "getNewCodes"
    | "turnOff"
    | "turnOffIntro"
    | "turningOff"
    | "turnedOff"
    | "cancel"
    | "invalidPassword"
    | "setUpExpired"
    | "changedElsewhere"
    | "notLocal",
    string
  >
>;

const en: AccountCopy = {
  title: "Account settings",
  loginName: "Login name: {account}",
  warningBadge: "Two-step verification is off",
  warningBanner:
    "Two-step verification is off. Anyone who learns your password can sign in as you, issue refunds and read fan messages. Setting it up takes about a minute.",
  passwordTitle: "Password",
  passwordChangedOn: "Last changed {date}.",
  currentPassword: "Current password",
  changePassword: "Change password",
  changingPassword: "Changing…",
  passwordChanged:
    "Password changed. You were signed out on your other devices.",
  twoFactorTitle: "Two-step verification",
  twoFactorOn:
    "On. Each sign-in also asks for a code from your authenticator app.",
  twoFactorOff: "Off. You sign in with your password only.",
  setUp: "Set up two-step verification",
  setUpPrompt: "Enter your password to begin.",
  continue: "Continue",
  checking: "Checking…",
  scanIntro:
    "Scan this QR code with an authenticator app on your phone, then enter the 6-digit code the app shows.",
  qrLabel: "QR code for your authenticator app",
  manualKey: "Can't scan it? Enter this key in the app instead:",
  setUpExpires: "Finish before {time}.",
  turnOn: "Turn on",
  turningOn: "Turning on…",
  turnedOn: "Two-step verification is on.",
  recoveryTitle: "Your recovery codes",
  recoveryIntro:
    "If you lose your phone, each code lets you sign in once. Save them somewhere safe now; they will not be shown again.",
  download: "Download as a text file",
  saved: "I have saved these codes",
  remaining: "{count} unused recovery codes left.",
  newCodes: "Get new recovery codes",
  newCodesIntro:
    "New codes replace all of your old ones. Enter your password and a current code from your app.",
  getNewCodes: "Get new codes",
  turnOff: "Turn off two-step verification",
  turnOffIntro:
    "You will sign in with your password only, and your other devices will be signed out. Enter your password and a current code from your app.",
  turningOff: "Turning off…",
  turnedOff: "Two-step verification is off.",
  cancel: "Cancel",
  invalidPassword: "The current password is incorrect.",
  setUpExpired: "This setup expired. Start again.",
  changedElsewhere:
    "Your account changed in another window. The page now shows the latest settings.",
  notLocal:
    "This account signs in through your organization's identity service. Change its password and verification there.",
};

const zhCN: AccountCopy = {
  title: "账号设置",
  loginName: "登录名：{account}",
  warningBadge: "未开启两步验证",
  warningBanner:
    "你还没有开启两步验证。任何人只要知道你的密码，就能以你的身份登录、发起退款、查看粉丝留言。开启只需要一分钟左右。",
  passwordTitle: "密码",
  passwordChangedOn: "上次修改：{date}。",
  currentPassword: "当前密码",
  changePassword: "修改密码",
  changingPassword: "正在修改…",
  passwordChanged: "密码已修改，其他设备上的登录已退出。",
  twoFactorTitle: "两步验证",
  twoFactorOn: "已开启。每次登录还需要输入验证器 App 中的验证码。",
  twoFactorOff: "未开启。目前只凭密码登录。",
  setUp: "开启两步验证",
  setUpPrompt: "请先输入密码。",
  continue: "继续",
  checking: "正在验证…",
  scanIntro:
    "用手机上的验证器 App 扫描这个二维码，然后输入 App 显示的 6 位验证码。",
  qrLabel: "用于验证器 App 的二维码",
  manualKey: "无法扫码？在 App 中手动输入这个密钥：",
  setUpExpires: "请在 {time} 前完成。",
  turnOn: "开启",
  turningOn: "正在开启…",
  turnedOn: "两步验证已开启。",
  recoveryTitle: "你的恢复码",
  recoveryIntro:
    "手机丢失时，每个恢复码可以登录一次。请现在妥善保存，之后不会再显示。",
  download: "下载为文本文件",
  saved: "我已保存这些恢复码",
  remaining: "还剩 {count} 个未使用的恢复码。",
  newCodes: "获取新的恢复码",
  newCodesIntro: "新恢复码会替换全部旧码。请输入密码和 App 中当前的验证码。",
  getNewCodes: "获取新恢复码",
  turnOff: "关闭两步验证",
  turnOffIntro:
    "关闭后只凭密码登录，其他设备上的登录会退出。请输入密码和 App 中当前的验证码。",
  turningOff: "正在关闭…",
  turnedOff: "两步验证已关闭。",
  cancel: "取消",
  invalidPassword: "当前密码不正确。",
  setUpExpired: "本次设置已过期，请重新开始。",
  changedElsewhere: "账号在其他窗口中有改动，页面已更新为最新设置。",
  notLocal: "这个账号通过所在机构的身份服务登录，请在那里修改密码和验证方式。",
};

const ja: AccountCopy = {
  title: "アカウント設定",
  loginName: "ログイン名：{account}",
  warningBadge: "2 段階認証がオフです",
  warningBanner:
    "2 段階認証がオフです。パスワードを知っている人なら誰でもあなたとしてサインインし、返金やファンのメッセージの閲覧ができてしまいます。設定は 1 分ほどで終わります。",
  passwordTitle: "パスワード",
  passwordChangedOn: "最終変更：{date}",
  currentPassword: "現在のパスワード",
  changePassword: "パスワードを変更",
  changingPassword: "変更しています…",
  passwordChanged:
    "パスワードを変更しました。ほかのデバイスではサインアウトしました。",
  twoFactorTitle: "2 段階認証",
  twoFactorOn: "オン。サインインのたびに認証アプリのコードも入力します。",
  twoFactorOff: "オフ。パスワードだけでサインインしています。",
  setUp: "2 段階認証を設定",
  setUpPrompt: "まずパスワードを入力してください。",
  continue: "続ける",
  checking: "確認しています…",
  scanIntro:
    "スマートフォンの認証アプリでこの QR コードを読み取り、表示された 6 桁のコードを入力してください。",
  qrLabel: "認証アプリ用の QR コード",
  manualKey: "読み取れない場合は、このキーをアプリに入力してください：",
  setUpExpires: "{time} までに完了してください。",
  turnOn: "オンにする",
  turningOn: "オンにしています…",
  turnedOn: "2 段階認証をオンにしました。",
  recoveryTitle: "リカバリーコード",
  recoveryIntro:
    "スマートフォンをなくしたときは、各コードで 1 回サインインできます。今すぐ安全な場所に保存してください。あとから再表示はできません。",
  download: "テキストファイルでダウンロード",
  saved: "コードを保存しました",
  remaining: "未使用のリカバリーコードは残り {count} 個です。",
  newCodes: "新しいリカバリーコードを発行",
  newCodesIntro:
    "新しいコードは古いコードをすべて置き換えます。パスワードとアプリの現在のコードを入力してください。",
  getNewCodes: "新しいコードを発行",
  turnOff: "2 段階認証をオフにする",
  turnOffIntro:
    "オフにするとパスワードだけでサインインするようになり、ほかのデバイスではサインアウトされます。パスワードとアプリの現在のコードを入力してください。",
  turningOff: "オフにしています…",
  turnedOff: "2 段階認証をオフにしました。",
  cancel: "キャンセル",
  invalidPassword: "現在のパスワードが正しくありません。",
  setUpExpired: "設定の有効期限が切れました。最初からやり直してください。",
  changedElsewhere:
    "ほかのウィンドウでアカウントが変更されました。最新の設定を表示しています。",
  notLocal:
    "このアカウントは組織の ID サービスでサインインしています。パスワードや認証の変更はそちらで行ってください。",
};

const th: AccountCopy = {
  title: "การตั้งค่าบัญชี",
  loginName: "ชื่อผู้ใช้: {account}",
  warningBadge: "ยังไม่ได้เปิดการยืนยันสองขั้นตอน",
  warningBanner:
    "คุณยังไม่ได้เปิดการยืนยันสองขั้นตอน ใครก็ตามที่รู้รหัสผ่านของคุณจะเข้าสู่ระบบในนามคุณ คืนเงิน และอ่านข้อความจากแฟนได้ การตั้งค่าใช้เวลาประมาณหนึ่งนาที",
  passwordTitle: "รหัสผ่าน",
  passwordChangedOn: "เปลี่ยนล่าสุดเมื่อ {date}",
  currentPassword: "รหัสผ่านปัจจุบัน",
  changePassword: "เปลี่ยนรหัสผ่าน",
  changingPassword: "กำลังเปลี่ยน…",
  passwordChanged: "เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นของคุณออกจากระบบแล้ว",
  twoFactorTitle: "การยืนยันสองขั้นตอน",
  twoFactorOn:
    "เปิดอยู่ ทุกครั้งที่เข้าสู่ระบบต้องกรอกรหัสจากแอปยืนยันตัวตนด้วย",
  twoFactorOff: "ปิดอยู่ ตอนนี้เข้าสู่ระบบด้วยรหัสผ่านอย่างเดียว",
  setUp: "ตั้งค่าการยืนยันสองขั้นตอน",
  setUpPrompt: "กรอกรหัสผ่านเพื่อเริ่ม",
  continue: "ดำเนินการต่อ",
  checking: "กำลังตรวจสอบ…",
  scanIntro:
    "สแกนคิวอาร์โค้ดนี้ด้วยแอปยืนยันตัวตนในโทรศัพท์ แล้วกรอกรหัส 6 หลักที่แอปแสดง",
  qrLabel: "คิวอาร์โค้ดสำหรับแอปยืนยันตัวตน",
  manualKey: "สแกนไม่ได้ใช่ไหม กรอกคีย์นี้ในแอปแทน:",
  setUpExpires: "โปรดทำให้เสร็จก่อน {time}",
  turnOn: "เปิด",
  turningOn: "กำลังเปิด…",
  turnedOn: "เปิดการยืนยันสองขั้นตอนแล้ว",
  recoveryTitle: "รหัสกู้คืนของคุณ",
  recoveryIntro:
    "หากโทรศัพท์หาย รหัสแต่ละรหัสใช้เข้าสู่ระบบได้หนึ่งครั้ง โปรดบันทึกไว้ในที่ปลอดภัยตอนนี้ เพราะจะไม่แสดงอีก",
  download: "ดาวน์โหลดเป็นไฟล์ข้อความ",
  saved: "ฉันบันทึกรหัสเหล่านี้แล้ว",
  remaining: "เหลือรหัสกู้คืนที่ยังไม่ได้ใช้ {count} รหัส",
  newCodes: "ขอรหัสกู้คืนชุดใหม่",
  newCodesIntro:
    "รหัสชุดใหม่จะแทนที่รหัสเดิมทั้งหมด กรอกรหัสผ่านและรหัสปัจจุบันจากแอป",
  getNewCodes: "ขอรหัสชุดใหม่",
  turnOff: "ปิดการยืนยันสองขั้นตอน",
  turnOffIntro:
    "หลังปิดจะเข้าสู่ระบบด้วยรหัสผ่านอย่างเดียว และอุปกรณ์อื่นจะออกจากระบบ กรอกรหัสผ่านและรหัสปัจจุบันจากแอป",
  turningOff: "กำลังปิด…",
  turnedOff: "ปิดการยืนยันสองขั้นตอนแล้ว",
  cancel: "ยกเลิก",
  invalidPassword: "รหัสผ่านปัจจุบันไม่ถูกต้อง",
  setUpExpired: "การตั้งค่านี้หมดเวลาแล้ว โปรดเริ่มใหม่",
  changedElsewhere:
    "บัญชีถูกเปลี่ยนในหน้าต่างอื่น หน้านี้แสดงการตั้งค่าล่าสุดแล้ว",
  notLocal:
    "บัญชีนี้เข้าสู่ระบบผ่านบริการยืนยันตัวตนขององค์กร โปรดเปลี่ยนรหัสผ่านและการยืนยันที่นั่น",
};

const vi: AccountCopy = {
  title: "Cài đặt tài khoản",
  loginName: "Tên đăng nhập: {account}",
  warningBadge: "Chưa bật xác minh hai bước",
  warningBanner:
    "Bạn chưa bật xác minh hai bước. Bất kỳ ai biết mật khẩu của bạn đều có thể đăng nhập thay bạn, hoàn tiền và đọc lời nhắn của người hâm mộ. Chỉ mất khoảng một phút để bật.",
  passwordTitle: "Mật khẩu",
  passwordChangedOn: "Đổi lần cuối: {date}.",
  currentPassword: "Mật khẩu hiện tại",
  changePassword: "Đổi mật khẩu",
  changingPassword: "Đang đổi…",
  passwordChanged:
    "Đã đổi mật khẩu. Bạn đã được đăng xuất trên các thiết bị khác.",
  twoFactorTitle: "Xác minh hai bước",
  twoFactorOn: "Đang bật. Mỗi lần đăng nhập cần thêm mã từ ứng dụng xác thực.",
  twoFactorOff: "Đang tắt. Bạn đăng nhập chỉ bằng mật khẩu.",
  setUp: "Bật xác minh hai bước",
  setUpPrompt: "Nhập mật khẩu để bắt đầu.",
  continue: "Tiếp tục",
  checking: "Đang kiểm tra…",
  scanIntro:
    "Quét mã QR này bằng ứng dụng xác thực trên điện thoại, rồi nhập mã 6 chữ số mà ứng dụng hiển thị.",
  qrLabel: "Mã QR cho ứng dụng xác thực",
  manualKey: "Không quét được? Hãy nhập khóa này vào ứng dụng:",
  setUpExpires: "Hãy hoàn tất trước {time}.",
  turnOn: "Bật",
  turningOn: "Đang bật…",
  turnedOn: "Đã bật xác minh hai bước.",
  recoveryTitle: "Mã khôi phục của bạn",
  recoveryIntro:
    "Nếu mất điện thoại, mỗi mã giúp bạn đăng nhập một lần. Hãy lưu chúng ở nơi an toàn ngay bây giờ; chúng sẽ không hiển thị lại.",
  download: "Tải về dạng tệp văn bản",
  saved: "Tôi đã lưu các mã này",
  remaining: "Còn {count} mã khôi phục chưa dùng.",
  newCodes: "Lấy mã khôi phục mới",
  newCodesIntro:
    "Mã mới sẽ thay thế toàn bộ mã cũ. Hãy nhập mật khẩu và mã hiện tại trong ứng dụng.",
  getNewCodes: "Lấy mã mới",
  turnOff: "Tắt xác minh hai bước",
  turnOffIntro:
    "Sau khi tắt, bạn chỉ đăng nhập bằng mật khẩu và các thiết bị khác sẽ bị đăng xuất. Hãy nhập mật khẩu và mã hiện tại trong ứng dụng.",
  turningOff: "Đang tắt…",
  turnedOff: "Đã tắt xác minh hai bước.",
  cancel: "Hủy",
  invalidPassword: "Mật khẩu hiện tại không đúng.",
  setUpExpired: "Phiên cài đặt đã hết hạn. Hãy bắt đầu lại.",
  changedElsewhere:
    "Tài khoản vừa thay đổi ở cửa sổ khác. Trang đã hiển thị cài đặt mới nhất.",
  notLocal:
    "Tài khoản này đăng nhập qua dịch vụ định danh của tổ chức. Hãy đổi mật khẩu và cách xác minh ở đó.",
};

const es: AccountCopy = {
  title: "Configuración de la cuenta",
  loginName: "Nombre de usuario: {account}",
  warningBadge: "Verificación en dos pasos desactivada",
  warningBanner:
    "La verificación en dos pasos está desactivada. Cualquiera que conozca tu contraseña puede iniciar sesión como tú, emitir reembolsos y leer los mensajes de fans. Activarla lleva alrededor de un minuto.",
  passwordTitle: "Contraseña",
  passwordChangedOn: "Último cambio: {date}.",
  currentPassword: "Contraseña actual",
  changePassword: "Cambiar contraseña",
  changingPassword: "Cambiando…",
  passwordChanged:
    "Contraseña cambiada. Se cerró tu sesión en tus otros dispositivos.",
  twoFactorTitle: "Verificación en dos pasos",
  twoFactorOn:
    "Activada. Cada inicio de sesión pide también un código de tu app de autenticación.",
  twoFactorOff: "Desactivada. Inicias sesión solo con tu contraseña.",
  setUp: "Activar la verificación en dos pasos",
  setUpPrompt: "Introduce tu contraseña para empezar.",
  continue: "Continuar",
  checking: "Comprobando…",
  scanIntro:
    "Escanea este código QR con una app de autenticación en tu teléfono y después introduce el código de 6 dígitos que muestra.",
  qrLabel: "Código QR para tu app de autenticación",
  manualKey: "¿No puedes escanearlo? Introduce esta clave en la app:",
  setUpExpires: "Termina antes de las {time}.",
  turnOn: "Activar",
  turningOn: "Activando…",
  turnedOn: "La verificación en dos pasos está activada.",
  recoveryTitle: "Tus códigos de recuperación",
  recoveryIntro:
    "Si pierdes el teléfono, cada código te permite iniciar sesión una vez. Guárdalos ahora en un lugar seguro; no se volverán a mostrar.",
  download: "Descargar como archivo de texto",
  saved: "He guardado estos códigos",
  remaining: "Te quedan {count} códigos de recuperación sin usar.",
  newCodes: "Obtener nuevos códigos de recuperación",
  newCodesIntro:
    "Los códigos nuevos sustituyen a todos los anteriores. Introduce tu contraseña y un código actual de la app.",
  getNewCodes: "Obtener códigos nuevos",
  turnOff: "Desactivar la verificación en dos pasos",
  turnOffIntro:
    "Iniciarás sesión solo con tu contraseña y se cerrará la sesión en tus otros dispositivos. Introduce tu contraseña y un código actual de la app.",
  turningOff: "Desactivando…",
  turnedOff: "La verificación en dos pasos está desactivada.",
  cancel: "Cancelar",
  invalidPassword: "La contraseña actual no es correcta.",
  setUpExpired: "Esta configuración ha caducado. Empieza de nuevo.",
  changedElsewhere:
    "Tu cuenta cambió en otra ventana. La página ya muestra la configuración actual.",
  notLocal:
    "Esta cuenta inicia sesión con el servicio de identidad de tu organización. Cambia allí la contraseña y la verificación.",
};

const pt: AccountCopy = {
  title: "Configurações da conta",
  loginName: "Nome de usuário: {account}",
  warningBadge: "Verificação em duas etapas desativada",
  warningBanner:
    "A verificação em duas etapas está desativada. Qualquer pessoa que saiba sua senha pode entrar como você, fazer reembolsos e ler mensagens de fãs. A configuração leva cerca de um minuto.",
  passwordTitle: "Senha",
  passwordChangedOn: "Última alteração: {date}.",
  currentPassword: "Senha atual",
  changePassword: "Alterar senha",
  changingPassword: "Alterando…",
  passwordChanged:
    "Senha alterada. Você saiu da conta nos outros dispositivos.",
  twoFactorTitle: "Verificação em duas etapas",
  twoFactorOn:
    "Ativada. Cada login também pede um código do seu app autenticador.",
  twoFactorOff: "Desativada. Você entra apenas com a senha.",
  setUp: "Ativar a verificação em duas etapas",
  setUpPrompt: "Digite sua senha para começar.",
  continue: "Continuar",
  checking: "Verificando…",
  scanIntro:
    "Leia este código QR com um app autenticador no celular e depois digite o código de 6 dígitos que ele mostrar.",
  qrLabel: "Código QR para o seu app autenticador",
  manualKey: "Não consegue ler? Digite esta chave no app:",
  setUpExpires: "Conclua antes das {time}.",
  turnOn: "Ativar",
  turningOn: "Ativando…",
  turnedOn: "A verificação em duas etapas está ativada.",
  recoveryTitle: "Seus códigos de recuperação",
  recoveryIntro:
    "Se você perder o celular, cada código permite entrar uma vez. Guarde-os agora em um lugar seguro; eles não serão mostrados de novo.",
  download: "Baixar como arquivo de texto",
  saved: "Já guardei estes códigos",
  remaining: "Restam {count} códigos de recuperação não usados.",
  newCodes: "Gerar novos códigos de recuperação",
  newCodesIntro:
    "Os novos códigos substituem todos os antigos. Digite sua senha e um código atual do app.",
  getNewCodes: "Gerar novos códigos",
  turnOff: "Desativar a verificação em duas etapas",
  turnOffIntro:
    "Você passará a entrar apenas com a senha, e os outros dispositivos sairão da conta. Digite sua senha e um código atual do app.",
  turningOff: "Desativando…",
  turnedOff: "A verificação em duas etapas está desativada.",
  cancel: "Cancelar",
  invalidPassword: "A senha atual está incorreta.",
  setUpExpired: "Esta configuração expirou. Comece de novo.",
  changedElsewhere:
    "Sua conta mudou em outra janela. A página já mostra as configurações atuais.",
  notLocal:
    "Esta conta entra pelo serviço de identidade da sua organização. Altere a senha e a verificação lá.",
};

const COPY: Readonly<Record<SupportedLocale, AccountCopy>> = {
  en,
  "zh-CN": zhCN,
  th,
  vi,
  ja,
  es,
  pt,
};
export function accountCopy(locale: SupportedLocale): AccountCopy {
  return COPY[locale];
}
