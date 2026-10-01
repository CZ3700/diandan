import type { SupportedLocale } from "@fan-support/contracts";
import type { SignInMessage } from "./local-sign-in-model";

// ADR-021 sign-in page. English is the source; "{account}" is replaced with the login name.
type SignInCopy = Readonly<
  Record<
    | SignInMessage
    | "tagline"
    | "signInTitle"
    | "signInIntro"
    | "loginName"
    | "password"
    | "showPassword"
    | "hidePassword"
    | "signIn"
    | "signingIn"
    | "codeTitle"
    | "codeIntro"
    | "codeLabel"
    | "verify"
    | "verifying"
    | "useRecovery"
    | "recoveryTitle"
    | "recoveryIntro"
    | "recoveryLabel"
    | "useAuthenticator"
    | "newPasswordTitle"
    | "newPasswordIntro"
    | "newPassword"
    | "confirmPassword"
    | "passwordHint"
    | "savePassword"
    | "saving"
    | "differentAccount",
    string
  >
>;

const en: SignInCopy = {
  tagline:
    "The studio's workspace for artists, gifts, orders and fan messages.",
  signInTitle: "Sign in",
  signInIntro:
    "Use the login name and password from your studio administrator.",
  loginName: "Login name",
  password: "Password",
  showPassword: "Show password",
  hidePassword: "Hide password",
  signIn: "Sign in",
  signingIn: "Signing in…",
  codeTitle: "Enter your verification code",
  codeIntro:
    "Open your authenticator app and enter the 6-digit code for {account}.",
  codeLabel: "6-digit code",
  verify: "Verify",
  verifying: "Verifying…",
  useRecovery: "Use a recovery code instead",
  recoveryTitle: "Enter a recovery code",
  recoveryIntro:
    "Each recovery code works once. You can type it with or without the dashes.",
  recoveryLabel: "Recovery code",
  useAuthenticator: "Use the authenticator app instead",
  newPasswordTitle: "Set your own password",
  newPasswordIntro:
    "{account} signed in with a temporary password. Choose a new one to continue.",
  newPassword: "New password",
  confirmPassword: "Confirm new password",
  passwordHint: "At least 12 characters. A few words with spaces work well.",
  savePassword: "Save password and sign in",
  saving: "Saving…",
  differentAccount: "Sign in with a different account",
  invalidCredentials: "The login name or password is incorrect.",
  locked:
    "Too many failed attempts. This account is locked for 15 minutes. Try again later or ask your studio administrator.",
  invalidCode:
    "That code is incorrect or has expired. Enter the latest 6-digit code from your app.",
  invalidRecovery: "That recovery code is incorrect or has already been used.",
  restart:
    "This sign-in has expired. Enter your login name and password again.",
  unavailable: "Sign-in is unavailable right now. Try again in a moment.",
  mismatch: "The two new passwords do not match.",
  tooShort: "Use at least 12 characters.",
  tooLong: "Use at most 128 characters.",
  sameAsLogin: "Your password cannot be the same as your login name.",
  sameAsCurrent: "Choose a password different from the temporary one.",
  codeFormat: "Enter the 6 digits shown in your app.",
};

const zhCN: SignInCopy = {
  tagline: "工作室管理艺人、礼物、订单和粉丝留言的地方。",
  signInTitle: "登录",
  signInIntro: "使用工作室管理员为你创建的登录名和密码。",
  loginName: "登录名",
  password: "密码",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  signIn: "登录",
  signingIn: "正在登录…",
  codeTitle: "输入验证码",
  codeIntro: "打开验证器 App，输入 {account} 的 6 位验证码。",
  codeLabel: "6 位验证码",
  verify: "验证",
  verifying: "正在验证…",
  useRecovery: "改用恢复码",
  recoveryTitle: "输入恢复码",
  recoveryIntro: "每个恢复码只能用一次。输入时带不带短横线都可以。",
  recoveryLabel: "恢复码",
  useAuthenticator: "改用验证器 App",
  newPasswordTitle: "设置你自己的密码",
  newPasswordIntro: "{account} 使用的是临时密码，请先设置新密码再继续。",
  newPassword: "新密码",
  confirmPassword: "再次输入新密码",
  passwordHint: "至少 12 个字符。用几个词加空格组成的句子就很好。",
  savePassword: "保存密码并登录",
  saving: "正在保存…",
  differentAccount: "换一个账号登录",
  invalidCredentials: "登录名或密码不正确。",
  locked: "失败次数过多，账号已锁定 15 分钟。请稍后再试，或联系工作室管理员。",
  invalidCode: "验证码不正确或已过期，请输入 App 中最新的 6 位数字。",
  invalidRecovery: "恢复码不正确，或已经用过。",
  restart: "本次登录已超时，请重新输入登录名和密码。",
  unavailable: "暂时无法登录，请稍后再试。",
  mismatch: "两次输入的新密码不一致。",
  tooShort: "至少需要 12 个字符。",
  tooLong: "最多 128 个字符。",
  sameAsLogin: "密码不能和登录名相同。",
  sameAsCurrent: "新密码不能与临时密码相同。",
  codeFormat: "请输入 App 中显示的 6 位数字。",
};

const ja: SignInCopy = {
  tagline:
    "アーティスト、ギフト、注文、ファンからのメッセージを管理するスタジオの作業場です。",
  signInTitle: "サインイン",
  signInIntro:
    "スタジオ管理者から受け取ったログイン名とパスワードを入力してください。",
  loginName: "ログイン名",
  password: "パスワード",
  showPassword: "パスワードを表示",
  hidePassword: "パスワードを隠す",
  signIn: "サインイン",
  signingIn: "サインインしています…",
  codeTitle: "確認コードを入力",
  codeIntro: "認証アプリを開き、{account} の 6 桁のコードを入力してください。",
  codeLabel: "6 桁のコード",
  verify: "確認",
  verifying: "確認しています…",
  useRecovery: "リカバリーコードを使う",
  recoveryTitle: "リカバリーコードを入力",
  recoveryIntro:
    "リカバリーコードは 1 回だけ使えます。ハイフンはあってもなくてもかまいません。",
  recoveryLabel: "リカバリーコード",
  useAuthenticator: "認証アプリを使う",
  newPasswordTitle: "新しいパスワードを設定",
  newPasswordIntro:
    "{account} は仮パスワードでサインインしました。続けるには新しいパスワードを設定してください。",
  newPassword: "新しいパスワード",
  confirmPassword: "新しいパスワード（確認）",
  passwordHint:
    "12 文字以上。いくつかの単語をスペースでつないだものがおすすめです。",
  savePassword: "パスワードを保存してサインイン",
  saving: "保存しています…",
  differentAccount: "別のアカウントでサインイン",
  invalidCredentials: "ログイン名またはパスワードが正しくありません。",
  locked:
    "失敗が続いたため、このアカウントは 15 分間ロックされています。しばらくしてから再度お試しいただくか、スタジオ管理者に連絡してください。",
  invalidCode:
    "コードが正しくないか、有効期限が切れています。アプリに表示されている最新の 6 桁を入力してください。",
  invalidRecovery: "リカバリーコードが正しくないか、すでに使用されています。",
  restart:
    "サインインの有効期限が切れました。ログイン名とパスワードをもう一度入力してください。",
  unavailable:
    "現在サインインできません。しばらくしてからもう一度お試しください。",
  mismatch: "2 つの新しいパスワードが一致しません。",
  tooShort: "12 文字以上にしてください。",
  tooLong: "128 文字以内にしてください。",
  sameAsLogin: "ログイン名と同じパスワードは使えません。",
  sameAsCurrent: "仮パスワードとは異なるパスワードにしてください。",
  codeFormat: "アプリに表示されている 6 桁の数字を入力してください。",
};

const th: SignInCopy = {
  tagline:
    "พื้นที่ทำงานของสตูดิโอสำหรับจัดการศิลปิน ของขวัญ คำสั่งซื้อ และข้อความจากแฟน ๆ",
  signInTitle: "เข้าสู่ระบบ",
  signInIntro: "ใช้ชื่อผู้ใช้และรหัสผ่านที่ผู้ดูแลสตูดิโอสร้างให้คุณ",
  loginName: "ชื่อผู้ใช้",
  password: "รหัสผ่าน",
  showPassword: "แสดงรหัสผ่าน",
  hidePassword: "ซ่อนรหัสผ่าน",
  signIn: "เข้าสู่ระบบ",
  signingIn: "กำลังเข้าสู่ระบบ…",
  codeTitle: "กรอกรหัสยืนยัน",
  codeIntro: "เปิดแอปยืนยันตัวตนแล้วกรอกรหัส 6 หลักของ {account}",
  codeLabel: "รหัส 6 หลัก",
  verify: "ยืนยัน",
  verifying: "กำลังยืนยัน…",
  useRecovery: "ใช้รหัสกู้คืนแทน",
  recoveryTitle: "กรอกรหัสกู้คืน",
  recoveryIntro:
    "รหัสกู้คืนแต่ละรหัสใช้ได้ครั้งเดียว จะพิมพ์ขีดกลางหรือไม่ก็ได้",
  recoveryLabel: "รหัสกู้คืน",
  useAuthenticator: "ใช้แอปยืนยันตัวตนแทน",
  newPasswordTitle: "ตั้งรหัสผ่านของคุณเอง",
  newPasswordIntro:
    "{account} เข้าสู่ระบบด้วยรหัสผ่านชั่วคราว โปรดตั้งรหัสผ่านใหม่เพื่อดำเนินการต่อ",
  newPassword: "รหัสผ่านใหม่",
  confirmPassword: "ยืนยันรหัสผ่านใหม่",
  passwordHint: "อย่างน้อย 12 ตัวอักษร ใช้คำหลายคำเว้นวรรคกันก็ได้",
  savePassword: "บันทึกรหัสผ่านและเข้าสู่ระบบ",
  saving: "กำลังบันทึก…",
  differentAccount: "เข้าสู่ระบบด้วยบัญชีอื่น",
  invalidCredentials: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
  locked:
    "ลองผิดหลายครั้งเกินไป บัญชีนี้ถูกล็อก 15 นาที โปรดลองใหม่ภายหลังหรือติดต่อผู้ดูแลสตูดิโอ",
  invalidCode: "รหัสไม่ถูกต้องหรือหมดอายุแล้ว โปรดกรอกรหัส 6 หลักล่าสุดจากแอป",
  invalidRecovery: "รหัสกู้คืนไม่ถูกต้องหรือถูกใช้ไปแล้ว",
  restart:
    "การเข้าสู่ระบบครั้งนี้หมดเวลาแล้ว โปรดกรอกชื่อผู้ใช้และรหัสผ่านอีกครั้ง",
  unavailable: "ขณะนี้เข้าสู่ระบบไม่ได้ โปรดลองอีกครั้งในอีกสักครู่",
  mismatch: "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน",
  tooShort: "ใช้อย่างน้อย 12 ตัวอักษร",
  tooLong: "ใช้ไม่เกิน 128 ตัวอักษร",
  sameAsLogin: "รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้",
  sameAsCurrent: "โปรดตั้งรหัสผ่านที่ต่างจากรหัสผ่านชั่วคราว",
  codeFormat: "โปรดกรอกตัวเลข 6 หลักที่แสดงในแอป",
};

const vi: SignInCopy = {
  tagline:
    "Không gian làm việc của studio để quản lý nghệ sĩ, quà tặng, đơn hàng và lời nhắn của người hâm mộ.",
  signInTitle: "Đăng nhập",
  signInIntro:
    "Dùng tên đăng nhập và mật khẩu do quản trị viên studio tạo cho bạn.",
  loginName: "Tên đăng nhập",
  password: "Mật khẩu",
  showPassword: "Hiện mật khẩu",
  hidePassword: "Ẩn mật khẩu",
  signIn: "Đăng nhập",
  signingIn: "Đang đăng nhập…",
  codeTitle: "Nhập mã xác minh",
  codeIntro: "Mở ứng dụng xác thực và nhập mã 6 chữ số của {account}.",
  codeLabel: "Mã 6 chữ số",
  verify: "Xác minh",
  verifying: "Đang xác minh…",
  useRecovery: "Dùng mã khôi phục",
  recoveryTitle: "Nhập mã khôi phục",
  recoveryIntro:
    "Mỗi mã khôi phục chỉ dùng được một lần. Có thể nhập kèm hoặc không kèm dấu gạch ngang.",
  recoveryLabel: "Mã khôi phục",
  useAuthenticator: "Dùng ứng dụng xác thực",
  newPasswordTitle: "Đặt mật khẩu của riêng bạn",
  newPasswordIntro:
    "{account} đã đăng nhập bằng mật khẩu tạm thời. Hãy đặt mật khẩu mới để tiếp tục.",
  newPassword: "Mật khẩu mới",
  confirmPassword: "Nhập lại mật khẩu mới",
  passwordHint:
    "Tối thiểu 12 ký tự. Vài từ cách nhau bằng dấu cách là lựa chọn tốt.",
  savePassword: "Lưu mật khẩu và đăng nhập",
  saving: "Đang lưu…",
  differentAccount: "Đăng nhập bằng tài khoản khác",
  invalidCredentials: "Tên đăng nhập hoặc mật khẩu không đúng.",
  locked:
    "Bạn đã thử sai quá nhiều lần. Tài khoản bị khóa 15 phút. Hãy thử lại sau hoặc liên hệ quản trị viên studio.",
  invalidCode:
    "Mã không đúng hoặc đã hết hạn. Hãy nhập mã 6 chữ số mới nhất trong ứng dụng.",
  invalidRecovery: "Mã khôi phục không đúng hoặc đã được dùng.",
  restart:
    "Phiên đăng nhập này đã hết hạn. Hãy nhập lại tên đăng nhập và mật khẩu.",
  unavailable: "Hiện không thể đăng nhập. Hãy thử lại sau ít phút.",
  mismatch: "Hai mật khẩu mới không khớp.",
  tooShort: "Dùng ít nhất 12 ký tự.",
  tooLong: "Dùng tối đa 128 ký tự.",
  sameAsLogin: "Mật khẩu không được trùng với tên đăng nhập.",
  sameAsCurrent: "Hãy chọn mật khẩu khác với mật khẩu tạm thời.",
  codeFormat: "Hãy nhập 6 chữ số hiển thị trong ứng dụng.",
};

const es: SignInCopy = {
  tagline:
    "El espacio de trabajo del estudio para artistas, regalos, pedidos y mensajes de fans.",
  signInTitle: "Iniciar sesión",
  signInIntro:
    "Usa el nombre de usuario y la contraseña que te dio la persona administradora del estudio.",
  loginName: "Nombre de usuario",
  password: "Contraseña",
  showPassword: "Mostrar contraseña",
  hidePassword: "Ocultar contraseña",
  signIn: "Iniciar sesión",
  signingIn: "Iniciando sesión…",
  codeTitle: "Introduce tu código de verificación",
  codeIntro:
    "Abre tu app de autenticación e introduce el código de 6 dígitos de {account}.",
  codeLabel: "Código de 6 dígitos",
  verify: "Verificar",
  verifying: "Verificando…",
  useRecovery: "Usar un código de recuperación",
  recoveryTitle: "Introduce un código de recuperación",
  recoveryIntro:
    "Cada código de recuperación sirve una sola vez. Puedes escribirlo con o sin guiones.",
  recoveryLabel: "Código de recuperación",
  useAuthenticator: "Usar la app de autenticación",
  newPasswordTitle: "Crea tu propia contraseña",
  newPasswordIntro:
    "{account} inició sesión con una contraseña temporal. Elige una nueva para continuar.",
  newPassword: "Nueva contraseña",
  confirmPassword: "Confirma la nueva contraseña",
  passwordHint:
    "Al menos 12 caracteres. Unas cuantas palabras separadas por espacios funcionan bien.",
  savePassword: "Guardar contraseña e iniciar sesión",
  saving: "Guardando…",
  differentAccount: "Iniciar sesión con otra cuenta",
  invalidCredentials: "El nombre de usuario o la contraseña no son correctos.",
  locked:
    "Demasiados intentos fallidos. Esta cuenta está bloqueada durante 15 minutos. Inténtalo más tarde o contacta con la persona administradora del estudio.",
  invalidCode:
    "El código no es correcto o ha caducado. Introduce el código de 6 dígitos más reciente de tu app.",
  invalidRecovery: "El código de recuperación no es correcto o ya se ha usado.",
  restart:
    "Este inicio de sesión ha caducado. Vuelve a introducir tu nombre de usuario y contraseña.",
  unavailable:
    "Ahora mismo no es posible iniciar sesión. Inténtalo de nuevo en un momento.",
  mismatch: "Las dos contraseñas nuevas no coinciden.",
  tooShort: "Usa al menos 12 caracteres.",
  tooLong: "Usa como máximo 128 caracteres.",
  sameAsLogin: "La contraseña no puede ser igual al nombre de usuario.",
  sameAsCurrent: "Elige una contraseña distinta de la temporal.",
  codeFormat: "Introduce los 6 dígitos que muestra tu app.",
};

const pt: SignInCopy = {
  tagline:
    "O espaço de trabalho do estúdio para artistas, presentes, pedidos e mensagens de fãs.",
  signInTitle: "Entrar",
  signInIntro:
    "Use o nome de usuário e a senha criados pela administração do estúdio.",
  loginName: "Nome de usuário",
  password: "Senha",
  showPassword: "Mostrar senha",
  hidePassword: "Ocultar senha",
  signIn: "Entrar",
  signingIn: "Entrando…",
  codeTitle: "Digite seu código de verificação",
  codeIntro:
    "Abra seu app autenticador e digite o código de 6 dígitos de {account}.",
  codeLabel: "Código de 6 dígitos",
  verify: "Verificar",
  verifying: "Verificando…",
  useRecovery: "Usar um código de recuperação",
  recoveryTitle: "Digite um código de recuperação",
  recoveryIntro:
    "Cada código de recuperação funciona uma única vez. Você pode digitá-lo com ou sem hífens.",
  recoveryLabel: "Código de recuperação",
  useAuthenticator: "Usar o app autenticador",
  newPasswordTitle: "Crie sua própria senha",
  newPasswordIntro:
    "{account} entrou com uma senha temporária. Escolha uma nova senha para continuar.",
  newPassword: "Nova senha",
  confirmPassword: "Confirme a nova senha",
  passwordHint:
    "Pelo menos 12 caracteres. Algumas palavras separadas por espaços funcionam bem.",
  savePassword: "Salvar senha e entrar",
  saving: "Salvando…",
  differentAccount: "Entrar com outra conta",
  invalidCredentials: "O nome de usuário ou a senha estão incorretos.",
  locked:
    "Muitas tentativas sem sucesso. Esta conta está bloqueada por 15 minutos. Tente novamente mais tarde ou fale com a administração do estúdio.",
  invalidCode:
    "O código está incorreto ou expirou. Digite o código de 6 dígitos mais recente do app.",
  invalidRecovery: "O código de recuperação está incorreto ou já foi usado.",
  restart:
    "Este login expirou. Digite seu nome de usuário e sua senha novamente.",
  unavailable: "Não é possível entrar agora. Tente novamente em instantes.",
  mismatch: "As duas novas senhas não coincidem.",
  tooShort: "Use pelo menos 12 caracteres.",
  tooLong: "Use no máximo 128 caracteres.",
  sameAsLogin: "A senha não pode ser igual ao nome de usuário.",
  sameAsCurrent: "Escolha uma senha diferente da temporária.",
  codeFormat: "Digite os 6 dígitos mostrados no app.",
};

export function signInCopy(locale: SupportedLocale): SignInCopy {
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
