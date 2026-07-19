import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin } from '../common/org-roles.guard';
import { PrismaService } from '../prisma/prisma.service';

class UpsertCodeRepoCatalogDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  tokenUrl?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsBoolean()
  needsBaseUrl?: boolean;

  @IsOptional()
  @IsString()
  baseUrlPlaceholder?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

@Controller('api/v1/code-repo-catalog')
export class CodeRepoCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  /** 公开：已上架平台（桌面端「设置 → 代码仓库」列表） */
  @Get()
  async listPublished(@Query('q') q?: string) {
    const items = await this.prisma.codeRepoCatalogItem.findMany({
      where: {
        published: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { key: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return items.map((m) => ({
      key: m.key,
      name: m.name,
      description: m.description,
      tokenUrl: m.tokenUrl || undefined,
      logoUrl: m.logoUrl || undefined,
      needsBaseUrl: m.needsBaseUrl,
      baseUrlPlaceholder: m.baseUrlPlaceholder || undefined,
      sortOrder: m.sortOrder,
    }));
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Get('admin/all')
  adminAll() {
    return this.prisma.codeRepoCatalogItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Post()
  create(@Body() dto: UpsertCodeRepoCatalogDto) {
    return this.prisma.codeRepoCatalogItem.create({
      data: {
        key: dto.key.trim(),
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        tokenUrl: dto.tokenUrl?.trim() || null,
        logoUrl: dto.logoUrl?.trim() || null,
        needsBaseUrl: dto.needsBaseUrl ?? false,
        baseUrlPlaceholder: dto.baseUrlPlaceholder?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        published: dto.published ?? true,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpsertCodeRepoCatalogDto) {
    return this.prisma.codeRepoCatalogItem.update({
      where: { id },
      data: {
        key: dto.key.trim(),
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        tokenUrl: dto.tokenUrl?.trim() || null,
        logoUrl: dto.logoUrl?.trim() || null,
        needsBaseUrl: dto.needsBaseUrl ?? false,
        baseUrlPlaceholder: dto.baseUrlPlaceholder?.trim() || null,
        sortOrder: dto.sortOrder ?? 0,
        published: dto.published ?? true,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.codeRepoCatalogItem.delete({ where: { id } });
    return { ok: true };
  }
}
