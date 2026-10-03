/** Immutable email projection of design-tokens v1. Inline values support email clients.
 * Do not replace with live tokens: historical retries must retain their original bytes. */
export const rendererVersionV2 = "order-notification-renderer.v2";
export const summaryItemLimitV2 = 10;
export const htmlTemplateV2 = `<!doctype html>
<html lang="[[LANG]]"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>[[SUBJECT]]</title>
<style>body{margin:0}a:focus-visible{outline:3px solid #f6f3ee;outline-offset:4px}@media(max-width:480px){.email-inner{padding:32px 20px!important}.email-title{font-size:30px!important}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}</style></head>
<body style="margin:0;background:#0a0a0c;color:#f6f3ee;font-family:Arial,Helvetica,sans-serif;line-height:1.6">
<div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;mso-hide:all">[[PREHEADER]]</div>
<table role="presentation" style="width:100%;border-collapse:collapse;background:#0a0a0c"><tr><td align="center" style="padding:24px 0">
<table role="presentation" style="width:100%;max-width:640px;border-collapse:collapse"><tr><td class="email-inner" style="padding:48px 32px">
<main><div style="color:#d8b26e;font-size:16px;letter-spacing:0.08em;font-weight:700;overflow-wrap:anywhere">[[SITE_NAME]]</div>
<h1 class="email-title" style="font-size:36px;font-weight:600;line-height:1.25;letter-spacing:-0.025em;margin:32px 0 16px;overflow-wrap:anywhere">[[HEADING]]</h1>
<p style="font-size:16px;color:#aaa6a0;margin:0 0 32px">[[BODY]]</p>[[NOTE]]
<section aria-label="[[ORDER_LABEL]]" style="border-top:1px solid #303033;padding:24px 0">
<div style="font-size:13px;color:#aaa6a0">[[ORDER_LABEL]]</div>
<div data-mail-order style="font-size:14px;overflow-wrap:anywhere;margin:4px 0 16px">[[ORDER_ID]]</div>
<div style="font-size:13px;color:#aaa6a0">[[ORDERED_AT_LABEL]]</div><time datetime="[[ORDERED_AT_ISO]]" style="font-size:14px">[[ORDERED_AT]]</time></section>
<section aria-label="[[ITEMS_LABEL]]"><h2 style="font-size:18px;font-weight:600;margin:8px 0">[[ITEMS_LABEL]]</h2>[[ITEMS]][[SUMMARY]]</section>
<table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #303033;margin-top:8px"><tr><td style="padding:24px 12px 24px 0;font-size:16px">[[TOTAL_LABEL]]</td><td data-mail-total style="padding:24px 0;text-align:right;font-size:22px;font-weight:600;white-space:nowrap">[[TOTAL]]</td></tr></table>
<a data-mail-link href="[[ORDER_URL]]" style="display:block;background:#d8b26e;color:#0a0a0c;text-align:center;text-decoration:none;padding:16px 20px;font-size:16px;font-weight:700;line-height:1.5;border-radius:12px">[[VIEW_ORDER]]</a>
<p style="font-size:13px;color:#aaa6a0;margin:20px 0 0">[[SECURITY]]</p>
<p style="font-size:12px;color:#aaa6a0;margin:16px 0 0">[[SOURCE_NOTE]]</p>
</main></td></tr></table></td></tr></table></body></html>`;

export const itemTemplateV2 = `<div data-mail-item style="padding:16px 0;border-bottom:1px solid #303033;overflow-wrap:anywhere"><div lang="[[IDOL_LOCALE]]" style="font-size:13px;color:#d8b26e">[[IDOL_NAME]]</div><div lang="[[GIFT_LOCALE]]" style="font-size:17px;font-weight:600;margin-top:4px">[[GIFT_NAME]]</div>[[VARIANT]][[KIND]]<div style="font-size:14px;color:#aaa6a0;margin-top:8px">[[QUANTITY]]</div><div style="font-size:16px;margin-top:4px">[[AMOUNT]]</div></div>`;
export const variantTemplateV2 = `<div lang="[[VARIANT_LOCALE]]" style="font-size:14px;color:#aaa6a0;margin-top:4px">[[VARIANT_NAME]]</div>`;
export const digitalItemTemplateV2 = `<div data-mail-digital style="font-size:13px;color:#d8b26e;margin-top:4px">[[DIGITAL_ITEM]]</div>`;
export const digitalNoteTemplateV2 = `<p data-mail-digital-note style="font-size:15px;color:#f6f3ee;margin:-16px 0 32px">[[DIGITAL_NOTE]]</p>`;
export const summaryTemplateV2 = `<p data-mail-summary style="font-size:14px;color:#aaa6a0;margin:16px 0">[[SUMMARY_TEXT]]</p>`;
export const textTemplateV2 = `[[SITE_NAME]]

[[HEADING]]
[[BODY]]
[[NOTE]]
[[ORDER_LABEL]]: [[ORDER_ID]]
[[ORDERED_AT_LABEL]]: [[ORDERED_AT]]

[[ITEMS_LABEL]]
[[ITEMS]]
[[SUMMARY]]

[[TOTAL_LABEL]]: [[TOTAL]]

[[VIEW_ORDER]]
[[ORDER_URL]]

[[SECURITY]]
[[SOURCE_NOTE]]`;
