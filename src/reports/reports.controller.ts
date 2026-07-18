import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ReportStatus, ReportVisibility } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ReportsService } from './reports.service';

class UploadReportDto {
  @IsString()
  orgId!: string;

  @IsOptional()
  @IsString()
  clientReportId?: string;

  @IsString()
  repoUrl!: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  prNumber?: string;

  @IsOptional()
  @IsString()
  commitSha?: string;

  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @IsOptional()
  @IsEnum(ReportVisibility)
  visibility?: ReportVisibility;

  @IsOptional()
  @IsInt()
  @Min(0)
  issueCount?: number;

  @IsOptional()
  @IsInt()
  totalDurationMs?: number;

  @IsOptional()
  @IsString()
  clientVersion?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsObject()
  payload!: Record<string, unknown>;
}

@Controller('api/v1')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('sync/reports')
  upload(
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Body() dto: UploadReportDto,
  ) {
    return this.reports.upload(dto.orgId, req.user.userId, req.user.isPlatformAdmin, dto);
  }

  @Get('reports')
  list(
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Query('orgId') orgId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('repoUrl') repoUrl?: string,
  ) {
    return this.reports.list(orgId, req.user.userId, req.user.isPlatformAdmin, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      repoUrl,
    });
  }

  @Get('reports/:id')
  get(
    @Param('id') id: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.reports.get(id, req.user.userId, req.user.isPlatformAdmin);
  }

  @Delete('reports/:id')
  remove(
    @Param('id') id: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.reports.remove(id, req.user.userId, req.user.isPlatformAdmin);
  }
}
