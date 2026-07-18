import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

class CreateUserRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['manual', 'platform'])
  source?: 'manual' | 'platform';

  @IsOptional()
  @IsString()
  platformKey?: string;
}

class PatchUserRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

@Controller('api/v1/user-rules')
@UseGuards(JwtAuthGuard)
export class UserRulesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.prisma.userCustomRule.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(
    @Req() req: { user: { userId: string } },
    @Body() dto: CreateUserRuleDto,
  ) {
    const source = dto.source ?? 'manual';
    const platformKey =
      source === 'platform' ? dto.platformKey?.trim() || null : null;

    if (source === 'platform') {
      if (!platformKey) {
        throw new BadRequestException('从平台添加时需提供 platformKey');
      }
      const catalog = await this.prisma.reviewMethod.findFirst({
        where: { key: platformKey, published: true },
      });
      if (!catalog) {
        throw new NotFoundException('平台审查规则不存在或未发布');
      }
      const exists = await this.prisma.userCustomRule.findFirst({
        where: { userId: req.user.userId, platformKey },
      });
      if (exists) {
        throw new ConflictException('已添加过该平台规则');
      }
      return this.prisma.userCustomRule.create({
        data: {
          userId: req.user.userId,
          name: (dto.name || catalog.name).trim(),
          content: (
            dto.content ??
            [catalog.groupName, catalog.description]
              .filter(Boolean)
              .join(' · ')
          ).trim(),
          enabled: dto.enabled ?? true,
          source: 'platform',
          platformKey,
        },
      });
    }

    return this.prisma.userCustomRule.create({
      data: {
        userId: req.user.userId,
        name: dto.name.trim(),
        content: dto.content?.trim() || '',
        enabled: dto.enabled ?? true,
        source: 'manual',
        platformKey: null,
      },
    });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Req() req: { user: { userId: string } },
    @Body() dto: PatchUserRuleDto,
  ) {
    const row = await this.prisma.userCustomRule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('规则不存在');
    if (row.userId !== req.user.userId) {
      throw new ForbiddenException('无权修改该规则');
    }
    return this.prisma.userCustomRule.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        content: dto.content?.trim(),
        enabled: dto.enabled,
      },
    });
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: { user: { userId: string } },
  ) {
    const row = await this.prisma.userCustomRule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('规则不存在');
    if (row.userId !== req.user.userId) {
      throw new ForbiddenException('无权删除该规则');
    }
    await this.prisma.userCustomRule.delete({ where: { id } });
    return { ok: true };
  }
}
