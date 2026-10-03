import { randomBytes, randomUUID } from "node:crypto";
import {
  access,
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
import { createLocalPaymentBinding } from "../apps/api/scripts/local-experience-payment-profile.mjs";
import {
  LOCAL_SERVICE_KEYS,
  localExperienceConfigSchema,
  localServiceOriginFor,
  publicBaseDomainSchema,
} from "../apps/api/scripts/local-experience-config.mjs";
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
/** A public base domain is fixed when the instance is first created; later starts must repeat it or omit it. */
export async function loadLocalState(
  workspaceRoot,
  instance = "default",
  { publicBaseDomain, paymentProvider } = {},
) {
  if (
    paymentProvider !== undefined &&
    !["fake", "stripe-test"].includes(paymentProvider)
  )
    throw new Error("Invalid local payment provider");
  if (
    paymentProvider === "stripe-test" &&
    (publicBaseDomain !== undefined ||
      !/^(?:test|acceptance)-[a-z0-9-]+$/u.test(instance))
  )
    throw new Error("Stripe TEST requires an isolated loopback test instance");
  if (
    publicBaseDomain !== undefined &&
    !publicBaseDomainSchema.safeParse(publicBaseDomain).success
  )
    throw new Error("Invalid public base domain");
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
    if (
      publicBaseDomain !== undefined &&
      parsed.data.exposure?.baseDomain !== publicBaseDomain
    )
      throw new Error(
        "This instance was created with a different exposure; create a new instance for another domain",
      );
    if (
      paymentProvider !== undefined &&
      (parsed.data.paymentProvider ?? "fake") !== paymentProvider
    )
      throw new Error(
        "This instance has a different payment provider; create a new instance",
      );
    return { stateDirectory, config: parsed.data };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const assigned = await ports(),
    instanceId = randomUUID(),
    suffix = randomBytes(6).toString("hex");
  const exposure =
    publicBaseDomain === undefined
      ? undefined
      : { mode: "PUBLIC", baseDomain: publicBaseDomain };
  const origins = Object.fromEntries(
    LOCAL_SERVICE_KEYS.map((key) => [
      key,
      localServiceOriginFor(key, { exposure, port: assigned[key] }),
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
    ...(paymentProvider === "stripe-test" ? { paymentProvider } : {}),
    ports: assigned,
    origins,
    ...(exposure ? { exposure } : {}),
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
        binding: createLocalPaymentBinding(
          paymentProvider ?? "fake",
          randomUUID(),
          origins,
        ),
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
/** Switches how operators sign in to an existing instance; takes effect at the next start. */
export async function setLocalAdminSignIn(workspaceRoot, instance, mode) {
  if (!["LOCAL_OIDC", "LOCAL_ACCOUNT"].includes(mode))
    throw new Error("Admin sign-in must be LOCAL_OIDC or LOCAL_ACCOUNT");
  await access(
    path.join(
      await localStateDirectory(workspaceRoot, instance),
      "config.json",
    ),
  ).catch(() => {
    throw new Error("Unknown local instance; start it first");
  });
  const { stateDirectory, config } = await loadLocalState(
    workspaceRoot,
    instance,
  );
  const next = localExperienceConfigSchema.parse({
    ...config,
    adminSignIn: mode,
  });
  await writePrivateJson(path.join(stateDirectory, "config.json"), next);
  return next;
}
/**
 * Switches an existing instance between compiled applications (PREBUILT) and development servers.
 * DEVELOPMENT removes the field, so code from before the switch can read the configuration again.
 * Takes effect at the next start.
 */
export async function setLocalWebMode(workspaceRoot, instance, mode) {
  if (!["PREBUILT", "DEVELOPMENT"].includes(mode))
    throw new Error("Web mode must be PREBUILT or DEVELOPMENT");
  await access(
    path.join(
      await localStateDirectory(workspaceRoot, instance),
      "config.json",
    ),
  ).catch(() => {
    throw new Error("Unknown local instance; start it first");
  });
  const { stateDirectory, config } = await loadLocalState(
    workspaceRoot,
    instance,
  );
  const rest = { ...config };
  delete rest.webMode;
  const next = localExperienceConfigSchema.parse(
    mode === "PREBUILT" ? { ...rest, webMode: mode } : rest,
  );
  await writePrivateJson(path.join(stateDirectory, "config.json"), next);
  return next;
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
