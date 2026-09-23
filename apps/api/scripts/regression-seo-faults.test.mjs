import assert from "node:assert/strict";
import test from "node:test";
import { createRegressionSeoFaults } from "./regression-seo-faults.mjs";
const sql =
  "SELECT to_jsonb(t.*) AS translation,to_jsonb(r.*) AS review,to_jsonb(e.*) AS evidence FROM public.idol_revision_translations t WHERE t.idol_revision_id=$1 ORDER BY t.locale FOR SHARE OF t";
const row = (locale) => ({
  translation: { id: locale, locale, display_name: locale },
  review: { id: `${locale}-review` },
  evidence: null,
});
const result = { rows: [row("en"), row("ja"), row("th")], rowCount: 3 };
test("SQL leaf absence removes only the owned revision/locale pair without changing driver rows", () => {
  const faults = createRegressionSeoFaults();
  faults.set({
    kind: "IDOL",
    revisionId: "revision",
    locale: "ja",
    mode: "MISSING",
  });
  assert.equal(faults.transform(sql, ["other"], result), result);
  assert.equal(
    faults.transform(sql.replace("SHARE", "UPDATE"), ["revision"], result),
    result,
  );
  assert.deepEqual(
    faults
      .transform(sql, ["revision"], result)
      .rows.map((entry) => entry.translation.locale),
    ["en", "th"],
  );
  assert.equal(result.rows.length, 3);
  assert.equal(faults.events()[0].affectedRows, 1);
  faults.clear();
  assert.equal(faults.transform(sql, ["revision"], result), result);
});
test("copy evidence inner join projects only the same missing target translation", () => {
  const faults = createRegressionSeoFaults();
  faults.set({
    kind: "IDOL",
    revisionId: "revision",
    locale: "ja",
    mode: "MISSING",
  });
  faults.transform(sql, ["revision"], result);
  const rows = [
    { evidence: { target_translation_id: "ja" } },
    { evidence: { target_translation_id: "en" } },
  ];
  const query =
    "SELECT to_jsonb(e.*) AS evidence FROM public.idol_translation_copy_evidence e JOIN public.idol_revision_translations t ON t.id=e.target_translation_id WHERE t.idol_revision_id=$1 ORDER BY t.locale";
  assert.deepEqual(
    faults.transform(query, ["revision"], { rows, rowCount: 2 }).rows,
    [rows[1]],
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(
    faults.transform(query, ["revision"], { rows, rowCount: 2 }, new Set())
      .rows,
    rows,
    "another transaction cannot inherit a read fault's missing ids",
  );
});
for (const mode of ["REVIEW_MISSING", "TAMPER", "DUPLICATE", "SQL_ERROR"])
  test(`fault ${mode} stays confined to the real SQL leaf result`, () => {
    const faults = createRegressionSeoFaults();
    faults.set({ kind: "IDOL", revisionId: "revision", locale: "ja", mode });
    if (mode === "SQL_ERROR")
      assert.throws(() => faults.transform(sql, ["revision"], result));
    else {
      const changed = faults.transform(sql, ["revision"], result);
      if (mode === "REVIEW_MISSING") assert.equal(changed.rows[1].review, null);
      if (mode === "TAMPER")
        assert.equal(
          changed.rows[1].translation.display_name,
          "UNTRUSTED_TRANSLATION_CANARY",
        );
      if (mode === "DUPLICATE") assert.equal(changed.rows.length, 4);
      assert.equal(result.rows[1].translation.display_name, "ja");
      assert.notEqual(result.rows[1].review, null);
    }
  });
