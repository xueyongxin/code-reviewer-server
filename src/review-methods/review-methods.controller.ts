import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin } from '../common/org-roles.guard';
import { PrismaService } from '../prisma/prisma.service';

class UpsertReviewMethodDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsString()
  groupName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  staticRuleIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

@Controller('api/v1/review-methods')
export class ReviewMethodsController {
  constructor(private readonly prisma: PrismaService) {}

  /** 公开：已发布审查规则（桌面端拉取） */
  @Get()
  async listPublished(@Query('q') q?: string) {
    const items = await this.prisma.reviewMethod.findMany({
      where: {
        published: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { key: { contains: q, mode: 'insensitive' } },
                { groupName: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    // 与桌面端 ReviewMethodDef 对齐：id = key
    return items.map((m) => ({
      id: m.key,
      key: m.key,
      name: m.name,
      group: m.groupName,
      description: m.description,
      staticRuleIds: Array.isArray(m.staticRuleIds)
        ? (m.staticRuleIds as string[])
        : [],
      sortOrder: m.sortOrder,
    }));
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Get('admin/all')
  adminAll() {
    return this.prisma.reviewMethod.findMany({
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Post()
  create(@Body() dto: UpsertReviewMethodDto) {
    return this.prisma.reviewMethod.create({
      data: {
        key: dto.key.trim(),
        name: dto.name.trim(),
        groupName: dto.groupName.trim(),
        description: dto.description?.trim() || '',
        staticRuleIds: dto.staticRuleIds ?? [],
        sortOrder: dto.sortOrder ?? 0,
        published: dto.published ?? true,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpsertReviewMethodDto) {
    const exists = await this.prisma.reviewMethod.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('审查规则不存在');
    return this.prisma.reviewMethod.update({
      where: { id },
      data: {
        key: dto.key.trim(),
        name: dto.name.trim(),
        groupName: dto.groupName.trim(),
        description: dto.description?.trim() || '',
        staticRuleIds: dto.staticRuleIds ?? [],
        sortOrder: dto.sortOrder ?? exists.sortOrder,
        published: dto.published ?? exists.published,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.reviewMethod.delete({ where: { id } });
    return { ok: true };
  }
}
