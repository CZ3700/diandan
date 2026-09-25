import { Controller, Get } from "@nestjs/common";

import { apiHealth } from "./health.js";

@Controller()
export class HealthController {
  @Get("healthz")
  health() {
    return apiHealth;
  }
}
