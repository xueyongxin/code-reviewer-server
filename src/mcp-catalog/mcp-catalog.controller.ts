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
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin } from '../common/org-roles.guard';
import { PrismaService } from '../prisma/prisma.service';

class UpsertCatalogDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  transport?: string;

  @IsOptional()
  @IsString()
  command?: string;

  @IsOptional()
  @IsArray()
  args?: string[];

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsArray()
  envKeys?: string[];

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  verified?: boolean;

  @IsOptional()
  @IsBoolean()
  published?: boolean;

  @IsOptional()
  @IsString()
  badge?: string;
}

@Controller('api/v1/mcp-catalog')
export class McpCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.prisma.mcpCatalogItem.findMany({
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
      orderBy: { name: 'asc' },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Get('admin/all')
  adminAll() {
    return this.prisma.mcpCatalogItem.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Post()
  create(@Body() dto: UpsertCatalogDto) {
    return this.prisma.mcpCatalogItem.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        transport: dto.transport || 'stdio',
        command: dto.command,
        args: dto.args ?? [],
        url: dto.url,
        envKeys: dto.envKeys ?? [],
        tags: dto.tags ?? [],
        verified: dto.verified ?? false,
        published: dto.published ?? true,
        badge: dto.badge,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpsertCatalogDto) {
    return this.prisma.mcpCatalogItem.update({
      where: { id },
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        transport: dto.transport || 'stdio',
        command: dto.command,
        args: dto.args ?? [],
        url: dto.url,
        envKeys: dto.envKeys ?? [],
        tags: dto.tags ?? [],
        verified: dto.verified ?? false,
        published: dto.published ?? true,
        badge: dto.badge,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.mcpCatalogItem.delete({ where: { id } });
    return { ok: true };
  }
}
