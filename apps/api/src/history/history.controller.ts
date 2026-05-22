import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { AuthenticatedRequest } from "../auth/auth.types";
import { HistoryService } from "./history.service";

@Controller("history")
@UseGuards(AuthGuard)
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.historyService.list(request.user!.id);
  }

  @Get(":id")
  detail(@Req() request: AuthenticatedRequest, @Param("id", ParseIntPipe) id: number) {
    return this.historyService.detail(request.user!.id, id);
  }

  @Post("text")
  generateText(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = body as {
      modelId?: unknown;
      prompt?: unknown;
      parameters?: unknown;
    };

    return this.historyService.generateText({
      userId: request.user!.id,
      modelId: String(input.modelId ?? "").trim(),
      prompt: String(input.prompt ?? ""),
      parameters: typeof input.parameters === "object" && input.parameters !== null && !Array.isArray(input.parameters)
        ? input.parameters as Record<string, unknown>
        : {}
    });
  }
}
