import { createProductionApiApplication } from "./production-application.js";
import { startApiProcessRuntime } from "./process-runtime.js";

await startApiProcessRuntime({
  createApplication: (logger) =>
    createProductionApiApplication(process.env, { logger }),
});
