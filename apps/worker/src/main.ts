import { createWorkerApplication } from "./bootstrap.js";

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return 3003;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("worker port is invalid");
  }

  return port;
}

async function start(): Promise<void> {
  const application = await createWorkerApplication();
  application.enableShutdownHooks();
  await application.listen(readPort(process.env["PORT"]), "0.0.0.0");
  console.info("Worker runtime is listening");
}

try {
  await start();
} catch {
  console.error("Worker runtime failed to start");
  process.exitCode = 1;
}
