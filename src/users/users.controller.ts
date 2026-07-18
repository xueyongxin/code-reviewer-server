import { Controller, Get, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

class UpdateMeDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}

@Controller('api/v1/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

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
}
