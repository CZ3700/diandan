from pathlib import Path
import json
rows = '''giftFilters|Filter and sort|筛选与排序|กรองและเรียงลำดับ|Lọc và sắp xếp|絞り込み・並べ替え|Filtrar y ordenar|Filtrar e ordenar
giftFiltersDescription|Find a gift by category, price or availability.|按类别、价格或售卖状态寻找礼物。|ค้นหาของขวัญตามหมวดหมู่ ราคา หรือสถานะ|Tìm quà theo danh mục, giá hoặc tình trạng.|カテゴリー、価格、販売状況で探せます。|Busca por categoría, precio o disponibilidad.|Encontre por categoria, preço ou disponibilidade.
giftSortLabel|Sort by|排序|เรียงตาม|Sắp xếp theo|並べ替え|Ordenar por|Ordenar por
giftSortRecommended|Recommended|推荐顺序|แนะนำ|Đề xuất|おすすめ順|Recomendados|Recomendados
giftSortPriceAsc|Price: low to high|价格从低到高|ราคา: ต่ำไปสูง|Giá: thấp đến cao|価格の安い順|Precio: de menor a mayor|Preço: menor para maior
giftSortPriceDesc|Price: high to low|价格从高到低|ราคา: สูงไปต่ำ|Giá: cao đến thấp|価格の高い順|Precio: de mayor a menor|Preço: maior para menor
giftCategoryLabel|Category|类别|หมวดหมู่|Danh mục|カテゴリー|Categoría|Categoria
giftCategoryAll|All categories|全部类别|ทุกหมวดหมู่|Tất cả danh mục|すべて|Todas las categorías|Todas as categorias
giftCategoryFlowers|Flowers|鲜花|ดอกไม้|Hoa|花|Flores|Flores
giftCategoryFood|Food|食品|อาหาร|Thực phẩm|食品|Alimentos|Alimentos
giftCategoryBeauty|Beauty|美妆|ความงาม|Làm đẹp|ビューティー|Belleza|Beleza
giftCategoryAccessory|Accessories|配饰|เครื่องประดับ|Phụ kiện|アクセサリー|Accesorios|Acessórios
giftCategoryOther|Other gifts|其他礼物|ของขวัญอื่น ๆ|Quà khác|その他のギフト|Otros regalos|Outros presentes
giftAvailabilityLabel|Availability|售卖状态|สถานะ|Tình trạng|販売状況|Disponibilidad|Disponibilidade
giftAvailabilityAll|All gifts|全部礼物|ของขวัญทั้งหมด|Tất cả quà|すべてのギフト|Todos los regalos|Todos os presentes
giftAvailabilityPurchasable|Available|可选购|พร้อมเลือก|Có thể chọn|購入可能|Disponibles|Disponíveis
giftAvailabilityUnavailable|Currently unavailable|暂不可选购|ยังไม่พร้อม|Hiện chưa có|現在購入できません|No disponibles ahora|Indisponíveis no momento
giftPriceRangeLabel|Price range|价格区间|ช่วงราคา|Khoảng giá|価格帯|Rango de precios|Faixa de preço
giftPriceMinimum|Minimum price|最低价格|ราคาต่ำสุด|Giá tối thiểu|最低価格|Precio mínimo|Preço mínimo
giftPriceMaximum|Maximum price|ราคาสูงสุด|ราคาสูงสุด|Giá tối đa|最高価格|Precio máximo|Preço máximo
giftPriceInputHint|Enter {currency} amounts, for example {example}.|输入 {currency} 金额，例如 {example}。|ระบุจำนวนเงิน {currency} เช่น {example}|Nhập số tiền {currency}, ví dụ {example}.|{currency} の金額を入力してください。例：{example}。|Introduce importes en {currency}, por ejemplo {example}.|Insira valores em {currency}, por exemplo {example}.
giftPriceInvalid|Enter a valid price with the supported decimal places.|请输入符合该币种小数位数的有效价格。|กรุณาระบุราคาและจำนวนทศนิยมให้ถูกต้อง|Nhập giá hợp lệ với số chữ số thập phân phù hợp.|通貨に合った小数桁数で価格を入力してください。|Introduce un precio con los decimales admitidos.|Insira um preço com as casas decimais permitidas.
giftPriceRangeInvalid|Maximum price must be at least the minimum.|最高价格不能低于最低价格。|ราคาสูงสุดต้องไม่น้อยกว่าราคาต่ำสุด|Giá tối đa phải lớn hơn hoặc bằng giá tối thiểu.|最高価格は最低価格以上にしてください。|El máximo debe ser igual o superior al mínimo.|O máximo deve ser igual ou superior ao mínimo.
giftApplyFilters|Apply filters|应用筛选|ใช้ตัวกรอง|Áp dụng bộ lọc|適用する|Aplicar filtros|Aplicar filtros
giftResetFilters|Clear filters|清除筛选|ล้างตัวกรอง|Xóa bộ lọc|絞り込みを解除|Borrar filtros|Limpar filtros
giftResultsCount|{count, plural, one {# gift} other {# gifts}}|共 {count} 件礼物|ของขวัญ {count} รายการ|{count} món quà|{count} 件のギフト|{count, plural, one {# regalo} other {# regalos}}|{count, plural, one {# presente} other {# presentes}}
giftPaginationLabel|Gift pages|礼物分页|หน้าของขวัญ|Trang quà tặng|ギフトのページ|Páginas de regalos|Páginas de presentes
giftPaginationPrevious|Previous page|上一页|หน้าก่อนหน้า|Trang trước|前のページ|Página anterior|Página anterior
giftPaginationNext|Next page|下一页|หน้าถัดไป|Trang sau|次のページ|Página siguiente|Próxima página
giftPaginationPage|Page {page} of {total}|第 {page} 页，共 {total} 页|หน้า {page} จาก {total}|Trang {page} trên {total}|{total} ページ中 {page} ページ|Página {page} de {total}|Página {page} de {total}
giftPaginationGoToPage|Go to page {page}|前往第 {page} 页|ไปหน้า {page}|Đến trang {page}|{page} ページへ|Ir a la página {page}|Ir para a página {page}
giftPaginationLimited|Only the first {limit} pages can be browsed. Narrow your filters to find more.|最多浏览前 {limit} 页，请缩小筛选范围以查找更多礼物。|ดูได้ {limit} หน้าแรก กรุณากรองให้แคบลง|Chỉ có thể xem {limit} trang đầu. Hãy thu hẹp bộ lọc.|最初の {limit} ページまで表示できます。条件を絞って検索してください。|Puedes ver las primeras {limit} páginas. Ajusta los filtros para encontrar más.|Pode ver as primeiras {limit} páginas. Refine os filtros para encontrar mais.
giftPageOutOfRangeTitle|This page has no gifts.|此页暂无礼物。|หน้านี้ไม่มีของขวัญ|Trang này không có quà.|このページにはギフトがありません。|Esta página no tiene regalos.|Esta página não tem presentes.
giftPageOutOfRangeBody|The collection may have changed. Return to the first page.|礼物目录可能有更新，请返回第一页。|รายการอาจเปลี่ยนไป กลับไปหน้าแรก|Danh mục có thể đã thay đổi. Hãy về trang đầu.|内容が更新された可能性があります。最初のページへお戻りください。|La colección puede haber cambiado. Vuelve a la primera página.|A coleção pode ter mudado. Volte à primeira página.
giftFirstPage|First page|第一页|หน้าแรก|Trang đầu|最初のページ|Primera página|Primeira página
giftNoResultsTitle|No gifts match yet.|暂无符合条件的礼物。|ยังไม่มีของขวัญที่ตรงกัน|Chưa có quà phù hợp.|条件に合うギフトがありません。|No hay regalos que coincidan.|Nenhum presente corresponde.
giftNoResultsBody|Try a different category or a wider price range.|试试其他类别，或扩大价格区间。|ลองหมวดหมู่อื่นหรือช่วงราคาที่กว้างขึ้น|Thử danh mục khác hoặc khoảng giá rộng hơn.|カテゴリーを変えるか、価格帯を広げてみてください。|Prueba otra categoría o amplía el rango de precios.|Experimente outra categoria ou amplie a faixa de preço.
giftPriceStartingAt|From|起价|เริ่มต้น|Từ|最低価格|Desde|A partir de
giftNotAvailable|Currently unavailable|暂不可选购|ยังไม่พร้อม|Hiện chưa có|現在購入できません|No disponible ahora|Indisponível no momento
giftRecipient|For your artist|送给你的艺人|สำหรับศิลปินของคุณ|Dành cho nghệ sĩ của bạn|贈るアーティスト|Para tu artista|Para o seu artista
giftRecipientChoose|Choose an artist|选择艺人|เลือกศิลปิน|Chọn nghệ sĩ|アーティストを選ぶ|Elige un artista|Escolha um artista
giftRecipientChange|Change artist|更换艺人|เปลี่ยนศิลปิน|Đổi nghệ sĩ|アーティストを変更|Cambiar artista|Mudar artista
giftRecipientMissing|Select an artist to check which options they can receive.|选择艺人后，可查看适合送给对方的规格。|เลือกศิลปินเพื่อตรวจสอบตัวเลือกที่รับได้|Chọn nghệ sĩ để xem lựa chọn họ có thể nhận.|アーティストを選ぶと、贈れる種類を確認できます。|Selecciona un artista para consultar las opciones que puede recibir.|Selecione um artista para ver as opções que pode receber.
giftRecipientIneligible|This option cannot be sent to the selected artist.|此规格暂不适用于所选艺人。|ตัวเลือกนี้ไม่สามารถส่งให้ศิลปินที่เลือกได้|Không thể gửi lựa chọn này cho nghệ sĩ đã chọn.|この種類は選択したアーティストに贈れません。|Esta opción no se puede enviar al artista seleccionado.|Esta opção não pode ser enviada ao artista selecionado.
giftRecipientUnavailable|This artist is unavailable. Please choose another.|该艺人当前不可选，请选择其他艺人。|ศิลปินนี้ไม่พร้อม กรุณาเลือกศิลปินอื่น|Nghệ sĩ này hiện không khả dụng. Hãy chọn người khác.|このアーティストは選択できません。別の方をお選びください。|Este artista no está disponible. Elige otro.|Este artista não está disponível. Escolha outro.
giftVariant|Options|礼物规格|ตัวเลือก|Lựa chọn|種類|Opciones|Opções
giftQuantity|Quantity|数量|จำนวน|Số lượng|数量|Cantidad|Quantidade
giftQuantityDecrease|Decrease quantity|减少数量|ลดจำนวน|Giảm số lượng|数量を減らす|Reducir cantidad|Diminuir quantidade
giftQuantityIncrease|Increase quantity|增加数量|เพิ่มจำนวน|Tăng số lượng|数量を増やす|Aumentar cantidad|Aumentar quantidade
giftStockRemaining|{count, plural, one {# available} other {# available}}|当前可选 {count} 件|เลือกได้ {count} ชิ้น|Có thể chọn {count}|現在 {count} 点まで選べます|{count, plural, one {# disponible} other {# disponibles}}|{count, plural, one {# disponível} other {# disponíveis}}
giftSoldOut|Sold out|已售罄|หมดแล้ว|Đã hết|在庫切れ|Agotado|Esgotado
giftTracked|Prepared from available stock|从现货中准备|จัดเตรียมจากสินค้าที่มี|Chuẩn bị từ hàng có sẵn|在庫から手配|Preparado con existencias disponibles|Preparado a partir do estoque disponível
giftProcureOnDemand|Prepared to order|按单准备|จัดเตรียมตามคำสั่งซื้อ|Chuẩn bị theo đơn|ご注文後に手配|Preparado por encargo|Preparado sob encomenda
giftProcureBody|The studio sources or prepares this gift after payment. Existing stock is not required.|付款后由工作室采购或准备，无需预先备有现货。|สตูดิโอจัดหาหรือเตรียมของขวัญหลังชำระเงิน โดยไม่ต้องมีสินค้าล่วงหน้า|Studio tìm mua hoặc chuẩn bị quà sau khi thanh toán, không cần có sẵn hàng.|お支払い後にスタジオが調達・準備します。事前の在庫は必要ありません。|El estudio consigue o prepara el regalo tras el pago. No requiere existencias previas.|O estúdio obtém ou prepara o presente após o pagamento. Não exige estoque prévio.
giftPreorder|Preorder|预售|สั่งจองล่วงหน้า|Đặt trước|予約商品|Reserva|Pré-venda
giftPreorderBody|The studio prepares this preorder according to the published gift information.|工作室将按照已发布的礼物说明准备这份预售礼物。|สตูดิโอเตรียมของขวัญสั่งจองตามข้อมูลที่เผยแพร่|Studio chuẩn bị quà đặt trước theo thông tin đã công bố.|掲載されているギフト情報に沿ってスタジオが準備します。|El estudio prepara esta reserva según la información publicada del regalo.|O estúdio prepara esta pré-venda conforme as informações publicadas do presente.
giftCheckoutUnavailable|Checkout is being prepared|下单功能正在准备中|กำลังเตรียมระบบสั่งซื้อ|Chức năng đặt hàng đang được chuẩn bị|注文機能を準備中|Estamos preparando el proceso de compra|Estamos preparando a finalização da compra
giftCheckoutBody|You can explore gifts and options here. Ordering and private messages will be available in a later release.|目前可浏览礼物并选择规格，下单与私密留言将在后续版本开放。|ขณะนี้ดูของขวัญและตัวเลือกได้ การสั่งซื้อและข้อความส่วนตัวจะเปิดในรุ่นถัดไป|Bạn có thể xem quà và chọn tùy chọn. Đặt hàng và lời nhắn riêng sẽ có trong phiên bản sau.|ギフトの閲覧と種類の選択ができます。ご注文と非公開メッセージは今後のバージョンで公開予定です。|Puedes explorar regalos y opciones. Los pedidos y mensajes privados estarán disponibles en una próxima versión.|Pode explorar presentes e opções. Pedidos e mensagens privadas estarão disponíveis em uma próxima versão.
giftDetails|A closer look|礼物详情|รายละเอียดของขวัญ|Chi tiết quà tặng|ギフトの詳細|Más detalles|Mais detalhes
giftGallery|Gift gallery|礼物图片|รูปของขวัญ|Hình ảnh quà tặng|ギフトの写真|Imágenes del regalo|Imagens do presente
giftDelivery|Studio preparation and handover|工作室准备与转交|การเตรียมและส่งมอบโดยสตูดิโอ|Studio chuẩn bị và trao quà|スタジオでの準備・お渡し|Preparación y entrega del estudio|Preparação e entrega pelo estúdio
giftEstimate|Estimated preparation: {minimum}–{maximum} days|预计准备时间：{minimum}–{maximum} 天|เวลาจัดเตรียมโดยประมาณ: {minimum}–{maximum} วัน|Thời gian chuẩn bị dự kiến: {minimum}–{maximum} ngày|準備期間の目安：{minimum}～{maximum} 日|Preparación estimada: {minimum}–{maximum} días|Preparação estimada: {minimum}–{maximum} dias
giftPolicies|Policies and support|政策与服务|นโยบายและบริการ|Chính sách và hỗ trợ|ポリシーとサポート|Políticas y asistencia|Políticas e suporte
giftKindVirtual|Virtual gift|虚拟礼物|ของขวัญเสมือน|Quà ảo|バーチャルギフト|Regalo virtual|Presente virtual
giftKindPhysical|Physical gift|实体礼物|ของขวัญที่จับต้องได้|Quà hiện vật|実物のギフト|Regalo físico|Presente físico
giftKindWish|Wish gift|心愿礼物|ของขวัญตามความปรารถนา|Quà theo nguyện vọng|ウィッシュギフト|Regalo deseado|Presente desejado
giftKindMerchandise|Merchandise|周边礼物|สินค้าที่ระลึก|Quà lưu niệm|グッズ|Artículos de colección|Produtos colecionáveis
giftKindOther|Gift|礼物|ของขวัญ|Quà tặng|ギフト|Regalo|Presente
policyUnavailable|This policy is not available in this language yet.|该政策暂未提供此语言版本。|นโยบายนี้ยังไม่มีในภาษานี้|Chính sách này chưa có bằng ngôn ngữ này.|この言語のポリシーはまだ公開されていません。|Esta política aún no está disponible en este idioma.|Esta política ainda não está disponível neste idioma.
policyEffective|Effective {date}|生效日期：{date}|มีผลตั้งแต่ {date}|Có hiệu lực từ {date}|施行日：{date}|En vigor desde {date}|Em vigor desde {date}
policyTerms|Terms of service|服务条款|ข้อกำหนดการให้บริการ|Điều khoản dịch vụ|利用規約|Términos del servicio|Termos de serviço
policyPrivacy|Privacy|隐私政策|ความเป็นส่วนตัว|Quyền riêng tư|プライバシー|Privacidad|Privacidade
policyRefund|Refunds|退款政策|การคืนเงิน|Hoàn tiền|返金について|Reembolsos|Reembolsos
policyDelivery|Delivery|转交说明|การส่งมอบ|Trao quà|お渡しについて|Entrega|Entrega
marketChoose|Choose your market and currency|选择地区与币种|เลือกตลาดและสกุลเงิน|Chọn thị trường và tiền tệ|マーケットと通貨を選択|Elige tu mercado y moneda|Escolha seu mercado e moeda
marketChooseBody|Select an available market to see its gift prices. This does not change your language.|选择可用地区以查看相应礼物价格，此操作不会改变语言。|เลือกตลาดที่เปิดให้บริการเพื่อดูราคาของขวัญ โดยไม่เปลี่ยนภาษา|Chọn thị trường có sẵn để xem giá quà. Ngôn ngữ không thay đổi.|利用可能なマーケットを選ぶとギフト価格が表示されます。言語は変わりません。|Selecciona un mercado disponible para ver sus precios. El idioma no cambia.|Selecione um mercado disponível para ver os preços. O idioma não muda.
marketUnavailable|No markets are available right now.|目前暂无可用地区。|ขณะนี้ยังไม่มีตลาดที่เปิดให้บริการ|Hiện chưa có thị trường khả dụng.|現在利用可能なマーケットがありません。|No hay mercados disponibles ahora.|Não há mercados disponíveis no momento.
marketSelected|Selected|已选择|เลือกแล้ว|Đã chọn|選択中|Seleccionado|Selecionado
marketInvalid|This market or currency is unavailable. Please select an available combination.|该地区或币种不可用，请重新选择可用组合。|ตลาดหรือสกุลเงินนี้ไม่พร้อม กรุณาเลือกคู่ที่ใช้ได้|Thị trường hoặc tiền tệ này không khả dụng. Hãy chọn tổ hợp có sẵn.|このマーケットと通貨の組み合わせは利用できません。選び直してください。|Este mercado o moneda no está disponible. Elige una combinación disponible.|Este mercado ou moeda não está disponível. Escolha uma combinação disponível.'''
locales = ['en','zh-CN','th','vi','ja','es','pt']
# Keep the source-owned canonical locale registry untouched; write the existing per-locale modules.
additions = [dict() for _ in locales]
for row in rows.splitlines():
    parts = row.split('|')
    assert len(parts)==8, parts
    for index,value in enumerate(parts[1:]): additions[index][parts[0]]=value
additions[1]['giftPriceMaximum']='最高价格'
for locale,values in zip(locales,additions):
    path = Path('packages/i18n/src/storefront') / f'{locale}.ts'
    text = path.read_text()
    suffix = ''.join('  '+key+': '+json.dumps(value, ensure_ascii=False)+',\n' for key,value in values.items())
    path.write_text(text.replace('} as const;',suffix+'} as const;'))
print('Added',len(additions[0]),'keys to each existing locale catalog')
