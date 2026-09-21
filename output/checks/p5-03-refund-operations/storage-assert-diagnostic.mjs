import assert from "node:assert/strict";
function debug(error) {
  if (error?.name === "AssertionError")
    console.error(
      "SAFE_ASSERTION",
      JSON.stringify({
        code: error.code,
        operator: error.operator,
        message: error.message?.split("\n")[0],
        actual:
          typeof error.actual === "string" && /^[A-Z_]+$/.test(error.actual)
            ? error.actual
            : typeof error.actual === "number"
              ? error.actual
              : undefined,
        expected:
          typeof error.expected === "string" && /^[A-Z_]+$/.test(error.expected)
            ? error.expected
            : typeof error.expected === "number"
              ? error.expected
              : undefined,
        frames: error.stack
          ?.split("\n")
          .filter((x) => x.includes("scripts/") || x.includes("storage-assert"))
          .slice(0, 7),
      }),
    );
  throw error;
}
for (const name of ["equal", "strictEqual", "ok", "rejects"]) {
  const original = assert[name];
  assert[name] = function (...args) {
    try {
      const result = original.apply(this, args);
      return result?.catch ? result.catch(debug) : result;
    } catch (error) {
      return debug(error);
    }
  };
}
