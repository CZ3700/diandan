import assert from "node:assert/strict";
import { test } from "node:test";
import { Script } from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  operationsClient,
  operationsPage,
} from "./storefront-operations-uat-page.mjs";
import * as contract from "@fan-support/contracts";
import {
  createOperationsRecorder,
  safeOperationEvidence,
  bindOperationsTranslations,
  operationsText,
} from "./storefront-operations-uat-model.mjs";

test("human timing never pre-approves a case and does not run business operations", () => {
  let now = 0;
  const recorder = createOperationsRecorder({
    now: () => now,
    utc: () => "2026-09-07T00:00:00.000Z",
  });
  assert.deepEqual(recorder.snapshot().attempts, []);
  assert.throws(() =>
    recorder.command({
      schemaVersion: 1,
      action: "START",
      caseId: "homepage",
      operatorCode: "OP1",
      trained: true,
      nonDeveloper: false,
    }),
  );
  recorder.command({
    schemaVersion: 1,
    action: "START",
    caseId: "homepage",
    operatorCode: "OP1",
    trained: true,
    nonDeveloper: true,
  });
  assert.throws(() =>
    recorder.command({
      schemaVersion: 1,
      action: "START",
      caseId: "gift",
      operatorCode: "OP1",
      trained: true,
      nonDeveloper: true,
    }),
  );
  now = 181_000;
  recorder.command({
    schemaVersion: 1,
    action: "FINISH",
    caseId: "homepage",
    result: "REPORTED_COMPLETE",
    assistance: "NONE",
  });
  const [attempt] = recorder.snapshot().attempts;
  assert.equal(attempt.durationMs, 181_000);
  assert.equal(attempt.reportedWithinBudget, false);
  assert.equal(attempt.status, "AWAITING_HUMAN_REVIEW");
  assert.equal(attempt.humanVerified, false);
  assert.throws(() =>
    recorder.command({
      schemaVersion: 1,
      action: "FINISH",
      caseId: "homepage",
      result: "REPORTED_COMPLETE",
      assistance: "NONE",
    }),
  );
});
test("evidence is an explicit allowlist and cannot preserve capabilities or request bodies", () => {
  const value = safeOperationEvidence(
    "manager",
    "/api/admin/publication-publish",
    200,
    {
      outcome: "SUCCESS",
      publicationId: "83000000-0000-4000-8000-000000000001",
      csrfToken: "PRIVATE",
      token: "PRIVATE",
      body: "PRIVATE",
      url: "https://signed.test/?PRIVATE",
    },
  );
  assert.ok(value);
  assert.ok(!JSON.stringify(value).includes("PRIVATE"));
  assert.equal(
    safeOperationEvidence("editor", "/api/admin/session", 200, {}),
    undefined,
  );
  assert.equal(
    safeOperationEvidence(
      "editor",
      "/api/admin/preview-issue?token=PRIVATE",
      200,
      {},
    ),
    undefined,
  );
});
const id = "83000000-0000-4000-8000-000000000001";
function packet() {
  const english = operationsText("gift", "en", [id]);
  return contract.translationTransferPackageSchema.parse({
    schemaVersion: 1,
    packageId: id,
    target: { owner: { kind: "GIFT", giftId: id }, revisionId: id },
    authoringHeadVersion: 1,
    sourceSnapshotHash: "a".repeat(64),
    english: { sourceHash: "b".repeat(64), text: english },
    entries: contract.SUPPORTED_LOCALES.map((locale) => ({
      locale,
      text: locale === "en" ? english : null,
    })),
    constraints: [],
    exportedAt: "2026-09-07T00:00:00.000Z",
  });
}
test("target-bound material preparation changes translations only; real Admin import remains mandatory", () => {
  const before = packet();
  const bound = bindOperationsTranslations(before, "gift");
  const metadata = (value) =>
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "entries"),
    );
  assert.deepEqual(metadata(bound), metadata(before));
  assert.deepEqual(
    bound.entries.map(({ locale }) => locale),
    contract.SUPPORTED_LOCALES,
  );
  assert.ok(bound.entries.every(({ text }) => text !== null));
  assert.notDeepEqual(bound.entries, before.entries);
  assert.throws(
    () => bindOperationsTranslations(bound, "gift"),
    /NO_TRANSLATION_CHANGE/,
  );
  const wrong = globalThis.structuredClone(before);
  wrong.english.text.fields.title = "Unrelated private gift";
  assert.throws(
    () => bindOperationsTranslations(wrong, "gift"),
    /ENGLISH_MISMATCH/,
  );
  assert.throws(() => bindOperationsTranslations(before, "idol"));
});

test("help does not require runtime configuration and the unexecuted browser client parses", () => {
  const output = execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new globalThis.URL("./storefront-operations-uat.mjs", import.meta.url),
      ),
      "--help",
    ],
    { encoding: "utf8", env: { PATH: process.env.PATH } },
  );
  assert.match(output, /no automated human acceptance/u);
  assert.doesNotMatch(output, /LOCAL_OPERATIONS_UAT_READY/u);
  assert.doesNotThrow(() => new Script(operationsClient));
});

test("operation cards follow actual Admin controls and create prerequisites", () => {
  const giftCard = operationsPage
    .split("<h3>完整礼物上架")[1]
    .split("</article>")[0];
  assert.doesNotMatch(operationsPage, /复制为新草稿|将礼物状态改为 active/u);
  assert.match(operationsPage, /保存新版本/u);
  assert.match(giftCard, /先不编辑礼物类型或正文/u);
  assert.ok(giftCard.indexOf("新增规格") < giftCard.indexOf("类型选"));
  assert.match(giftCard, /检查发布条件/u);
  assert.match(giftCard, /首次成功发布会启用新礼物/u);
  assert.match(giftCard, /价格簿表格确认币种和 10.00/u);
  assert.match(
    operationsPage,
    /<details id="material-audit"><summary>完整材料与审计字段/u,
  );
  assert.doesNotMatch(
    operationsPage,
    /<details[^>]*id="material-audit"[^>]*open/u,
  );
  assert.match(operationsPage, /download="operations-materials.json"/u);
});

test("each case measures its own budget and permits a preserved second attempt", () => {
  let time = 1000;
  const recorder = createOperationsRecorder({ now: () => time });
  for (const [caseId, duration] of [
    ["idol", 300000],
    ["gift", 480001],
  ]) {
    recorder.command({
      schemaVersion: 1,
      action: "START",
      caseId,
      operatorCode: "OP2",
      trained: true,
      nonDeveloper: true,
    });
    time += duration;
    recorder.command({
      schemaVersion: 1,
      action: "FINISH",
      caseId,
      result: "REPORTED_COMPLETE",
      assistance: "INDEPENDENT_REVIEW",
    });
  }
  assert.deepEqual(
    recorder
      .snapshot()
      .attempts.map(({ reportedWithinBudget }) => reportedWithinBudget),
    [true, false],
  );
  assert.equal(recorder.snapshot().humanOperationsAcceptance, false);
});
