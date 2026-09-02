import { createApiApplication } from "./bootstrap.js";

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return 3002;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API port is invalid");
  }

  return port;
}

async function start(): Promise<void> {
  const application = await createApiApplication();
  application.enableShutdownHooks();
  await application.listen(readPort(process.env["PORT"]), "0.0.0.0");
  console.info("API runtime is listening");
}

try {
  await start();
} catch {
  console.error("API runtime failed to start");
  process.exitCode = 1;
}
