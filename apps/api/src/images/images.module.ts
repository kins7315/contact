import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { HistoryModule } from "../history/history.module";
import { ModelGatewayModule } from "../model-gateway/model-gateway.module";
import { ImagesController } from "./images.controller";
import { ImagesService } from "./images.service";

@Module({
  imports: [AuthModule, ModelGatewayModule, HistoryModule],
  controllers: [ImagesController],
  providers: [ImagesService]
})
export class ImagesModule {}
