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
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin } from '../common/org-roles.guard';
import { PrismaService } from '../prisma/prisma.service';

class UpsertLlmCatalogDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  protocol?: string;

  @IsString()
  baseUrl!: string;

  @IsString()
  model!: string;

  @IsOptional()
  @IsArray()
  models?: string[];

  @IsOptional()
  @IsArray()
  fallbackModels?: string[];

  @IsOptional()
  @IsString()
  apiKeyUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

@Controller('api/v1/llm-catalog')
export class LlmCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  /** 公开：已发布内置模型目录（桌面端拉取） */
  @Get()
  async listPublished(@Query('q') q?: string) {
    const items = await this.prisma.llmCatalogItem.findMany({
      where: {
        published: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { key: { contains: q, mode: 'insensitive' } },
                { model: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    // 与桌面端 LlmProviderPreset 对齐
    return items.map((m) => {
      const models = asStringArray(m.models);
      return {
        key: m.key,
        name: m.name,
        protocol: m.protocol,
        baseUrl: m.baseUrl,
        model: m.model,
        models: models.length ? models : [m.model].filter(Boolean),
        fallbackModels: asStringArray(m.fallbackModels),
        apiKeyUrl: m.apiKeyUrl || undefined,
        description: m.description,
        sortOrder: m.sortOrder,
      };
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Get('admin/all')
  adminAll() {
    return this.prisma.llmCatalogItem.findMany({
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Post()
  create(@Body() dto: UpsertLlmCatalogDto) {
    const models = dto.models?.length ? dto.models : [dto.model].filter(Boolean);
    return this.prisma.llmCatalogItem.create({
      data: {
        key: dto.key,
        name: dto.name,
        protocol: dto.protocol || 'openai-compatible',
        baseUrl: dto.baseUrl,
        model: dto.model,
        models,
        fallbackModels: dto.fallbackModels ?? [],
        apiKeyUrl: dto.apiKeyUrl,
        description: dto.description ?? '',
        sortOrder: dto.sortOrder ?? 0,
        published: dto.published ?? true,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpsertLlmCatalogDto) {
    const models = dto.models?.length ? dto.models : [dto.model].filter(Boolean);
    return this.prisma.llmCatalogItem.update({
      where: { id },
      data: {
        key: dto.key,
        name: dto.name,
        protocol: dto.protocol || 'openai-compatible',
        baseUrl: dto.baseUrl,
        model: dto.model,
        models,
        fallbackModels: dto.fallbackModels ?? [],
        apiKeyUrl: dto.apiKeyUrl,
        description: dto.description ?? '',
        sortOrder: dto.sortOrder ?? 0,
        published: dto.published ?? true,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.llmCatalogItem.delete({ where: { id } });
    return { ok: true };
  }
}
