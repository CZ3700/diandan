import type { SupportedLocale } from "@fan-support/contracts";

// ADR-021 staff accounts. English is the source; "{account}" is replaced with a login name.
type StaffCopy = Readonly<
  Record<
    | "title"
    | "intro"
    | "create"
    | "loginNameHint"
    | "displayName"
    | "roles"
    | "roleOwner"
    | "roleOwnerDetail"
    | "roleOperator"
    | "roleOperatorDetail"
    | "roleBroker"
    | "roleBrokerDetail"
    | "createAction"
    | "creating"
    | "temporaryTitle"
    | "temporaryIntro"
    | "copy"
    | "copied"
    | "done"
    | "you"
    | "active"
    | "suspended"
    | "twoFactorOn"
    | "twoFactorOff"
    | "mustChange"
    | "lastSignIn"
    | "never"
    | "changeRoles"
    | "saveRoles"
    | "resetPassword"
    | "clearTwoFactor"
    | "suspend"
    | "reactivate"
    | "confirm"
    | "cancel"
    | "working"
    | "confirmReset"
    | "confirmClear"
    | "confirmSuspend"
    | "saved"
    | "loginNameTaken"
    | "invalidLoginName"
    | "invalidDisplayName"
    | "noRole"
    | "selfLockout"
    | "keepStaffManagement"
    | "stale"
    | "forbidden"
    | "unknownRole"
    | "loadFailed"
    | "failed"
    | "retry"
    | "deleteAccount"
    | "confirmDelete"
    | "confirmDeleteArtists"
    | "deleteTypeName"
    | "deleteConfirm"
    | "deleted"
    | "deletedArtists",
    string
  >
>;

const en: StaffCopy = {
  title: "Staff accounts",
  intro:
    "Everyone on the team signs in with their own account. Roles decide what each person can do.",
  create: "New staff account",
  loginNameHint:
    "3–64 lowercase letters, digits, dots, dashes or underscores. It cannot be changed later.",
  displayName: "Name shown in the center",
  roles: "Roles",
  roleOwner: "Studio administrator",
  roleOwnerDetail: "Everything, including staff, finance and payment settings.",
  roleOperator: "Daily operations",
  roleOperatorDetail:
    "Content, gifts, orders and fan messages. No finance, payment settings or staff.",
  roleBroker: "Broker",
  roleBrokerDetail:
    "Only the artists assigned to them. Combined with another role, that role's wider access applies.",
  createAction: "Create account",
  creating: "Creating…",
  temporaryTitle: "Temporary password for {account}",
  temporaryIntro:
    "It is shown only this once. Give it to them in person or through a private channel; they choose their own password the first time they sign in.",
  copy: "Copy",
  copied: "Copied",
  done: "Done",
  you: "You",
  active: "Active",
  suspended: "Suspended",
  twoFactorOn: "Two-step verification on",
  twoFactorOff: "Two-step verification off",
  mustChange: "Has not replaced the temporary password yet",
  lastSignIn: "Last signed in {date}",
  never: "Has not signed in yet",
  changeRoles: "Change roles",
  saveRoles: "Save roles",
  resetPassword: "Reset password",
  clearTwoFactor: "Clear two-step verification",
  suspend: "Suspend",
  reactivate: "Reactivate",
  confirm: "Confirm",
  cancel: "Cancel",
  working: "Saving…",
  confirmReset:
    "Reset {account}'s password? They are signed out everywhere and must sign in with a new temporary password.",
  confirmClear:
    "Clear {account}'s two-step verification? They are signed out and can sign in with their password alone until they set it up again.",
  confirmSuspend:
    "Suspend {account}? They are signed out at once and cannot sign in until you reactivate them.",
  saved: "Saved.",
  loginNameTaken: "That login name is already in use.",
  invalidLoginName:
    "Use 3–64 lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit.",
  invalidDisplayName: "Enter a name of 1–80 characters.",
  noRole: "Choose at least one role.",
  selfLockout:
    "You cannot do this to your own account. Use Account settings instead.",
  keepStaffManagement:
    "Keep at least one role that can manage staff on your own account.",
  stale:
    "This account changed in another window. The list now shows the latest.",
  forbidden: "You no longer have permission to manage staff.",
  unknownRole: "That role no longer exists. Choose again.",
  loadFailed: "The staff list could not be loaded.",
  failed: "That did not go through. Try again in a moment.",
  retry: "Try again",
  deleteAccount: "Delete account",
  confirmDelete:
    "Delete {account} permanently? The account is signed out at once, can no longer sign in and leaves this list. Its login name cannot be used again. This cannot be undone.",
  confirmDeleteArtists:
    "Its {count} artists go back to studio management (unassigned).",
  deleteTypeName: "Type the login name {account} to confirm",
  deleteConfirm: "Delete permanently",
  deleted: "{account} was deleted.",
  deletedArtists:
    "{account} was deleted; {count} artists went back to studio management.",
};

const zhCN: StaffCopy = {
  title: "员工账号",
  intro: "团队里每个人都用自己的账号登录，角色决定各自能做什么。",
  create: "新建员工账号",
  loginNameHint: "3–64 个小写字母、数字、点、短横线或下划线。创建后不能修改。",
  displayName: "在管理中心显示的名字",
  roles: "角色",
  roleOwner: "工作室管理员",
  roleOwnerDetail: "全部权限，包括员工、财务和支付设置。",
  roleOperator: "日常运营",
  roleOperatorDetail:
    "内容、礼物、订单和粉丝留言；不含财务、支付设置和员工管理。",
  roleBroker: "经纪人",
  roleBrokerDetail:
    "只能查看和管理自己名下的艺人。同时勾选其他角色时，按其他角色的更大权限生效。",
  createAction: "创建账号",
  creating: "正在创建…",
  temporaryTitle: "{account} 的临时密码",
  temporaryIntro:
    "只显示这一次。请当面或通过私密渠道告诉对方；对方第一次登录时会设置自己的密码。",
  copy: "复制",
  copied: "已复制",
  done: "完成",
  you: "你",
  active: "正常",
  suspended: "已暂停",
  twoFactorOn: "已开启两步验证",
  twoFactorOff: "未开启两步验证",
  mustChange: "还没有换掉临时密码",
  lastSignIn: "上次登录：{date}",
  never: "还没有登录过",
  changeRoles: "修改角色",
  saveRoles: "保存角色",
  resetPassword: "重置密码",
  clearTwoFactor: "清除两步验证",
  suspend: "暂停",
  reactivate: "恢复",
  confirm: "确认",
  cancel: "取消",
  working: "正在保存…",
  confirmReset:
    "要重置 {account} 的密码吗？对方会在所有设备上退出登录，需要用新的临时密码登录。",
  confirmClear:
    "要清除 {account} 的两步验证吗？对方会退出登录，在重新设置之前只凭密码即可登录。",
  confirmSuspend:
    "要暂停 {account} 吗？对方会立即退出登录，恢复之前无法再登录。",
  saved: "已保存。",
  loginNameTaken: "这个登录名已经被使用。",
  invalidLoginName:
    "请使用 3–64 个小写字母、数字、点、短横线或下划线，并以字母或数字开头。",
  invalidDisplayName: "请输入 1–80 个字符的名字。",
  noRole: "请至少选择一个角色。",
  selfLockout: "不能对自己的账号做这个操作，请到“账号设置”中处理。",
  keepStaffManagement: "你自己的账号至少要保留一个能管理员工的角色。",
  stale: "这个账号在其他窗口中有改动，列表已更新为最新状态。",
  forbidden: "你已经没有管理员工的权限。",
  unknownRole: "这个角色已不存在，请重新选择。",
  loadFailed: "无法加载员工列表。",
  failed: "操作没有完成，请稍后再试。",
  retry: "重试",
  deleteAccount: "删除账号",
  confirmDelete:
    "永久删除 {account}？该账号会立即退出登录、不能再登录，并从列表中消失；它的登录名以后不能再用。此操作无法撤销。",
  confirmDeleteArtists: "名下 {count} 位艺人将转为超管直管（未分配）。",
  deleteTypeName: "请输入登录名 {account} 以确认",
  deleteConfirm: "永久删除",
  deleted: "已删除 {account}。",
  deletedArtists: "已删除 {account}，{count} 位艺人已转为超管直管。",
};

const ja: StaffCopy = {
  title: "スタッフアカウント",
  intro:
    "チームの全員が自分のアカウントでサインインします。できることはロールで決まります。",
  create: "スタッフアカウントを作成",
  loginNameHint:
    "小文字の英字・数字・ドット・ハイフン・アンダースコアで 3〜64 文字。あとから変更できません。",
  displayName: "管理センターに表示する名前",
  roles: "ロール",
  roleOwner: "スタジオ管理者",
  roleOwnerDetail: "スタッフ、経理、支払い設定を含むすべての権限。",
  roleOperator: "日常運営",
  roleOperatorDetail:
    "コンテンツ、ギフト、注文、ファンのメッセージ。経理、支払い設定、スタッフ管理は含みません。",
  roleBroker: "マネージャー",
  roleBrokerDetail:
    "自分が担当するアーティストのみ。ほかのロールと併用すると、そのロールの広い権限が適用されます。",
  createAction: "アカウントを作成",
  creating: "作成しています…",
  temporaryTitle: "{account} の仮パスワード",
  temporaryIntro:
    "表示されるのはこの 1 回だけです。直接会うか非公開の手段で伝えてください。初回サインイン時に本人が自分のパスワードを設定します。",
  copy: "コピー",
  copied: "コピーしました",
  done: "完了",
  you: "あなた",
  active: "有効",
  suspended: "停止中",
  twoFactorOn: "2 段階認証オン",
  twoFactorOff: "2 段階認証オフ",
  mustChange: "仮パスワードをまだ変更していません",
  lastSignIn: "最終サインイン：{date}",
  never: "まだサインインしていません",
  changeRoles: "ロールを変更",
  saveRoles: "ロールを保存",
  resetPassword: "パスワードをリセット",
  clearTwoFactor: "2 段階認証を解除",
  suspend: "停止",
  reactivate: "再開",
  confirm: "確認",
  cancel: "キャンセル",
  working: "保存しています…",
  confirmReset:
    "{account} のパスワードをリセットしますか？すべてのデバイスでサインアウトされ、新しい仮パスワードでサインインする必要があります。",
  confirmClear:
    "{account} の 2 段階認証を解除しますか？サインアウトされ、再設定するまではパスワードだけでサインインできます。",
  confirmSuspend:
    "{account} を停止しますか？すぐにサインアウトされ、再開するまでサインインできません。",
  saved: "保存しました。",
  loginNameTaken: "このログイン名はすでに使われています。",
  invalidLoginName:
    "小文字の英字・数字・ドット・ハイフン・アンダースコアで 3〜64 文字にし、英字か数字で始めてください。",
  invalidDisplayName: "1〜80 文字の名前を入力してください。",
  noRole: "ロールを 1 つ以上選んでください。",
  selfLockout:
    "自分のアカウントにはこの操作はできません。「アカウント設定」を使ってください。",
  keepStaffManagement:
    "自分のアカウントには、スタッフを管理できるロールを 1 つ以上残してください。",
  stale:
    "ほかのウィンドウでアカウントが変更されました。最新の一覧を表示しています。",
  forbidden: "スタッフを管理する権限がなくなりました。",
  unknownRole: "そのロールはもうありません。選び直してください。",
  loadFailed: "スタッフ一覧を読み込めませんでした。",
  failed:
    "操作を完了できませんでした。しばらくしてからもう一度お試しください。",
  retry: "再試行",
  deleteAccount: "アカウントを削除",
  confirmDelete:
    "{account} を完全に削除しますか？ただちにログアウトされ、再びログインできず、一覧から消えます。このログイン名は今後使えません。元に戻せません。",
  confirmDeleteArtists:
    "担当アーティスト {count} 名はスタジオ管理（未割り当て）に戻ります。",
  deleteTypeName: "確認のためログイン名 {account} を入力してください",
  deleteConfirm: "完全に削除",
  deleted: "{account} を削除しました。",
  deletedArtists:
    "{account} を削除し、アーティスト {count} 名をスタジオ管理に戻しました。",
};

const th: StaffCopy = {
  title: "บัญชีพนักงาน",
  intro:
    "ทุกคนในทีมเข้าสู่ระบบด้วยบัญชีของตัวเอง บทบาทกำหนดว่าแต่ละคนทำอะไรได้บ้าง",
  create: "สร้างบัญชีพนักงาน",
  loginNameHint:
    "ตัวอักษรพิมพ์เล็ก ตัวเลข จุด ขีดกลาง หรือขีดล่าง 3–64 ตัว เปลี่ยนภายหลังไม่ได้",
  displayName: "ชื่อที่แสดงในศูนย์จัดการ",
  roles: "บทบาท",
  roleOwner: "ผู้ดูแลสตูดิโอ",
  roleOwnerDetail: "ทุกสิทธิ์ รวมถึงพนักงาน การเงิน และการตั้งค่าการชำระเงิน",
  roleOperator: "งานประจำวัน",
  roleOperatorDetail:
    "เนื้อหา ของขวัญ คำสั่งซื้อ และข้อความจากแฟน ไม่รวมการเงิน การตั้งค่าการชำระเงิน และพนักงาน",
  roleBroker: "ผู้จัดการศิลปิน",
  roleBrokerDetail:
    "เฉพาะศิลปินที่ได้รับมอบหมายเท่านั้น หากเลือกบทบาทอื่นร่วมด้วย จะใช้สิทธิ์ที่กว้างกว่าของบทบาทนั้น",
  createAction: "สร้างบัญชี",
  creating: "กำลังสร้าง…",
  temporaryTitle: "รหัสผ่านชั่วคราวของ {account}",
  temporaryIntro:
    "แสดงเพียงครั้งนี้ครั้งเดียว โปรดแจ้งต่อหน้าหรือผ่านช่องทางส่วนตัว เจ้าของบัญชีจะตั้งรหัสผ่านของตัวเองเมื่อเข้าสู่ระบบครั้งแรก",
  copy: "คัดลอก",
  copied: "คัดลอกแล้ว",
  done: "เสร็จสิ้น",
  you: "คุณ",
  active: "ใช้งานอยู่",
  suspended: "ระงับอยู่",
  twoFactorOn: "เปิดการยืนยันสองขั้นตอนแล้ว",
  twoFactorOff: "ยังไม่เปิดการยืนยันสองขั้นตอน",
  mustChange: "ยังไม่ได้เปลี่ยนรหัสผ่านชั่วคราว",
  lastSignIn: "เข้าสู่ระบบล่าสุด {date}",
  never: "ยังไม่เคยเข้าสู่ระบบ",
  changeRoles: "เปลี่ยนบทบาท",
  saveRoles: "บันทึกบทบาท",
  resetPassword: "รีเซ็ตรหัสผ่าน",
  clearTwoFactor: "ล้างการยืนยันสองขั้นตอน",
  suspend: "ระงับ",
  reactivate: "เปิดใช้อีกครั้ง",
  confirm: "ยืนยัน",
  cancel: "ยกเลิก",
  working: "กำลังบันทึก…",
  confirmReset:
    "รีเซ็ตรหัสผ่านของ {account} ใช่ไหม เจ้าของบัญชีจะออกจากระบบทุกอุปกรณ์และต้องเข้าสู่ระบบด้วยรหัสผ่านชั่วคราวใหม่",
  confirmClear:
    "ล้างการยืนยันสองขั้นตอนของ {account} ใช่ไหม เจ้าของบัญชีจะออกจากระบบ และจะเข้าสู่ระบบด้วยรหัสผ่านอย่างเดียวได้จนกว่าจะตั้งค่าใหม่",
  confirmSuspend:
    "ระงับ {account} ใช่ไหม เจ้าของบัญชีจะออกจากระบบทันทีและเข้าสู่ระบบไม่ได้จนกว่าคุณจะเปิดใช้อีกครั้ง",
  saved: "บันทึกแล้ว",
  loginNameTaken: "ชื่อผู้ใช้นี้มีคนใช้แล้ว",
  invalidLoginName:
    "ใช้ตัวอักษรพิมพ์เล็ก ตัวเลข จุด ขีดกลาง หรือขีดล่าง 3–64 ตัว และขึ้นต้นด้วยตัวอักษรหรือตัวเลข",
  invalidDisplayName: "โปรดกรอกชื่อ 1–80 ตัวอักษร",
  noRole: "โปรดเลือกอย่างน้อยหนึ่งบทบาท",
  selfLockout: "ทำกับบัญชีของตัวเองไม่ได้ โปรดใช้การตั้งค่าบัญชีแทน",
  keepStaffManagement:
    "บัญชีของคุณต้องมีอย่างน้อยหนึ่งบทบาทที่จัดการพนักงานได้",
  stale: "บัญชีนี้ถูกเปลี่ยนในหน้าต่างอื่น รายการแสดงข้อมูลล่าสุดแล้ว",
  forbidden: "คุณไม่มีสิทธิ์จัดการพนักงานแล้ว",
  unknownRole: "บทบาทนี้ไม่มีแล้ว โปรดเลือกใหม่",
  loadFailed: "โหลดรายชื่อพนักงานไม่ได้",
  failed: "ดำเนินการไม่สำเร็จ โปรดลองอีกครั้งในอีกสักครู่",
  retry: "ลองอีกครั้ง",
  deleteAccount: "ลบบัญชี",
  confirmDelete:
    "ลบ {account} ถาวรหรือไม่ บัญชีจะออกจากระบบทันที เข้าสู่ระบบไม่ได้อีก และหายไปจากรายการ ชื่อเข้าสู่ระบบนี้จะใช้ซ้ำไม่ได้ และย้อนกลับไม่ได้",
  confirmDeleteArtists:
    "ศิลปินในความดูแล {count} คนจะกลับไปอยู่ในการดูแลของสตูดิโอ (ยังไม่มอบหมาย)",
  deleteTypeName: "พิมพ์ชื่อเข้าสู่ระบบ {account} เพื่อยืนยัน",
  deleteConfirm: "ลบถาวร",
  deleted: "ลบ {account} แล้ว",
  deletedArtists:
    "ลบ {account} แล้ว ศิลปิน {count} คนกลับไปอยู่ในการดูแลของสตูดิโอ",
};

const vi: StaffCopy = {
  title: "Tài khoản nhân viên",
  intro:
    "Mỗi người trong nhóm đăng nhập bằng tài khoản riêng. Vai trò quyết định mỗi người được làm gì.",
  create: "Tạo tài khoản nhân viên",
  loginNameHint:
    "3–64 ký tự gồm chữ thường, chữ số, dấu chấm, gạch ngang hoặc gạch dưới. Không thể đổi sau này.",
  displayName: "Tên hiển thị trong trung tâm",
  roles: "Vai trò",
  roleOwner: "Quản trị viên studio",
  roleOwnerDetail:
    "Toàn quyền, kể cả nhân viên, tài chính và cài đặt thanh toán.",
  roleOperator: "Vận hành hằng ngày",
  roleOperatorDetail:
    "Nội dung, quà tặng, đơn hàng và lời nhắn của người hâm mộ. Không gồm tài chính, cài đặt thanh toán hay nhân viên.",
  roleBroker: "Quản lý nghệ sĩ",
  roleBrokerDetail:
    "Chỉ các nghệ sĩ được phân công cho họ. Nếu chọn thêm vai trò khác, quyền rộng hơn của vai trò đó sẽ được áp dụng.",
  createAction: "Tạo tài khoản",
  creating: "Đang tạo…",
  temporaryTitle: "Mật khẩu tạm thời của {account}",
  temporaryIntro:
    "Mật khẩu chỉ hiển thị lần này. Hãy đưa trực tiếp hoặc qua kênh riêng tư; người đó sẽ tự đặt mật khẩu khi đăng nhập lần đầu.",
  copy: "Sao chép",
  copied: "Đã sao chép",
  done: "Xong",
  you: "Bạn",
  active: "Đang hoạt động",
  suspended: "Đã tạm ngưng",
  twoFactorOn: "Đã bật xác minh hai bước",
  twoFactorOff: "Chưa bật xác minh hai bước",
  mustChange: "Chưa thay mật khẩu tạm thời",
  lastSignIn: "Đăng nhập lần cuối: {date}",
  never: "Chưa đăng nhập lần nào",
  changeRoles: "Đổi vai trò",
  saveRoles: "Lưu vai trò",
  resetPassword: "Đặt lại mật khẩu",
  clearTwoFactor: "Xóa xác minh hai bước",
  suspend: "Tạm ngưng",
  reactivate: "Kích hoạt lại",
  confirm: "Xác nhận",
  cancel: "Hủy",
  working: "Đang lưu…",
  confirmReset:
    "Đặt lại mật khẩu của {account}? Người đó sẽ bị đăng xuất trên mọi thiết bị và phải đăng nhập bằng mật khẩu tạm thời mới.",
  confirmClear:
    "Xóa xác minh hai bước của {account}? Người đó sẽ bị đăng xuất và có thể đăng nhập chỉ bằng mật khẩu cho đến khi cài đặt lại.",
  confirmSuspend:
    "Tạm ngưng {account}? Người đó bị đăng xuất ngay và không thể đăng nhập cho đến khi bạn kích hoạt lại.",
  saved: "Đã lưu.",
  loginNameTaken: "Tên đăng nhập này đã được dùng.",
  invalidLoginName:
    "Dùng 3–64 ký tự gồm chữ thường, chữ số, dấu chấm, gạch ngang hoặc gạch dưới, bắt đầu bằng chữ hoặc số.",
  invalidDisplayName: "Nhập tên dài 1–80 ký tự.",
  noRole: "Chọn ít nhất một vai trò.",
  selfLockout:
    "Không thể làm việc này với tài khoản của chính bạn. Hãy dùng Cài đặt tài khoản.",
  keepStaffManagement:
    "Tài khoản của bạn phải giữ ít nhất một vai trò quản lý nhân viên.",
  stale:
    "Tài khoản này vừa thay đổi ở cửa sổ khác. Danh sách đã hiển thị trạng thái mới nhất.",
  forbidden: "Bạn không còn quyền quản lý nhân viên.",
  unknownRole: "Vai trò này không còn nữa. Hãy chọn lại.",
  loadFailed: "Không tải được danh sách nhân viên.",
  failed: "Thao tác chưa hoàn tất. Hãy thử lại sau ít phút.",
  retry: "Thử lại",
  deleteAccount: "Xóa tài khoản",
  confirmDelete:
    "Xóa vĩnh viễn {account}? Tài khoản bị đăng xuất ngay, không thể đăng nhập lại và biến mất khỏi danh sách. Tên đăng nhập này không thể dùng lại. Không thể hoàn tác.",
  confirmDeleteArtists:
    "{count} nghệ sĩ do tài khoản này phụ trách sẽ trở về studio quản lý (chưa phân công).",
  deleteTypeName: "Nhập tên đăng nhập {account} để xác nhận",
  deleteConfirm: "Xóa vĩnh viễn",
  deleted: "Đã xóa {account}.",
  deletedArtists: "Đã xóa {account}; {count} nghệ sĩ đã trở về studio quản lý.",
};

const es: StaffCopy = {
  title: "Cuentas del equipo",
  intro:
    "Cada persona del equipo inicia sesión con su propia cuenta. Los roles deciden qué puede hacer cada una.",
  create: "Nueva cuenta del equipo",
  loginNameHint:
    "De 3 a 64 minúsculas, dígitos, puntos, guiones o guiones bajos. No se puede cambiar después.",
  displayName: "Nombre que se muestra en el centro",
  roles: "Roles",
  roleOwner: "Administración del estudio",
  roleOwnerDetail:
    "Todo, incluidos el equipo, las finanzas y la configuración de pagos.",
  roleOperator: "Operación diaria",
  roleOperatorDetail:
    "Contenido, regalos, pedidos y mensajes de fans. Sin finanzas, configuración de pagos ni equipo.",
  roleBroker: "Representante",
  roleBrokerDetail:
    "Solo los artistas que tiene asignados. Si se combina con otro rol, se aplica el acceso más amplio de ese rol.",
  createAction: "Crear cuenta",
  creating: "Creando…",
  temporaryTitle: "Contraseña temporal de {account}",
  temporaryIntro:
    "Solo se muestra esta vez. Entrégala en persona o por un canal privado; la persona elegirá su propia contraseña al iniciar sesión por primera vez.",
  copy: "Copiar",
  copied: "Copiada",
  done: "Listo",
  you: "Tú",
  active: "Activa",
  suspended: "Suspendida",
  twoFactorOn: "Verificación en dos pasos activada",
  twoFactorOff: "Verificación en dos pasos desactivada",
  mustChange: "Aún no ha cambiado la contraseña temporal",
  lastSignIn: "Último inicio de sesión: {date}",
  never: "Aún no ha iniciado sesión",
  changeRoles: "Cambiar roles",
  saveRoles: "Guardar roles",
  resetPassword: "Restablecer contraseña",
  clearTwoFactor: "Quitar la verificación en dos pasos",
  suspend: "Suspender",
  reactivate: "Reactivar",
  confirm: "Confirmar",
  cancel: "Cancelar",
  working: "Guardando…",
  confirmReset:
    "¿Restablecer la contraseña de {account}? Se cerrará su sesión en todas partes y tendrá que entrar con una nueva contraseña temporal.",
  confirmClear:
    "¿Quitar la verificación en dos pasos de {account}? Se cerrará su sesión y podrá entrar solo con la contraseña hasta que la vuelva a activar.",
  confirmSuspend:
    "¿Suspender {account}? Su sesión se cierra al momento y no podrá entrar hasta que la reactives.",
  saved: "Guardado.",
  loginNameTaken: "Ese nombre de usuario ya está en uso.",
  invalidLoginName:
    "Usa de 3 a 64 minúsculas, dígitos, puntos, guiones o guiones bajos, empezando por una letra o un dígito.",
  invalidDisplayName: "Escribe un nombre de 1 a 80 caracteres.",
  noRole: "Elige al menos un rol.",
  selfLockout:
    "No puedes hacer esto con tu propia cuenta. Usa la configuración de la cuenta.",
  keepStaffManagement:
    "Tu propia cuenta debe conservar al menos un rol que gestione el equipo.",
  stale:
    "Esta cuenta cambió en otra ventana. La lista ya muestra el estado actual.",
  forbidden: "Ya no tienes permiso para gestionar el equipo.",
  unknownRole: "Ese rol ya no existe. Elige de nuevo.",
  loadFailed: "No se pudo cargar la lista del equipo.",
  failed: "No se pudo completar. Inténtalo de nuevo en un momento.",
  retry: "Reintentar",
  deleteAccount: "Eliminar cuenta",
  confirmDelete:
    "¿Eliminar {account} para siempre? La cuenta se cierra al instante, ya no puede iniciar sesión y desaparece de esta lista. Su nombre de usuario no podrá volver a usarse. No se puede deshacer.",
  confirmDeleteArtists:
    "Sus {count} artistas vuelven a la gestión del estudio (sin asignar).",
  deleteTypeName: "Escribe el nombre de usuario {account} para confirmar",
  deleteConfirm: "Eliminar para siempre",
  deleted: "Se eliminó {account}.",
  deletedArtists:
    "Se eliminó {account}; {count} artistas volvieron a la gestión del estudio.",
};

const pt: StaffCopy = {
  title: "Contas da equipe",
  intro:
    "Cada pessoa da equipe entra com a própria conta. As funções definem o que cada uma pode fazer.",
  create: "Nova conta da equipe",
  loginNameHint:
    "De 3 a 64 letras minúsculas, dígitos, pontos, hífens ou sublinhados. Não pode ser alterado depois.",
  displayName: "Nome exibido no centro",
  roles: "Funções",
  roleOwner: "Administração do estúdio",
  roleOwnerDetail:
    "Tudo, incluindo equipe, finanças e configurações de pagamento.",
  roleOperator: "Operação diária",
  roleOperatorDetail:
    "Conteúdo, presentes, pedidos e mensagens de fãs. Sem finanças, configurações de pagamento ou equipe.",
  roleBroker: "Agente",
  roleBrokerDetail:
    "Apenas os artistas atribuídos a essa pessoa. Combinada com outra função, vale o acesso mais amplo dessa função.",
  createAction: "Criar conta",
  creating: "Criando…",
  temporaryTitle: "Senha temporária de {account}",
  temporaryIntro:
    "Ela aparece só desta vez. Entregue pessoalmente ou por um canal privado; a pessoa escolhe a própria senha no primeiro login.",
  copy: "Copiar",
  copied: "Copiada",
  done: "Concluir",
  you: "Você",
  active: "Ativa",
  suspended: "Suspensa",
  twoFactorOn: "Verificação em duas etapas ativada",
  twoFactorOff: "Verificação em duas etapas desativada",
  mustChange: "Ainda não trocou a senha temporária",
  lastSignIn: "Último login: {date}",
  never: "Ainda não entrou",
  changeRoles: "Alterar funções",
  saveRoles: "Salvar funções",
  resetPassword: "Redefinir senha",
  clearTwoFactor: "Remover a verificação em duas etapas",
  suspend: "Suspender",
  reactivate: "Reativar",
  confirm: "Confirmar",
  cancel: "Cancelar",
  working: "Salvando…",
  confirmReset:
    "Redefinir a senha de {account}? A pessoa sai da conta em todos os dispositivos e precisa entrar com uma nova senha temporária.",
  confirmClear:
    "Remover a verificação em duas etapas de {account}? A pessoa sai da conta e pode entrar só com a senha até configurar de novo.",
  confirmSuspend:
    "Suspender {account}? A pessoa sai da conta na hora e não consegue entrar até você reativar.",
  saved: "Salvo.",
  loginNameTaken: "Esse nome de usuário já está em uso.",
  invalidLoginName:
    "Use de 3 a 64 letras minúsculas, dígitos, pontos, hífens ou sublinhados, começando com letra ou dígito.",
  invalidDisplayName: "Digite um nome de 1 a 80 caracteres.",
  noRole: "Escolha pelo menos uma função.",
  selfLockout:
    "Você não pode fazer isso na sua própria conta. Use as configurações da conta.",
  keepStaffManagement:
    "Sua conta precisa manter pelo menos uma função que gerencie a equipe.",
  stale: "Esta conta mudou em outra janela. A lista já mostra o estado atual.",
  forbidden: "Você não tem mais permissão para gerenciar a equipe.",
  unknownRole: "Essa função não existe mais. Escolha de novo.",
  loadFailed: "Não foi possível carregar a lista da equipe.",
  failed: "Não foi possível concluir. Tente novamente em instantes.",
  retry: "Tentar de novo",
  deleteAccount: "Excluir conta",
  confirmDelete:
    "Excluir {account} permanentemente? A conta é desconectada na hora, não pode mais entrar e sai desta lista. O nome de login não poderá ser usado de novo. Não é possível desfazer.",
  confirmDeleteArtists:
    "Os {count} artistas desta conta voltam para a gestão do estúdio (sem atribuição).",
  deleteTypeName: "Digite o nome de login {account} para confirmar",
  deleteConfirm: "Excluir permanentemente",
  deleted: "{account} foi excluída.",
  deletedArtists:
    "{account} foi excluída; {count} artistas voltaram para a gestão do estúdio.",
};

export function staffCopy(locale: SupportedLocale): StaffCopy {
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
