import { operationsMaterialSections } from "./storefront-operations-uat-material-view.mjs";

export const operationsPage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地运营验收操作卡</title><link rel="stylesheet" href="/style.css"><script src="/client.js" defer></script></head>
<body><main><p class="eyebrow">LOCAL TEST · 真人操作 · 尚未验收</p><h1>运营操作验收</h1>
<p>准备完成不代表验收通过。接受过一次培训的非开发运营人员亲自操作；开始后不得执行代码、终端命令或部署。独立审核人使用审核窗口。切换同一人的角色不构成独立人工审核。</p>
<nav aria-label="切换现有角色窗口"><button data-role="editor">打开编辑窗口</button><button data-role="reviewer">打开独立审核窗口</button><button data-role="manager">打开发布／价格窗口</button></nav>
<section><h2>1. 开始前</h2><p>先阅读下方材料，确认三个窗口可用。示例文案仅供本地 TEST，不是已通过人工审核的正式七语内容。每项只能有一个计时中的尝试。</p>
<label>匿名操作员代号 <input id="operator" maxlength="24" pattern="[A-Z0-9_-]+" placeholder="OP1" autocomplete="off"></label>
<label><input id="trained" type="checkbox"> 已完成一次培训</label><label><input id="nondeveloper" type="checkbox"> 我是实际参加验收的非开发人员</label></section>
<section><h2>2. 操作卡与计时</h2>
<article><h3>首页换海报及预览 · 3 分钟</h3><ol><li>点击开始后，在编辑窗口打开首页当前版本；修改后使用“保存新版本”，系统会自动保留旧版并生成新草稿。</li><li>将 hero 桌面及移动图片换为下方“替换素材”对应的 READY 资源，保留原艺人引用，保存。</li><li>按现有审核流程完成需要的审核，在预览中实际确认双端图片已更换。只有看到预览结果后点击结束。</li></ol><button data-start="homepage">开始首页任务</button></article>
<article><h3>艺人照片与简介 · 5 分钟</h3><ol><li>点击开始后，在编辑窗口打开 Luna Mira 当前草稿，替换 portrait 资源。</li><li>英文文案严格使用材料中的全部 IDOL 字段；保存、导出真实翻译包。</li><li>使用下方文件工具装入七语材料，再在 Admin 正常导入并校验；独立审核人审核，实际预览照片及七语简介后结束。</li></ol><button data-start="idol">开始艺人任务</button></article>
<article><h3>完整礼物上架 · 8 分钟</h3><p><strong>结构、规格、资格、价格的 UI 录入，以及翻译包导出／整理／导入、审核、验证、预览和发布全部计时；准备阶段没有创建这个礼物。</strong></p><ol><li>点击开始后，用编辑窗口“新建礼物”，填写下方 handle；先不编辑礼物类型或正文。</li><li>在“规格”中点击“新增规格”：填写材料中的 SKU，销售库存策略选“按单准备/采购 · 可重复售卖”，适用艺人选择 Luna Mira；先用“保存规格”保存草稿，再选中该规格，将状态改为“已启用”并保存。此策略不录入虚构库存。</li><li>规格保存完成后，礼物类型选“实体礼物”，选择已准备的 GIFT_PRIMARY 主图，按材料核对结构并填入英文 GIFT 全部字段及唯一规格名称，点击“保存新版本”。导出真实翻译包，用下方工具装入七语，再由 Admin 导入校验。</li><li>独立审核窗口完成各语言审核；发布／价格窗口录入材料指定的市场、币种与 10.00 示例价格（以界面单位为准），发布价格簿，并在实际价格簿表格确认币种和 10.00 金额。</li><li>点击“检查发布条件”，按结果处理；实际打开“桌面预览”和“手机预览”检查图片／七语／规格，再点击“发布”（控件内部完成验证与发布）。首次成功发布会启用新礼物；确认发布成功及“已启用”状态后结束。被权限、字段或质量问题阻断时记录阻断，不跳过门禁。</li></ol><button data-start="gift">开始礼物任务</button></article>
<div class="finish"><label>结束结果 <select id="result"><option value="REPORTED_COMPLETE">我报告已完成</option><option value="BLOCKED">实际被阻断</option></select></label><label>协助情况 <select id="assistance"><option value="NONE">无协助</option><option value="INDEPENDENT_REVIEW">仅独立审核</option><option value="COACHING">有教练／开发协助</option></select></label><button id="finish">结束当前任务</button></div><p id="notice" role="status" aria-live="polite"></p><pre id="state" aria-label="实际计时记录"></pre></section>
<section><h2>3. 实际准备的材料</h2><p>资源 ID 是本次运行真实处理并审核的媒体；字段右侧可复制。价格和市场为隔离 TEST 配置。材料中没有密码、会话或预览令牌。</p><nav aria-label="材料分类"><a href="#material-group-0">替换素材</a><a href="#material-group-1">艺人英文</a><a href="#material-group-2">礼物英文与规格／价格</a></nav><div id="materials"></div><details id="material-audit"><summary>完整材料与审计字段（用于核对）</summary><p>包含全部七语、资源 ID、版本及审核核对字段。日常填写使用上方分组；七语导入使用下方文件工具。</p><a href="/materials.json" download="operations-materials.json">下载本轮完整材料</a><pre id="raw-materials"></pre></details></section>
<section><h2>4. 七语文件整理</h2><p>只接受刚从 Admin 导出的当前目标 JSON。英文必须与材料一致；工具仅填充七语文本，保留目标、版本、源 hash 和导出凭据。下载后仍须在 Admin 导入、验证、审核。该动作在相关任务计时之内。</p><form id="binder"><label>内容 <select id="kind"><option value="gift">礼物</option><option value="idol">艺人</option></select></label><label>真实导出文件 <input id="packet" type="file" accept="application/json,.json" required></label><button>生成本目标七语文件</button></form><p id="binding" role="status"></p></section>
<footer>此页只记录真人点击、耗时与允许的正常 API 结果。所有尝试始终等待独立人工复核；本地 TEST 准备、程序计时或自动测试均不等于生产登录、正式翻译审核或运营 UAT 通过。</footer></main></body></html>`;

export const operationsStyle = `:root{font-family:system-ui,sans-serif;color:#e7e5e1;background:#111315;color-scheme:dark}*{box-sizing:border-box}body{margin:0}main{max-width:1000px;margin:auto;padding:40px 24px}h1{font-size:38px}h2{font-size:24px}p,li{line-height:1.75}section,article{border:1px solid #414448;border-radius:12px;padding:24px;margin:24px 0}article{background:#1c1f22}.eyebrow{letter-spacing:.1em;color:#d7c39f}nav,.finish{display:flex;gap:12px;flex-wrap:wrap}button,input,select{font:inherit;border:1px solid #a3a3a3;border-radius:6px;padding:10px;background:#25292d;color:#fff}button{cursor:pointer}button:hover{background:#3a3d40}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #ebcc8d;outline-offset:3px}button:disabled{opacity:.5;cursor:default}label{display:block;margin:12px 0}input[type=checkbox]{margin-right:8px}a{color:#e8cb98}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;max-height:440px;overflow:auto}.material{padding:12px;border-bottom:1px solid #424549;display:grid;grid-template-columns:minmax(160px,1fr) minmax(0,3fr) auto;gap:12px;align-items:center}.material code{overflow-wrap:anywhere;white-space:pre-wrap}footer{color:#c3c6c7;line-height:1.7}#notice,#binding{min-height:1.8em;color:#e8cb98}@media(max-width:600px){main{padding:20px 14px}section,article{padding:16px}.material{grid-template-columns:1fr}.finish{display:block}}`;

export const operationsClient = `"use strict";
const materialSections = ${operationsMaterialSections.toString()};
const element = (id) => document.getElementById(id);
let state;
async function post(path, body) {
  const response = await fetch(path, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body)});
  const value = await response.json();
  if (!response.ok) throw new Error("操作未完成。请核对当前状态与操作卡；没有记录验收通过。");
  return value;
}
function render(next) {
  state = next;
  element("state").textContent = JSON.stringify(next, null, 2);
  const active = next.attempts.find((attempt) => attempt.status === "IN_PROGRESS");
  document.querySelectorAll("[data-start]").forEach((button) => { button.disabled = Boolean(active); });
  element("finish").disabled = !active;
}
async function act(operation) {
  try { await operation(); element("notice").textContent = "操作已记录；仍待独立人工复核。"; }
  catch (error) { element("notice").textContent = error.message; }
}
document.querySelectorAll("[data-role]").forEach((button) => button.addEventListener("click", () => act(() => post("/focus", {role: button.dataset.role}))));
document.querySelectorAll("[data-start]").forEach((button) => button.addEventListener("click", () => act(async () => render(await post("/timer", {schemaVersion: 1, action: "START", caseId: button.dataset.start, operatorCode: element("operator").value, trained: element("trained").checked, nonDeveloper: element("nondeveloper").checked})))));
element("finish").addEventListener("click", () => act(async () => {
  const active = state?.attempts.find((attempt) => attempt.status === "IN_PROGRESS");
  if (!active) return;
  render(await post("/timer", {schemaVersion: 1, action: "FINISH", caseId: active.caseId, result: element("result").value, assistance: element("assistance").value}));
}));
function material(container, label, value) {
  const row = document.createElement("div"); row.className = "material";
  const name = document.createElement("span"); name.textContent = label;
  const code = document.createElement("code"); code.textContent = String(value);
  const copy = document.createElement("button"); copy.textContent = "复制"; copy.setAttribute("aria-label", "复制 " + label);
  copy.addEventListener("click", () => act(() => navigator.clipboard.writeText(String(value))));
  row.append(name, code, copy); container.append(row);
}
function showMaterials(value) {
  materialSections(value).forEach((section, index) => {
    const group = document.createElement("article"); group.id = "material-group-" + index;
    const title = document.createElement("h3"); title.textContent = section.title;
    const hint = document.createElement("p"); hint.textContent = section.hint;
    group.append(title, hint);
    section.rows.forEach((row) => material(group, row.label, row.value));
    element("materials").append(group);
  });
  element("raw-materials").textContent = JSON.stringify(value, null, 2);
}
element("binder").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const file = element("packet").files[0];
    if (!file || file.size > 16 * 1024 * 1024) throw new Error("请选择有效的 Admin 导出文件。");
    const packet = JSON.parse(await file.text());
    const bound = await post("/bind", {kind: element("kind").value, packet});
    const url = URL.createObjectURL(new Blob([JSON.stringify(bound, null, 2)], {type: "application/json"}));
    const link = document.createElement("a"); link.href = url; link.download = "uat-translations.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    element("binding").textContent = "文件已生成。继续到 Admin 导入、验证、独立审核；计时没有暂停。";
  } catch { element("binding").textContent = "文件未生成：请使用本目标刚导出的七语包，确认英文与材料完全相同、礼物只有一个规格。"; }
});
Promise.all([fetch("/state").then((r) => r.json()).then(render), fetch("/materials.json").then((r) => r.json()).then(showMaterials)]).catch(() => { element("notice").textContent = "本地准备服务不可用，请停止验收并记录阻断。"; });
`;
