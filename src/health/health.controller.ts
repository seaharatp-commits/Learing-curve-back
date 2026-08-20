import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      status: "ok",
      service: "learning-curve-backend",
      timestamp: new Date().toISOString(),
    };
  }
}
