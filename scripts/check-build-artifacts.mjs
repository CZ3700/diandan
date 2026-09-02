import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packagesRoot = path.join(workspaceRoot, "packages");

const packageDirectories = (
  await readdir(packagesRoot, { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
  .map((entry) => path.join(packagesRoot, entry.name))
  .sort();

const errors = [];
let importedPackageCount = 0;

for (const packageDirectory of packageDirectories) {
  const manifestPath = path.join(packageDirectory, "package.json");
  let manifest;

  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${manifestPath}: ${detail}`);
    continue;
  }

  const exportTarget = manifest.exports?.["."]?.import;
  if (typeof exportTarget !== "string") {
    errors.push(`${manifestPath}: exports["."].import must be a string`);
    continue;
  }

  const artifactPath = path.resolve(packageDirectory, exportTarget);
  if (!artifactPath.startsWith(`${packageDirectory}${path.sep}`)) {
    errors.push(`${manifestPath}: import export must stay inside its package`);
    continue;
  }

  try {
    await import(pathToFileURL(artifactPath).href);
    importedPackageCount += 1;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${manifest.name ?? manifestPath}: ${detail}`);
  }
}

if (errors.length > 0) {
  console.error("Build artifact validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Build artifact validation passed: ${importedPackageCount} package exports imported by Node.`,
  );
}
