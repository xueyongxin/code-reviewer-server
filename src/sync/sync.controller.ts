import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ConfigCenterService } from '../config-center/config-center.service';
import { ReportsService } from '../reports/reports.service';

@Controller('api/v1/sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(
    private readonly config: ConfigCenterService,
    private readonly reports: ReportsService,
  ) {}

  /** 配置 Pull：客户端带 since=version，若云端更新则返回完整配置 */
  @Get('config')
  async pullConfig(
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Query('orgId') orgId: string,
    @Query('since') since?: string,
  ) {
    const cfg = await this.config.get(
      orgId,
      req.user.userId,
      req.user.isPlatformAdmin,
    );
    const sinceVer = since ? Number(since) : 0;
    if (cfg.version <= sinceVer) {
      return { changed: false, version: cfg.version };
    }
    return {
      changed: true,
      version: cfg.version,
      payload: cfg.payload,
      updatedAt: cfg.updatedAt,
    };
  }

  @Get('reports')
  pullReports(
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Query('orgId') orgId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reports.list(orgId, req.user.userId, req.user.isPlatformAdmin, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }
}
