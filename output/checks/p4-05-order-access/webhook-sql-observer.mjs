import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const require = createRequire(
  path.join(workspaceRoot, "packages/persistence-postgres/package.json"),
);
const { Client } = require("pg");
const original = Client.prototype.query;
function safeTag(input) {
  const sql = typeof input === "string" ? input : input?.text;
  if (typeof sql !== "string") return null;
  return /\/\* (reliable-event:[a-z-]+) \*\//u.exec(sql)?.[1] ?? null;
}
function errorNotice(tag, error) {
  console.log(
    JSON.stringify({
      observer: "UNCHANGED_WEBHOOK_SQL",
      statement: tag ?? "UNLABELLED",
      outcome: "ERROR",
      sqlState: /^[0-9A-Z]{5}$/u.test(error?.code ?? "") ? error.code : null,
      retentionConstraint:
        error?.constraint === "webhook_payloads_retention_check",
    }),
  );
}
Client.prototype.query = function (...args) {
  const tag = safeTag(args[0]);
  let result;
  try {
    result = original.apply(this, args);
  } catch (error) {
    errorNotice(tag, error);
    throw error;
  }
  if (!result || typeof result.then !== "function") return result;
  return result.then(
    (value) => {
      if (tag)
        console.log(
          JSON.stringify({
            observer: "UNCHANGED_WEBHOOK_SQL",
            statement: tag,
            outcome: "SUCCESS",
            rowCount: Number.isInteger(value?.rowCount) ? value.rowCount : null,
          }),
        );
      return value;
    },
    (error) => {
      errorNotice(tag, error);
      throw error;
    },
  );
};
