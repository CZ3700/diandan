import { startApiProcessRuntime } from "./process-runtime.js";

await startApiProcessRuntime({
  createApplication: async (logger) => {
    const { createProductionApiApplication } =
      await import("./production-application.js");
    return createProductionApiApplication(process.env, { logger });
  },
});
