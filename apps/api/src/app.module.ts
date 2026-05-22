import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import { HistoryModule } from "./history/history.module";
import { ImagesModule } from "./images/images.module";
import { ModelGatewayModule } from "./model-gateway/model-gateway.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, AuthModule, ImagesModule, ConfigModule, ModelGatewayModule, HistoryModule]
})
export class AppModule {}
