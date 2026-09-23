import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
const root = process.cwd();
const input = path.join(root, "apps/api/scripts/gift-storefront-http.mjs");
const directory = path.join(
  root,
  "output/checks/p3-06-ui-alignment/isolated-gift-storefront",
);
await mkdir(directory, { recursive: true });
const source = await readFile(input, "utf8");
const original = '"output/playwright/p3-05-gift-storefront"';
if (source.split(original).length !== 2)
  throw new Error("Unexpected original harness output declaration");
// Only the evidence output changes. All fixture assertions, budgets and startup stay original.
const candidate = source.replace(
  original,
  '"output/checks/p3-06-ui-alignment/isolated-gift-storefront"',
);
const temporary = path.join(
  path.dirname(input),
  `p3-06-ui-fixture-${process.pid}.mjs`,
);
await writeFile(temporary, candidate, { flag: "wx" });
await writeFile(
  path.join(directory, "source-binding.json"),
  JSON.stringify(
    {
      original: input,
      originalSha256: createHash("sha256").update(source).digest("hex"),
      executedSha256: createHash("sha256").update(candidate).digest("hex"),
      onlyChange: {
        from: original,
        to: '"output/checks/p3-06-ui-alignment/isolated-gift-storefront"',
      },
    },
    null,
    2,
  ) + "\n",
);
try {
  const child = spawn(process.execPath, [temporary, "--production", "--ui"], {
    cwd: root,
    stdio: "inherit",
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  await writeFile(
    path.join(directory, "exit.json"),
    JSON.stringify(result) + "\n",
  );
  process.exitCode = result.code ?? 1;
} finally {
  await unlink(temporary);
}
