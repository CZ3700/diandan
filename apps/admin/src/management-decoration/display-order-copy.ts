import type { SupportedLocale } from "@fan-support/contracts";

// L2-10: storefront order editor copy; English is the source.
const en = {
  tab: "Display order",
  title: "Storefront display order",
  intro:
    "Choose which artists and gifts appear first on the storefront. Saving takes effect immediately.",
  artists: "Artists",
  gifts: "Gifts",
  moveUp: "Move up",
  moveDown: "Move down",
  moveTop: "Move to top",
  paused: "Paused",
  manual: "Placed by hand",
  save: "Save and apply",
  saving: "Saving…",
  saved: "Saved. The storefront now shows this order.",
  revert: "Undo changes",
  reset: "Restore default order",
  resetConfirm:
    "Restore the default order now? Artists return to their original order and gifts to newest first. This takes effect immediately.",
  resetDone: "Default order restored.",
  empty: "Nothing published to arrange yet.",
  loading: "Loading…",
  failed: "The order could not be loaded.",
  retry: "Try again",
  conflict:
    "Someone else just changed this order. The latest order is loaded; please arrange again.",
  readOnly: "You can view the order but need publish permission to change it.",
  unsaved: "Unsaved changes",
  newItems:
    "Newly added artists and gifts appear after the ones placed here; move them up at any time.",
  saveFailed: "The order was not saved. Try again.",
  discard: "Discard the unsaved order changes?",
};
export type DisplayOrderCopy = typeof en;
const zhCN: DisplayOrderCopy = {
  tab: "展示顺序",
  title: "商城展示顺序",
  intro: "调整艺人和礼物在商城里出现的先后，保存后立即生效。",
  artists: "艺人",
  gifts: "礼物",
  moveUp: "上移",
  moveDown: "下移",
  moveTop: "置顶",
  paused: "已暂停",
  manual: "已手动排序",
  save: "保存并生效",
  saving: "正在保存…",
  saved: "已保存，商城已按新顺序显示。",
  revert: "撤销修改",
  reset: "恢复默认顺序",
  resetConfirm:
    "现在恢复默认顺序吗？艺人回到原有顺序，礼物按最新发布排列，会立即生效。",
  resetDone: "已恢复默认顺序。",
  empty: "还没有可排序的已发布内容。",
  loading: "正在读取…",
  failed: "顺序读取失败。",
  retry: "重试",
  conflict: "其他人刚修改了顺序，已载入最新顺序，请重新调整。",
  readOnly: "你可以查看顺序，但需要发布权限才能修改。",
  unsaved: "有未保存的修改",
  newItems: "之后新增的艺人和礼物会排在这里已排好的项目之后，可随时上移。",
  saveFailed: "顺序没有保存成功，请重试。",
  discard: "放弃未保存的顺序修改吗？",
};
const ja: DisplayOrderCopy = {
  tab: "表示順",
  title: "ストアの表示順",
  intro:
    "アーティストとギフトがストアに表示される順番を決めます。保存するとすぐに反映されます。",
  artists: "アーティスト",
  gifts: "ギフト",
  moveUp: "上へ",
  moveDown: "下へ",
  moveTop: "先頭へ",
  paused: "停止中",
  manual: "手動で配置",
  save: "保存して反映",
  saving: "保存中…",
  saved: "保存しました。ストアはこの順番で表示されます。",
  revert: "変更を取り消す",
  reset: "既定の順番に戻す",
  resetConfirm:
    "既定の順番に戻しますか？アーティストは元の順番、ギフトは新しい順になり、すぐに反映されます。",
  resetDone: "既定の順番に戻しました。",
  empty: "並べ替えできる公開済みの項目がまだありません。",
  loading: "読み込み中…",
  failed: "順番を読み込めませんでした。",
  retry: "再試行",
  conflict:
    "ほかの担当者が順番を変更しました。最新の順番を読み込んだので、もう一度並べ替えてください。",
  readOnly: "順番は閲覧できますが、変更には公開権限が必要です。",
  unsaved: "未保存の変更があります",
  newItems:
    "新しく追加したアーティストやギフトは、ここで並べた項目の後ろに表示されます。いつでも上へ移動できます。",
  saveFailed: "順番を保存できませんでした。もう一度お試しください。",
  discard: "保存していない順番の変更を破棄しますか？",
};
const th: DisplayOrderCopy = {
  tab: "ลำดับการแสดง",
  title: "ลำดับการแสดงในร้าน",
  intro: "เลือกว่าศิลปินและของขวัญใดจะแสดงก่อนในร้าน เมื่อบันทึกจะมีผลทันที",
  artists: "ศิลปิน",
  gifts: "ของขวัญ",
  moveUp: "เลื่อนขึ้น",
  moveDown: "เลื่อนลง",
  moveTop: "ย้ายไปบนสุด",
  paused: "หยุดชั่วคราว",
  manual: "จัดลำดับเอง",
  save: "บันทึกและใช้งาน",
  saving: "กำลังบันทึก…",
  saved: "บันทึกแล้ว ร้านแสดงตามลำดับนี้แล้ว",
  revert: "ยกเลิกการแก้ไข",
  reset: "คืนค่าลำดับเริ่มต้น",
  resetConfirm:
    "คืนค่าลำดับเริ่มต้นตอนนี้หรือไม่ ศิลปินจะกลับไปลำดับเดิมและของขวัญเรียงจากใหม่สุด มีผลทันที",
  resetDone: "คืนค่าลำดับเริ่มต้นแล้ว",
  empty: "ยังไม่มีรายการที่เผยแพร่ให้จัดลำดับ",
  loading: "กำลังโหลด…",
  failed: "โหลดลำดับไม่สำเร็จ",
  retry: "ลองอีกครั้ง",
  conflict:
    "มีผู้อื่นเพิ่งเปลี่ยนลำดับ ระบบโหลดลำดับล่าสุดแล้ว โปรดจัดลำดับใหม่",
  readOnly: "ดูลำดับได้ แต่ต้องมีสิทธิ์เผยแพร่จึงจะแก้ไขได้",
  unsaved: "มีการแก้ไขที่ยังไม่บันทึก",
  newItems:
    "ศิลปินและของขวัญที่เพิ่มใหม่จะแสดงต่อจากรายการที่จัดไว้ที่นี่ และเลื่อนขึ้นได้ทุกเมื่อ",
  saveFailed: "บันทึกลำดับไม่สำเร็จ โปรดลองอีกครั้ง",
  discard: "ทิ้งการแก้ไขลำดับที่ยังไม่บันทึกหรือไม่",
};
const vi: DisplayOrderCopy = {
  tab: "Thứ tự hiển thị",
  title: "Thứ tự hiển thị trên cửa hàng",
  intro:
    "Chọn nghệ sĩ và quà tặng nào xuất hiện trước trên cửa hàng. Lưu là có hiệu lực ngay.",
  artists: "Nghệ sĩ",
  gifts: "Quà tặng",
  moveUp: "Lên",
  moveDown: "Xuống",
  moveTop: "Lên đầu",
  paused: "Tạm dừng",
  manual: "Đã sắp xếp thủ công",
  save: "Lưu và áp dụng",
  saving: "Đang lưu…",
  saved: "Đã lưu. Cửa hàng đang hiển thị theo thứ tự này.",
  revert: "Hủy thay đổi",
  reset: "Khôi phục thứ tự mặc định",
  resetConfirm:
    "Khôi phục thứ tự mặc định ngay? Nghệ sĩ về thứ tự ban đầu, quà tặng xếp mới nhất trước. Có hiệu lực ngay.",
  resetDone: "Đã khôi phục thứ tự mặc định.",
  empty: "Chưa có mục đã xuất bản để sắp xếp.",
  loading: "Đang tải…",
  failed: "Không tải được thứ tự.",
  retry: "Thử lại",
  conflict:
    "Người khác vừa thay đổi thứ tự. Thứ tự mới nhất đã được tải, vui lòng sắp xếp lại.",
  readOnly: "Bạn có thể xem thứ tự nhưng cần quyền xuất bản để thay đổi.",
  unsaved: "Có thay đổi chưa lưu",
  newItems:
    "Nghệ sĩ và quà tặng mới thêm sẽ xuất hiện sau các mục đã sắp xếp ở đây; bạn có thể đưa lên bất cứ lúc nào.",
  saveFailed: "Chưa lưu được thứ tự. Vui lòng thử lại.",
  discard: "Bỏ các thay đổi thứ tự chưa lưu?",
};
const es: DisplayOrderCopy = {
  tab: "Orden de visualización",
  title: "Orden en la tienda",
  intro:
    "Elige qué artistas y regalos aparecen primero en la tienda. Al guardar, el cambio se aplica de inmediato.",
  artists: "Artistas",
  gifts: "Regalos",
  moveUp: "Subir",
  moveDown: "Bajar",
  moveTop: "Mover al inicio",
  paused: "En pausa",
  manual: "Colocado a mano",
  save: "Guardar y aplicar",
  saving: "Guardando…",
  saved: "Guardado. La tienda ya muestra este orden.",
  revert: "Deshacer cambios",
  reset: "Restaurar orden predeterminado",
  resetConfirm:
    "¿Restaurar ahora el orden predeterminado? Los artistas vuelven a su orden original y los regalos, del más reciente al más antiguo. Se aplica de inmediato.",
  resetDone: "Orden predeterminado restaurado.",
  empty: "Todavía no hay nada publicado para ordenar.",
  loading: "Cargando…",
  failed: "No se pudo cargar el orden.",
  retry: "Reintentar",
  conflict:
    "Otra persona acaba de cambiar el orden. Se cargó el más reciente; vuelve a ordenarlo.",
  readOnly:
    "Puedes ver el orden, pero necesitas permiso de publicación para cambiarlo.",
  unsaved: "Cambios sin guardar",
  newItems:
    "Los artistas y regalos nuevos aparecen después de los que colocas aquí; puedes subirlos cuando quieras.",
  saveFailed: "No se guardó el orden. Inténtalo de nuevo.",
  discard: "¿Descartar los cambios de orden sin guardar?",
};
const pt: DisplayOrderCopy = {
  tab: "Ordem de exibição",
  title: "Ordem na loja",
  intro:
    "Escolha quais artistas e presentes aparecem primeiro na loja. Ao salvar, a mudança vale na hora.",
  artists: "Artistas",
  gifts: "Presentes",
  moveUp: "Subir",
  moveDown: "Descer",
  moveTop: "Mover para o topo",
  paused: "Pausado",
  manual: "Posicionado manualmente",
  save: "Salvar e aplicar",
  saving: "Salvando…",
  saved: "Salvo. A loja já mostra esta ordem.",
  revert: "Desfazer alterações",
  reset: "Restaurar ordem padrão",
  resetConfirm:
    "Restaurar a ordem padrão agora? Os artistas voltam à ordem original e os presentes, do mais recente ao mais antigo. Vale na hora.",
  resetDone: "Ordem padrão restaurada.",
  empty: "Ainda não há nada publicado para ordenar.",
  loading: "Carregando…",
  failed: "Não foi possível carregar a ordem.",
  retry: "Tentar novamente",
  conflict:
    "Outra pessoa acabou de mudar a ordem. A ordem mais recente foi carregada; organize novamente.",
  readOnly:
    "Você pode ver a ordem, mas precisa de permissão de publicação para mudá-la.",
  unsaved: "Alterações não salvas",
  newItems:
    "Artistas e presentes novos aparecem depois dos que você posiciona aqui; você pode subi-los a qualquer momento.",
  saveFailed: "A ordem não foi salva. Tente novamente.",
  discard: "Descartar as alterações de ordem não salvas?",
};
export function displayOrderCopy(locale: SupportedLocale): DisplayOrderCopy {
  switch (locale) {
    case "en":
      return en;
    case "zh-CN":
      return zhCN;
    case "ja":
      return ja;
    case "th":
      return th;
    case "vi":
      return vi;
    case "es":
      return es;
    case "pt":
      return pt;
  }
}
