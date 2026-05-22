import { BadRequestException, Controller, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { extname } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { AuthGuard } from "../auth/auth.guard";
import { AuthenticatedRequest } from "../auth/auth.types";
import { ImagesService } from "./images.service";

const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

@Controller("images")
export class ImagesController {
  constructor(private readonly imagesService: ImagesService) {}

  @Post("generate")
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor("image", {
      storage: diskStorage({
        destination: "uploads/sources",
        filename: (_request, file, callback) => {
          callback(null, `${uuidv4()}${extname(file.originalname).toLowerCase()}`);
        }
      }),
      limits: {
        fileSize: 10 * 1024 * 1024
      },
      fileFilter: (_request, file, callback) => {
        callback(null, allowedMimeTypes.has(file.mimetype));
      }
    })
  )
  async generate(@Req() request: AuthenticatedRequest, @UploadedFile() file?: Express.Multer.File) {
    if (!request.user) {
      throw new BadRequestException("请先登录");
    }

    const prompt = String(request.body?.prompt ?? "").trim();
    const modelId = String(request.body?.modelId ?? "").trim();
    const size = String(request.body?.size ?? "1024x1024");
    const count = Number(request.body?.count ?? 1);

    return this.imagesService.generate({
      userId: request.user.id,
      modelId,
      sourcePath: file?.path,
      prompt,
      size,
      count
    });
  }
}
