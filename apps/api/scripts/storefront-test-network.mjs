import { spawnSync } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

/** Isolated harness CA signs only the synthetic media hostname; no global trust changes. */
export async function createStorefrontTestCertificate(directory) {
  const certificatePath = path.join(directory, "storefront-media.crt");
  const privateKeyPath = path.join(directory, "storefront-media.key");
  const requestPath = path.join(directory, "storefront-media.csr");
  const extensionsPath = path.join(directory, "storefront-media.ext");
  await writeFile(
    extensionsPath,
    [
      "basicConstraints=critical,CA:FALSE",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "subjectAltName=DNS:media.example.invalid",
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  for (const arguments_ of [
    [
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      privateKeyPath,
      "-out",
      requestPath,
      "-subj",
      "/CN=media.example.invalid",
    ],
    [
      "x509",
      "-req",
      "-in",
      requestPath,
      "-CA",
      path.join(directory, "ca.crt"),
      "-CAkey",
      path.join(directory, "ca.key"),
      "-CAcreateserial",
      "-out",
      certificatePath,
      "-days",
      "2",
      "-sha256",
      "-extfile",
      extensionsPath,
    ],
  ]) {
    const result = spawnSync("openssl", arguments_, {
      cwd: directory,
      stdio: "ignore",
    });
    if (result.error || result.status !== 0)
      throw new Error("TEST media certificate generation failed");
  }
  await chmod(privateKeyPath, 0o600);
  await chmod(certificatePath, 0o600);
  return { certificatePath, privateKeyPath };
}
