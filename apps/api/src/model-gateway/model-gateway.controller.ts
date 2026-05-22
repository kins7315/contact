import { Body, Controller, Get, Post } from "@nestjs/common";
import { unifiedModelRequestSchema } from "../types";
import { ModelGatewayService } from "./model-gateway.service";

@Controller("model-gateway")
export class ModelGatewayController {
  constructor(private readonly modelGateway: ModelGatewayService) {}

  @Get("adapters")
  adapters() {
    return this.modelGateway.listAdapterTypes();
  }

  @Get("providers")
  providers() {
    return this.modelGateway.listProviders();
  }

  @Get("models")
  models() {
    return this.modelGateway.listModels();
  }

  @Post("invoke-preview")
  invokePreview(@Body() body: unknown) {
    const request = unifiedModelRequestSchema.parse(body);
    return this.modelGateway.createInvocationPreview(request);
  }
}
