import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgRolesGuard, PlatformAdmin, Roles } from '../common/org-roles.guard';
import { AuditService } from './audit.service';

@Controller('api/v1/audit-logs')
@UseGuards(JwtAuthGuard, OrgRolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** 超管全站审计（须放在泛匹配 Get() 之前） */
  @Get('admin')
  @PlatformAdmin()
  adminList(
    @Query('orgId') orgId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.list({
      orgId,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get()
  @Roles('org_owner', 'org_admin', 'auditor')
  list(
    @Query('orgId') orgId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.list({
      orgId,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }
}
