import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

/** Collect allowlisted evidence formats. Each producer must redact its own content. */
export async function collectRegressionArtifacts(source, destination) {
  let files = 0;
  async function visit(directory, relative = "") {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const filename = path.join(relative, entry.name);
      if (entry.isDirectory())
        await visit(path.join(directory, entry.name), filename);
      else if (entry.isFile() && /\.(?:json|png|md|txt)$/u.test(entry.name)) {
        await mkdir(path.dirname(path.join(destination, filename)), {
          recursive: true,
        });
        await copyFile(
          path.join(source, filename),
          path.join(destination, filename),
          1,
        );
        files++;
      }
    }
  }
  await visit(source);
  return { schemaVersion: 1, files };
}
