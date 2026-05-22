import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthCookie, AuthenticatedRequest } from "./auth.types";

const COOKIE_NAME = "simple_image_session";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.signedCookies?.[COOKIE_NAME] as AuthCookie | undefined;

    if (!session?.userId) {
      throw new UnauthorizedException("请先登录");
    }

    const user = await this.authService.findSessionUser(Number(session.userId));

    if (!user) {
      throw new UnauthorizedException("登录已失效");
    }

    request.user = user;
    return true;
  }
}
