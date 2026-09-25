import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  realpath,
  readFile,
  writeFile,
  rename,
  rm,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { SUPPORTED_LOCALES } from "../packages/contracts/dist/index.js";
import { localExperienceConfigSchema } from "../apps/api/scripts/local-experience-config.mjs";
const token = () => randomBytes(32).toString("base64url");
export async function localStateDirectory(workspaceRoot, instance) {
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(instance))
    throw new Error("Invalid local instance");
  const root = await realpath(workspaceRoot);
  let directory = root;
  for (const name of [
    "node_modules",
    ".cache",
    "fan-support-local-experience",
    instance,
  ]) {
    directory = path.join(directory, name);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (
      (await lstat(directory)).isSymbolicLink() ||
      (await realpath(directory)) !== directory
    )
      throw new Error("Local state symlink is forbidden");
  }
  return directory;
}
export async function writePrivateJson(file, value) {
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, file);
}
async function ports() {
  const reservations = [];
  try {
    const result = {};
    for (const name of [
      "storefront",
      "admin",
      "api",
      "worker",
      "oidc",
      "psp",
      "mail",
      "media",
      "s3",
      "s3Backend",
      "postgres",
      "control",
      "storefrontBackend",
      "adminBackend",
    ]) {
      const server = createServer();
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      reservations.push(server);
      result[name] = server.address().port;
    }
    return result;
  } finally {
    await Promise.all(
      reservations.map(
        (server) => new Promise((resolve) => server.close(resolve)),
      ),
    );
  }
}
export async function loadLocalState(workspaceRoot, instance = "default") {
  const stateDirectory = await localStateDirectory(workspaceRoot, instance),
    file = path.join(stateDirectory, "config.json");
  for (const relative of [
    "config.json",
    "tls",
    "postgres",
    "media",
    "media/s3",
    "media/iam",
    "chrome",
  ]) {
    try {
      if ((await lstat(path.join(stateDirectory, relative))).isSymbolicLink())
        throw new Error("Local state symlink is forbidden");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    const parsed = localExperienceConfigSchema.safeParse(
      JSON.parse(await readFile(file, "utf8")),
    );
    if (
      !parsed.success ||
      parsed.data.workspaceRoot !== (await realpath(workspaceRoot)) ||
      parsed.data.instance !== instance ||
      parsed.data.tls.caCertificatePath !==
        path.join(stateDirectory, "tls/ca.crt") ||
      parsed.data.tls.certificatePath !==
        path.join(stateDirectory, "tls/server.crt") ||
      parsed.data.tls.privateKeyPath !==
        path.join(stateDirectory, "tls/server.key") ||
      parsed.data.services.oidc.signingPrivateKeyPath !==
        path.join(stateDirectory, "tls/oidc.key")
    )
      throw new Error(
        "Invalid local state configuration; existing data was preserved",
      );
    return { stateDirectory, config: parsed.data };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const assigned = await ports(),
    instanceId = randomUUID(),
    suffix = randomBytes(6).toString("hex");
  const origins = Object.fromEntries(
    ["storefront", "admin", "oidc", "psp", "mail", "media"].map((key) => [
      key,
      `https://${key === "psp" ? "payments" : key}.example.invalid:${assigned[key]}`,
    ]),
  );
  const secrets = Object.fromEntries(
    [
      "controlToken",
      "tokenPepper",
      "subjectPepper",
      "accessKey",
      "kmsMasterKey",
      "kmsMacKey",
      "webhookSecret",
    ].map((key) => [key, token()]),
  );
  const config = localExperienceConfigSchema.parse({
    schemaVersion: 1,
    environment: "LOCAL_TEST",
    instance,
    instanceId,
    workspaceRoot: await realpath(workspaceRoot),
    ports: assigned,
    origins,
    secrets,
    database: {
      user: "fan_support_local",
      database: "fan_support_local",
      password: token(),
    },
    s3: {
      accessKeyId: token(),
      secretAccessKey: token(),
      sourceBucket: `fan-support-media-source-${suffix}`,
      derivativeBucket: `fan-support-media-derivative-${suffix}`,
    },
    tls: {
      caCertificatePath: path.join(stateDirectory, "tls/ca.crt"),
      certificatePath: path.join(stateDirectory, "tls/server.crt"),
      privateKeyPath: path.join(stateDirectory, "tls/server.key"),
    },
    services: {
      oidc: {
        clientId: `local-${instanceId}`,
        clientSecret: token(),
        signingPrivateKeyPath: path.join(stateDirectory, "tls/oidc.key"),
        actors: ["manager", "reviewer"].map((key) => ({
          key,
          label:
            key === "manager"
              ? "管理人员（本地测试）"
              : "独立复核人员（本地测试）",
          subject: randomUUID(),
          id: randomUUID(),
        })),
        acr: "urn:local-test:mfa",
        amr: ["pwd", "otp"],
      },
      psp: {
        databaseName: "p404_psp_" + randomBytes(16).toString("hex"),
        authorizationToken: token(),
        binding: {
          schemaVersion: 1,
          providerAccountId: randomUUID(),
          providerCode: "fake",
          environment: "TEST",
          allowedActionOrigins: [origins.psp],
          localeMapping: Object.fromEntries(
            SUPPORTED_LOCALES.map((locale) => [
              locale,
              { providerLocale: locale, fallbackUsed: false },
            ]),
          ),
        },
        webhookEndpointId: randomUUID(),
      },
      mail: {
        authorizationToken: token(),
        captureEncryptionKey: token(),
        viewerToken: token(),
        profile: {
          schemaVersion: 1,
          protocol: "fan-support-mail-v1",
          environment: "TEST",
          apiOrigin: origins.mail,
          fromEmail: "support@example.invalid",
          fromName: "Local TEST",
          replyToEmail: "support@example.invalid",
          timeoutMs: 5000,
          idempotencyRetentionSeconds: 604800,
        },
      },
    },
  });
  // Exclusive creation also protects against two simultaneous first starts.
  await writeFile(file, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  return { stateDirectory, config };
}
export async function resetLocalState(workspaceRoot, instance, confirmation) {
  const state = await loadLocalState(workspaceRoot, instance);
  if (confirmation !== state.config.instanceId)
    throw new Error("Reset confirmation must match the instance identity");
  try {
    await lstat(path.join(state.stateDirectory, "supervisor.lock"));
    throw new Error("Stop the local instance before reset");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rm(state.stateDirectory, { recursive: true });
}
