// Rolled-back writes report only SQLSTATE, trigger function and constraint names.
const name = (value) =>
  /^[a-z_][a-z_0-9]{0,127}$/u.test(value ?? "") ? value : null;
const sqlState = (value) => (/^[A-Z0-9]{5}$/u.test(value ?? "") ? value : null);

/** Patches one pg Client class in this process; every pool client inherits it. */
export function reportPostgresFailures(Client, write) {
  const query = Client.prototype.query;
  Client.prototype.query = function (...args) {
    const result = query.apply(this, args);
    if (!result?.catch) return result;
    return result.catch((error) => {
      write(
        JSON.stringify({
          postgresFailure: {
            code: sqlState(error?.code),
            guard: name(
              /PL\/pgSQL function ([a-z_][a-z_0-9]{0,127})\(/u.exec(
                error?.where ?? "",
              )?.[1],
            ),
            constraint: name(error?.constraint),
          },
        }) + "\n",
      );
      throw error;
    });
  };
}

/** Counts the failure lines of a supervisor log, re-checking every field. */
export function summarizePostgresFailures(text) {
  const counts = new Map();
  for (const line of text.split("\n")) {
    let failure;
    try {
      failure = JSON.parse(line)?.postgresFailure;
    } catch {
      continue;
    }
    if (!failure || typeof failure !== "object") continue;
    const entry = {
      code: sqlState(failure.code),
      guard: name(failure.guard),
      constraint: name(failure.constraint),
    };
    const key = JSON.stringify(entry);
    counts.set(key, { ...entry, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count);
}
