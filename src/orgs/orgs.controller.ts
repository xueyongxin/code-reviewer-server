import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { normalizePhone } from '../auth/phone.util';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { OrgsService } from './orgs.service';

class CreateOrgDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

class RenameOrgDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

class InviteDto {
  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim()
      ? normalizePhone(value)
      : undefined,
  )
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone?: string;

  @IsOptional()
  @IsEnum(OrgRole)
  role?: OrgRole;
}

class UpdateRoleDto {
  @IsEnum(OrgRole)
  role!: OrgRole;
}

class TransferDto {
  @IsString()
  targetUserId!: string;
}

@Controller('api/v1/orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.orgs.listForUser(req.user.userId);
  }

  @Get('create-eligibility')
  createEligibility(@Req() req: { user: { userId: string } }) {
    return this.orgs.createEligibility(req.user.userId);
  }

  @Post()
  create(
    @Req() req: { user: { userId: string } },
    @Body() dto: CreateOrgDto,
  ) {
    return this.orgs.create(req.user.userId, dto.name);
  }

  @Post('invites/:token/accept')
  acceptInvite(
    @Param('token') token: string,
    @Req() req: { user: { userId: string } },
  ) {
    return this.orgs.acceptInvite(token, req.user.userId);
  }

  @Patch(':orgId')
  rename(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string } },
    @Body() dto: RenameOrgDto,
  ) {
    return this.orgs.rename(orgId, req.user.userId, dto.name);
  }

  @Get(':orgId')
  get(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.orgs.get(orgId, req.user.userId, req.user.isPlatformAdmin);
  }

  @Get(':orgId/members')
  members(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.orgs.listMembers(
      orgId,
      req.user.userId,
      req.user.isPlatformAdmin,
    );
  }

  @Post(':orgId/members')
  invite(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Body() dto: InviteDto,
  ) {
    return this.orgs.invite(
      orgId,
      req.user.userId,
      { phone: dto.phone, role: dto.role },
      req.user.isPlatformAdmin,
    );
  }

  @Get(':orgId/invites')
  listInvites(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.orgs.listInvites(
      orgId,
      req.user.userId,
      req.user.isPlatformAdmin,
    );
  }

  @Delete(':orgId/invites/:inviteId')
  revokeInvite(
    @Param('orgId') orgId: string,
    @Param('inviteId') inviteId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.orgs.revokeInvite(
      orgId,
      inviteId,
      req.user.userId,
      req.user.isPlatformAdmin,
    );
  }

  @Post(':orgId/leave')
  leave(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string } },
  ) {
    return this.orgs.leaveOrg(orgId, req.user.userId);
  }

  @Post(':orgId/transfer')
  transfer(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string } },
    @Body() dto: TransferDto,
  ) {
    return this.orgs.transferOwnership(
      orgId,
      req.user.userId,
      dto.targetUserId,
    );
  }

  @Patch(':orgId/members/:userId')
  updateRole(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
    @Body() dto: UpdateRoleDto,
  ) {
    return this.orgs.updateMemberRole(
      orgId,
      req.user.userId,
      userId,
      dto.role,
      req.user.isPlatformAdmin,
    );
  }

  @Delete(':orgId/members/:userId')
  remove(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.orgs.removeMember(
      orgId,
      req.user.userId,
      userId,
      req.user.isPlatformAdmin,
    );
  }

  @Delete(':orgId')
  deleteOrg(
    @Param('orgId') orgId: string,
    @Req() req: { user: { userId: string; isPlatformAdmin: boolean } },
  ) {
    return this.orgs.deleteOrg(
      orgId,
      req.user.userId,
      req.user.isPlatformAdmin,
    );
  }
}

/** 公开预览邀请（无需登录） */
@Controller('api/v1/invites')
export class OrgInvitesPublicController {
  constructor(private readonly orgs: OrgsService) {}

  @Get(':token')
  preview(@Param('token') token: string) {
    return this.orgs.getInvitePreview(token);
  }
}
