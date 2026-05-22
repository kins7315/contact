import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { PrismaService } from "../prisma/prisma.service";

const scrypt = promisify(scryptCallback);

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(username: string, password: string) {
    const normalizedUsername = this.normalizeUsername(username);
    this.validatePassword(password);

    const existingUser = await this.prisma.user.findUnique({
      where: { username: normalizedUsername }
    });

    if (existingUser) {
      throw new BadRequestException("用户名已存在");
    }

    const user = await this.prisma.user.create({
      data: {
        username: normalizedUsername,
        passwordHash: await this.hashPassword(password)
      },
      select: {
        id: true,
        username: true
      }
    });

    return user;
  }

  async login(username: string, password: string) {
    const normalizedUsername = this.normalizeUsername(username);
    const user = await this.prisma.user.findUnique({
      where: { username: normalizedUsername }
    });

    if (!user || !(await this.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException("用户名或密码错误");
    }

    return {
      id: user.id,
      username: user.username
    };
  }

  async findSessionUser(userId: number) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true
      }
    });
  }

  private normalizeUsername(username: string) {
    const value = username.trim();

    if (value.length < 3 || value.length > 32) {
      throw new BadRequestException("用户名长度需为 3-32 个字符");
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
      throw new BadRequestException("用户名只能包含字母、数字、下划线和短横线");
    }

    return value;
  }

  private validatePassword(password: string) {
    if (password.length < 8 || password.length > 72) {
      throw new BadRequestException("密码长度需为 8-72 个字符");
    }
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${key.toString("hex")}`;
  }

  private async verifyPassword(password: string, passwordHash: string) {
    const [salt, storedKey] = passwordHash.split(":");
    if (!salt || !storedKey) {
      return false;
    }

    const storedBuffer = Buffer.from(storedKey, "hex");
    const key = (await scrypt(password, salt, storedBuffer.length)) as Buffer;

    return storedBuffer.length === key.length && timingSafeEqual(storedBuffer, key);
  }
}
