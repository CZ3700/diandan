import { startNativePostgres } from "./local-experience-postgres.mjs";
import { startS3 } from "./local-experience-storage.mjs";
export { prepareLocalTls, startLocalProxy } from "./local-experience-tls.mjs";
export { verifyOwnedContainer } from "./local-experience-storage.mjs";

export async function startLocalInfrastructure(context) {
  const database = await startNativePostgres(context);
  const s3 = await startS3(context);
  return { database, s3 };
}
