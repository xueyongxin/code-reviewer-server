import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

class CreateApiKeyDto {
  @IsString()
  orgId!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}

@Controller('api/v1/api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertAdmin(orgId: string, userId: string, isPlatformAdmin: boolean) {
    if (isPlatformAdmin) return;
    const m = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!m || !['org_owner', 'org_admin'].includes(m.role)) {
      throw new ForbiddenException('权限不足');
    }
  }

  @Get()
  async list(
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Query('orgId') orgId: string,
  ) {
    await this.assertAdmin(orgId, req.user.userId, req.user.isPlatformAdmin);
    return this.prisma.apiKey.findMany({
      where: { orgId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });
  }

  @Post()
  async create(
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Body() dto: CreateApiKeyDto,
  ) {
    await this.assertAdmin(dto.orgId, req.user.userId, req.user.isPlatformAdmin);
    const raw = `cr_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(raw).digest('hex');
    const keyPrefix = raw.slice(0, 10);
    const row = await this.prisma.apiKey.create({
      data: {
        orgId: dto.orgId,
        name: dto.name,
        keyPrefix,
        keyHash,
        createdBy: req.user.userId,
      },
    });
    await this.audit.log({
      orgId: dto.orgId,
      actorId: req.user.userId,
      action: 'api_key.create',
      resourceType: 'api_key',
      resourceId: row.id,
    });
    return { id: row.id, name: row.name, keyPrefix, apiKey: raw };
  }

  @Delete(':id')
  async revoke(
    @Param('id') id: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Query('orgId') orgId: string,
  ) {
    await this.assertAdmin(orgId, req.user.userId, req.user.isPlatformAdmin);
    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.audit.log({
      orgId,
      actorId: req.user.userId,
      action: 'api_key.revoke',
      resourceType: 'api_key',
      resourceId: id,
    });
    return { ok: true };
  }
}
