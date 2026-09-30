import { appendFileSync, renameSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { structuredLogRecordSchema } from "@fan-support/observability";

const MAX_LINE = 4096;

/**
 * Next output may contain order links, tokens or request data. Only lines that are exactly a
 * structured log record survive, re-serialized from the parsed fields; everything else is dropped.
 */
export function structuredEventLine(line) {
  if (line.length === 0 || line.length > MAX_LINE || line[0] !== "{")
    return null;
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = structuredLogRecordSchema.safeParse(value);
  return parsed.success ? JSON.stringify(parsed.data) : null;
}

/** A private, size-bounded log of the compiled web servers' structured events (one rotation). */
export function createWebEventLog({ file, maxBytes = 4 * 1024 * 1024 }) {
  const size = () => {
    try {
      return statSync(file).size;
    } catch (error) {
      if (error.code === "ENOENT") return 0;
      throw error;
    }
  };
  const write = (line) => {
    const text = structuredEventLine(line);
    if (text === null) return;
    try {
      if (size() + text.length + 1 > maxBytes) renameSync(file, `${file}.1`);
      appendFileSync(file, text + "\n", { mode: 0o600 });
    } catch {
      /* The event log is diagnostics only; it must never stop a web server. */
    }
  };
  return {
    attach(stream) {
      createInterface({ input: stream, crlfDelay: Infinity }).on("line", write);
    },
  };
}
