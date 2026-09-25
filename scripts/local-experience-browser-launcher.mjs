import { URL, URLSearchParams } from "node:url";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash, X509Certificate } from "node:crypto";
import path from "node:path";

export function localBrowserUrls(config) {
  return [
    config.origins.storefront + "/en",
    config.origins.admin,
    config.origins.mail +
      "/#" +
      new URLSearchParams({ token: config.services.mail.viewerToken }),
  ];
}

export async function launchLocalBrowser({ config, stateDirectory }) {
  const certificate = new X509Certificate(
    await readFile(config.tls.certificatePath),
  );
  const pin = createHash("sha256")
    .update(certificate.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const binary =
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : process.env.FAN_SUPPORT_LOCAL_CHROME;
  if (!binary)
    throw new Error("Set FAN_SUPPORT_LOCAL_CHROME to your Chrome executable");
  const rules = Object.values(config.origins)
    .map((origin) => "MAP " + new URL(origin).hostname + " 127.0.0.1")
    .join(", ");
  const child = spawn(
    binary,
    [
      "--user-data-dir=" + path.join(stateDirectory, "chrome"),
      "--host-resolver-rules=" + rules,
      "--ignore-certificate-errors-spki-list=" + pin,
      "--no-proxy-server",
      "--no-first-run",
      ...localBrowserUrls(config),
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  console.log("已打开前台、管理中心和本地测试收件箱。");
}
