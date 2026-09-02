import { Controller, Get } from "@nestjs/common";

import { workerHealth } from "./health.js";

@Controller()
export class HealthController {
  @Get("healthz")
  health() {
    return workerHealth;
  }
}
