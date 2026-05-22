import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ModelGatewayModule } from "../model-gateway/model-gateway.module";
import { HistoryController } from "./history.controller";
import { HistoryService } from "./history.service";

@Module({
  imports: [AuthModule, ModelGatewayModule],
  controllers: [HistoryController],
  providers: [HistoryService],
  exports: [HistoryService]
})
export class HistoryModule {}
