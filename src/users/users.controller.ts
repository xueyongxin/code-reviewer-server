import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { normalizePhone } from '../auth/phone.util';
import { PrismaService } from '../prisma/prisma.service';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

class AvatarDto {
  /** data URL 或纯 base64 */
  @IsString()
  @MinLength(32)
  data!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}

class RebindPhoneDto {
  @IsString()
  @Matches(/^1\d{10}$/)
  phone!: string;

  @IsString()
  @MinLength(4)
  code!: string;
}

@Controller('api/v1/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private publicBase(): string {
    return (
      process.env.PUBLIC_API_BASE ||
      `http://localhost:${process.env.PORT || 3100}`
    ).replace(/\/$/, '');
  }

  @Get()
  async me(@Req() req: { user: { userId: string } }) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        displayName: true,
        avatarUrl: true,
        isPlatformAdmin: true,
        createdAt: true,
        memberships: {
          include: {
            org: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    return user;
  }

  @Patch()
  async updateMe(
    @Req() req: { user: { userId: string } },
    @Body() dto: UpdateMeDto,
  ) {
    return this.prisma.user.update({
      where: { id: req.user.userId },
      data: {
        displayName: dto.displayName,
        avatarUrl: dto.avatarUrl,
      },
      select: {
        id: true,
        email: true,
        phone: true,
        displayName: true,
        avatarUrl: true,
        isPlatformAdmin: true,
      },
    });
  }

  /** 上传头像（base64），最大约 2MB */
  @Post('avatar')
  async uploadAvatar(
    @Req() req: { user: { userId: string } },
    @Body() dto: AvatarDto,
  ) {
    let mime = dto.mimeType || 'image/png';
    let b64 = dto.data.trim();
    const dataUrl = /^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,(.+)$/i.exec(
      b64,
    );
    if (dataUrl) {
      mime = dataUrl[1].toLowerCase();
      b64 = dataUrl[2];
    }
    if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(mime)) {
      throw new BadRequestException('仅支持 PNG/JPEG/GIF/WebP');
    }
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 2 * 1024 * 1024) {
      throw new BadRequestException('头像不能超过 2MB');
    }
    const ext =
      mime.includes('jpeg') || mime.includes('jpg')
        ? '.jpg'
        : mime.includes('gif')
          ? '.gif'
          : mime.includes('webp')
            ? '.webp'
            : '.png';
    const dir = join(process.cwd(), 'uploads', 'avatars');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = `${req.user.userId}${ext}`;
    writeFileSync(join(dir, file), buf);
    const avatarUrl = `${this.publicBase()}/uploads/avatars/${file}?v=${Date.now()}`;
    return this.prisma.user.update({
      where: { id: req.user.userId },
      data: { avatarUrl },
      select: {
        id: true,
        email: true,
        phone: true,
        displayName: true,
        avatarUrl: true,
        isPlatformAdmin: true,
      },
    });
  }

  /** 换绑手机号：向新号发短信后提交验证码 */
  @Post('phone/rebind')
  async rebindPhone(
    @Req() req: { user: { userId: string } },
    @Body() dto: RebindPhoneDto,
  ) {
    const phone = normalizePhone(dto.phone);
    await this.auth.verifySmsCode(phone, dto.code);
    const taken = await this.prisma.user.findFirst({
      where: { phone, NOT: { id: req.user.userId } },
    });
    if (taken) throw new BadRequestException('该手机号已被其他账号使用');
    return this.prisma.user.update({
      where: { id: req.user.userId },
      data: { phone },
      select: {
        id: true,
        email: true,
        phone: true,
        displayName: true,
        avatarUrl: true,
        isPlatformAdmin: true,
      },
    });
  }

  /** 注销账号（软删）：吊销会话、禁用账号、释放手机号 */
  @Delete()
  async deleteMe(@Req() req: { user: { userId: string } }) {
    const userId = req.user.userId;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('用户不存在');
    if (user.isPlatformAdmin) {
      throw new BadRequestException('平台超管不可自助注销，请联系运维');
    }
    const tombstone = `deleted_${createHash('sha256').update(userId).digest('hex').slice(0, 12)}`;
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          status: 'banned',
          statusReason: 'user_deleted',
          statusChangedAt: new Date(),
          statusChangedBy: userId,
          phone: null,
          email: user.email ? `${tombstone}@deleted.local` : null,
          displayName: '已注销用户',
          avatarUrl: null,
          passwordHash: null,
        },
      }),
    ]);
    return { ok: true };
  }
}
