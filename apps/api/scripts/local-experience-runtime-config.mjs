import { Buffer } from "node:buffer";
import { URL } from "node:url";

export function localSecretHex(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value) ||
    Buffer.from(value, "base64url").toString("base64url") !== value
  )
    throw new TypeError("Invalid local runtime secret");
  return Buffer.from(value, "base64url").toString("hex");
}

/** Only the owned local database and media are projected into the canonical strict application environment. */
export function localExperienceEnvironment({ config, database, s3 }) {
  if (config.environment !== "LOCAL_TEST")
    throw new TypeError("Runtime requires LOCAL_TEST");
  if (!["127.0.0.1", "::1", "localhost"].includes(database.host))
    throw new TypeError("Runtime requires loopback PostgreSQL");
  const url = new URL("postgresql://localhost");
  url.hostname = database.host;
  url.port = String(database.port);
  url.username = database.user;
  url.password = database.password;
  url.pathname = `/${database.database}`;
  return {
    NODE_ENV: "test",
    FAN_SUPPORT_DEPLOYMENT_ENV: "test",
    FAN_SUPPORT_SITE_ORIGIN: config.origins.storefront,
    FAN_SUPPORT_DATABASE_URL: url.toString(),
    FAN_SUPPORT_OBJECT_STORAGE_AUTH_MODE: "static",
    FAN_SUPPORT_OBJECT_STORAGE_ENDPOINT: s3.endpoint,
    FAN_SUPPORT_OBJECT_STORAGE_PRESIGN_ENDPOINT: s3.endpoint,
    FAN_SUPPORT_OBJECT_STORAGE_SOURCE_BUCKET: s3.sourceBucket,
    FAN_SUPPORT_OBJECT_STORAGE_DERIVATIVE_BUCKET: s3.derivativeBucket,
    FAN_SUPPORT_OBJECT_STORAGE_PUBLIC_MEDIA_ORIGIN: config.origins.media,
    FAN_SUPPORT_OBJECT_STORAGE_REGION: "us-east-1",
    FAN_SUPPORT_OBJECT_STORAGE_ACCESS_KEY_ID: s3.accessKeyId,
    FAN_SUPPORT_OBJECT_STORAGE_SECRET_ACCESS_KEY: s3.secretAccessKey,
    FAN_SUPPORT_OBJECT_STORAGE_FORCE_PATH_STYLE: "true",
    FAN_SUPPORT_OBJECT_STORAGE_MAX_UPLOAD_BYTES: "33554432",
  };
}
