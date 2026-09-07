import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { SUPPORTED_LOCALES } from '../../../packages/contracts/dist/index.js';
import { loadStorefrontCopy } from '../../../packages/i18n/dist/storefront/messages.js';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceHash = hash(await loadStorefrontCopy('en'));
for (const locale of SUPPORTED_LOCALES) {
  const path = `packages/i18n/src/storefront/${locale}.review.ts`;
  const content = await readFile(path, 'utf8');
  if (!content.includes('status: "DRAFT"')) throw new Error('Never replace actual human approval');
  await writeFile(path, content.replace(/sourceHash:\s*"[a-f0-9]{64}"/u, `sourceHash: "${sourceHash}"`).replace(/translationHash:\s*"[a-f0-9]{64}"/u, `translationHash: "${hash(await loadStorefrontCopy(locale))}"`));
}
