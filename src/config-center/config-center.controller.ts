import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { IsObject } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ConfigCenterService } from './config-center.service';

class PutConfigDto {
  @IsObject()
  payload!: Record<string, unknown>;
}

@Controller('api/v1/orgs/:orgId/config')
@UseGuards(JwtAuthGuard)
export class ConfigCenterController {
  constructor(private readonly config: ConfigCenterService) {}

  @Get()
  get(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.config.get(orgId, req.user.userId, req.user.isPlatformAdmin);
  }

  @Put()
  put(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Body() dto: PutConfigDto,
  ) {
    return this.config.put(
      orgId,
      req.user.userId,
      req.user.isPlatformAdmin,
      dto.payload,
    );
  }

  @Get('versions')
  versions(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.config.versions(orgId, req.user.userId, req.user.isPlatformAdmin);
  }
}
