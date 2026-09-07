/** Pure presentation of unchanged prepared data. Also embedded as a function literal in the guide client. */
export function operationsMaterialSections(materials) {
  const english = materials.texts.find((item) => item.locale === "en");
  if (!english?.idol?.fields || !english.giftFieldsToEnter)
    throw new Error("PREPARED_ENGLISH_REQUIRED");
  const fields = (source, labels) =>
    Object.entries(labels).map(([key, label]) => ({
      label,
      value: source[key],
    }));
  const gift = materials.measuredGift;
  const names = {
    PHYSICAL: "实体礼物",
    VIRTUAL: "虚拟礼物",
    WISH: "心愿礼物",
    MERCHANDISE: "周边礼物",
    OTHER: "其他",
    PROCURE_ON_DEMAND: "按单准备/采购 · 可重复售卖",
    TRACKED: "限量现货",
    PREORDER: "预售",
    DAY: "天",
    WEEK: "周",
    ITEM: "件",
    GRAM: "克",
    MILLILITER: "毫升",
  };
  return [
    {
      title: "替换素材",
      hint: "复制素材名称，在后台媒体选择器中查找并选择对应的已准备资源。资源 ID 和审核记录保留在下方完整材料中。",
      rows: Object.entries({
        HERO_DESKTOP: "首页海报（桌面）",
        HERO_MOBILE: "首页海报（手机）",
        PORTRAIT: "艺人照片",
        GIFT_PRIMARY: "礼物主图",
      }).map(([role, label]) => ({
        label,
        value: materials.replacementMedia[role].label,
      })),
    },
    {
      title: "艺人英文",
      hint: "后台界面可以保持中文；将“内容语言”切换为英语，按下列字段原样复制。其余六种译文用七语文件工具整理。",
      rows: [
        { label: "待编辑艺人", value: materials.baseline.idol.label },
        { label: "艺人网址标识", value: materials.baseline.idol.handle },
        ...fields(english.idol.fields, {
          displayName: "艺人名称",
          shortBio: "简介",
          fullBio: "详细介绍",
          seoTitle: "搜索标题",
          seoDescription: "搜索描述",
        }),
      ],
    },
    {
      title: "礼物英文与规格／价格",
      hint: "从新建礼物开始，先保存唯一规格，再填写类型、图片和英文。以下是本轮实际任务材料；价格在价格簿表格核对。",
      rows: [
        { label: "新礼物网址标识", value: gift.handle },
        { label: "SKU", value: gift.sku },
        {
          label: "销售库存策略",
          value: names[gift.inventoryPolicy] ?? gift.inventoryPolicy,
        },
        { label: "适用艺人", value: gift.eligibleIdolLabel },
        { label: "规格名称（英文）", value: english.variantLabel },
        { label: "礼物类型", value: names[gift.type] ?? gift.type },
        ...fields(english.giftFieldsToEnter, {
          title: "标题",
          shortDescription: "简短描述",
          description: "详细描述",
          fulfillmentDescription: "准备与交付说明",
          seoTitle: "搜索标题",
          seoDescription: "搜索描述",
        }),
        { label: "内容品类", value: names[gift.category] ?? gift.category },
        ...gift.contents.flatMap((item, index) => [
          { label: `组成项 ${index + 1} 代码`, value: item.componentCode },
          { label: `组成项 ${index + 1} 数量`, value: String(item.quantity) },
          {
            label: `组成项 ${index + 1} 单位`,
            value: names[item.unit] ?? item.unit,
          },
        ]),
        { label: "最早交付", value: String(gift.deliveryEstimate.minimum) },
        { label: "最晚交付", value: String(gift.deliveryEstimate.maximum) },
        {
          label: "交付时间单位",
          value:
            names[gift.deliveryEstimate.unit] ?? gift.deliveryEstimate.unit,
        },
        { label: "市场", value: gift.market },
        { label: "币种", value: gift.currency },
        { label: `金额（${gift.currency}）`, value: gift.amountInUi },
        {
          label: "价格生效时间",
          value: "在后台选择当前或更早的时间；失效时间留空。",
        },
      ],
    },
  ];
}
