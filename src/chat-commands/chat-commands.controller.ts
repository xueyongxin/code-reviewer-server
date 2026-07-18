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
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin } from '../common/org-roles.guard';
import { PrismaService } from '../prisma/prisma.service';

class UpsertChatCommandDto {
  @IsString()
  key!: string;

  @IsString()
  slash!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  promptTemplate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

function normalizeSlash(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  return s.startsWith('/') ? s : `/${s}`;
}

function normalizeKey(raw: string, slash: string): string {
  const k = raw.trim().replace(/^\//, '');
  if (k) return k;
  return slash.replace(/^\//, '');
}

@Controller('api/v1/chat-commands')
export class ChatCommandsController {
  constructor(private readonly prisma: PrismaService) {}

  /** 公开：已发布对话命令（桌面端拉取） */
  @Get()
  async listPublished(@Query('q') q?: string) {
    const items = await this.prisma.chatCommand.findMany({
      where: {
        published: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { key: { contains: q, mode: 'insensitive' } },
                { slash: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return items.map((m) => ({
      id: m.key,
      key: m.key,
      slash: m.slash,
      name: m.name,
      description: m.description,
      promptTemplate: m.promptTemplate,
      sortOrder: m.sortOrder,
    }));
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Get('admin/all')
  adminAll() {
    return this.prisma.chatCommand.findMany({
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Post()
  create(@Body() dto: UpsertChatCommandDto) {
    const slash = normalizeSlash(dto.slash);
    const key = normalizeKey(dto.key, slash);
    return this.prisma.chatCommand.create({
      data: {
        key,
        slash,
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        promptTemplate: dto.promptTemplate?.trim() || '',
        sortOrder: dto.sortOrder ?? 0,
        published: dto.published ?? true,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpsertChatCommandDto) {
    const exists = await this.prisma.chatCommand.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('命令不存在');
    const slash = normalizeSlash(dto.slash);
    const key = normalizeKey(dto.key, slash);
    return this.prisma.chatCommand.update({
      where: { id },
      data: {
        key,
        slash,
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        promptTemplate: dto.promptTemplate?.trim() || '',
        sortOrder: dto.sortOrder ?? exists.sortOrder,
        published: dto.published ?? exists.published,
      },
    });
  }

  @UseGuards(JwtAuthGuard, OrgRolesGuard)
  @PlatformAdmin()
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.prisma.chatCommand.delete({ where: { id } });
    return { ok: true };
  }
}
