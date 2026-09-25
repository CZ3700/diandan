import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const generatedDirectory = path.join(
  workspaceRoot,
  "packages",
  "contracts",
  "generated",
);

async function writeAtomically(fileName, content) {
  const destination = path.join(generatedDirectory, fileName);
  const temporary = path.join(
    generatedDirectory,
    `.${fileName}.${process.pid}.tmp`,
  );
  await writeFile(temporary, content, "utf8");
  await rename(temporary, destination);
}

const rendererUrl = pathToFileURL(
  path.join(
    workspaceRoot,
    "packages",
    "contracts",
    "dist",
    "artifact-documents.js",
  ),
);
const { renderContractArtifactDocuments } = await import(rendererUrl.href);
const rendered = renderContractArtifactDocuments();

await mkdir(generatedDirectory, { recursive: true });
await Promise.all([
  writeAtomically("contracts.schema.json", rendered.jsonSchema),
  writeAtomically("openapi.json", rendered.openapi),
]);

console.log("Generated contracts.schema.json and openapi.json");
