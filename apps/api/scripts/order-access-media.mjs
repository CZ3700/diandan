import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createStorefrontMediaGateway } from "./storefront-media-fixtures.mjs";

/** A second TEST origin owns its certificate files; S3 bytes and the isolated CA remain unchanged. */
export async function createOrderAccessMediaGateway({ s3, configPath }) {
  const source = path.dirname(configPath);
  const directory = await mkdtemp(path.join(source, "order-access-"));
  let gateway;
  try {
    for (const filename of ["ca.crt", "ca.key"]) {
      const target = path.join(directory, filename);
      await copyFile(path.join(source, filename), target);
      await chmod(target, 0o600);
    }
    gateway = await createStorefrontMediaGateway({
      s3,
      // The legacy gateway uses only the directory of this path for its TEST certificate context.
      configPath: path.join(directory, path.basename(configPath)),
    });
    let closed = false;
    return {
      ...gateway,
      async close() {
        if (closed) return;
        closed = true;
        try {
          await gateway.close();
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await gateway?.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
