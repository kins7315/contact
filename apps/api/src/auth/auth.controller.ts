import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { Response } from "express";
import { AuthService } from "./auth.service";
import { AuthCookie, AuthenticatedRequest } from "./auth.types";

const COOKIE_NAME = "simple_image_session";
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 1000 * 60 * 60 * 24 * 7
};

type CredentialsDto = {
  username?: string;
  password?: string;
};

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async register(@Body() body: CredentialsDto, @Res({ passthrough: true }) response: Response) {
    const user = await this.authService.register(body.username ?? "", body.password ?? "");
    this.setSessionCookie(response, user.id);
    return { user };
  }

  @Post("login")
  async login(@Body() body: CredentialsDto, @Res({ passthrough: true }) response: Response) {
    const user = await this.authService.login(body.username ?? "", body.password ?? "");
    this.setSessionCookie(response, user.id);
    return { user };
  }

  @Get("me")
  async me(@Req() request: AuthenticatedRequest) {
    const session = request.signedCookies?.[COOKIE_NAME] as AuthCookie | undefined;

    if (!session?.userId) {
      throw new UnauthorizedException("未登录");
    }

    const user = await this.authService.findSessionUser(Number(session.userId));

    if (!user) {
      throw new UnauthorizedException("登录已失效");
    }

    return { user };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(COOKIE_NAME);
    return { ok: true };
  }

  private setSessionCookie(response: Response, userId: number) {
    response.cookie(COOKIE_NAME, { userId }, { ...COOKIE_OPTIONS, signed: true });
  }
}
