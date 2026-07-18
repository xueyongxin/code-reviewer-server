import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

class UserMcpItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  key!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  command?: string;

  @IsOptional()
  @IsArray()
  args?: string[];

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  verified?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['market', 'manual'])
  source?: 'market' | 'manual';

  @IsOptional()
  @IsString()
  catalogId?: string;
}

class ReplaceMcpListDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserMcpItemDto)
  servers!: UserMcpItemDto[];
}

@Controller('api/v1/me/mcp-servers')
@UseGuards(JwtAuthGuard)
export class UserMcpController {
  constructor(private readonly prisma: PrismaService) {}

  private mapRow(row: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    command: string | null;
    args: unknown;
    tags: unknown;
    verified: boolean;
    enabled: boolean;
    source: string;
    catalogId: string | null;
  }) {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description || undefined,
      command: row.command || undefined,
      args: Array.isArray(row.args) ? (row.args as string[]) : [],
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      verified: row.verified,
      enabled: row.enabled,
      source: (row.source === 'market' ? 'market' : 'manual') as
        | 'market'
        | 'manual',
      catalogId: row.catalogId || undefined,
    };
  }

  @Get()
  async list(@Req() req: { user: { userId: string } }) {
    const rows = await this.prisma.userMcpServer.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.mapRow(r));
  }

  /** 整表替换（便于前端本地编辑后一次同步） */
  @Put()
  async replaceAll(
    @Req() req: { user: { userId: string } },
    @Body() dto: ReplaceMcpListDto,
  ) {
    const userId = req.user.userId;
    await this.prisma.$transaction(async (tx) => {
      await tx.userMcpServer.deleteMany({ where: { userId } });
      if (!dto.servers.length) return;
      for (const s of dto.servers) {
        await tx.userMcpServer.create({
          data: {
            ...(s.id && s.id.length > 8 ? { id: s.id } : {}),
            userId,
            key: s.key.trim(),
            name: s.name.trim(),
            description: s.description?.trim() || null,
            command: s.command?.trim() || null,
            args: (s.args ?? []) as Prisma.InputJsonValue,
            tags: (s.tags ?? []) as Prisma.InputJsonValue,
            verified: Boolean(s.verified),
            enabled: s.enabled !== false,
            source: s.source === 'market' ? 'market' : 'manual',
            catalogId: s.catalogId || null,
          },
        });
      }
    });
    return this.list(req);
  }

  @Post()
  async create(
    @Req() req: { user: { userId: string } },
    @Body() dto: UserMcpItemDto,
  ) {
    const row = await this.prisma.userMcpServer.create({
      data: {
        userId: req.user.userId,
        key: dto.key.trim(),
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        command: dto.command?.trim() || null,
        args: (dto.args ?? []) as Prisma.InputJsonValue,
        tags: (dto.tags ?? []) as Prisma.InputJsonValue,
        verified: Boolean(dto.verified),
        enabled: dto.enabled !== false,
        source: dto.source === 'market' ? 'market' : 'manual',
        catalogId: dto.catalogId || null,
      },
    });
    return this.mapRow(row);
  }

  @Patch(':id')
  async patch(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: UserMcpItemDto,
  ) {
    await this.prisma.userMcpServer.updateMany({
      where: { id, userId: req.user.userId },
      data: {
        key: dto.key?.trim(),
        name: dto.name?.trim(),
        description: dto.description?.trim() || null,
        command: dto.command?.trim() || null,
        args: dto.args ? (dto.args as Prisma.InputJsonValue) : undefined,
        tags: dto.tags ? (dto.tags as Prisma.InputJsonValue) : undefined,
        verified: dto.verified,
        enabled: dto.enabled,
        source: dto.source,
        catalogId: dto.catalogId,
      },
    });
    const row = await this.prisma.userMcpServer.findFirst({
      where: { id, userId: req.user.userId },
    });
    return row ? this.mapRow(row) : null;
  }

  @Delete(':id')
  async remove(
    @Req() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    await this.prisma.userMcpServer.deleteMany({
      where: { id, userId: req.user.userId },
    });
    return { ok: true };
  }
}
