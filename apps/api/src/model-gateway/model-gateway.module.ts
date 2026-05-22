import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ModelGatewayController } from "./model-gateway.controller";
import { ModelGatewayService } from "./model-gateway.service";

@Module({
  imports: [PrismaModule],
  controllers: [ModelGatewayController],
  providers: [ModelGatewayService],
  exports: [ModelGatewayService],
})
export class ModelGatewayModule {}
