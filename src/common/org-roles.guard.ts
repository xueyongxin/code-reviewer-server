import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);

export const PLATFORM_ADMIN_KEY = 'platformAdmin';
export const PlatformAdmin = () => SetMetadata(PLATFORM_ADMIN_KEY, true);

@Injectable()
export class OrgRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirePlatform = this.reflector.getAllAndOverride<boolean>(
      PLATFORM_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );
    const roles = this.reflector.getAllAndOverride<OrgRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<{
      user?: { userId: string; isPlatformAdmin?: boolean };
      params: { orgId?: string; id?: string };
      body: { orgId?: string };
      query: { orgId?: string };
    }>();

    if (requirePlatform) {
      if (!req.user?.isPlatformAdmin) {
        throw new ForbiddenException('需要平台管理员权限');
      }
      return true;
    }

    if (!roles?.length) return true;

    const orgId =
      req.params.orgId ||
      req.params.id ||
      req.body?.orgId ||
      (typeof req.query.orgId === 'string' ? req.query.orgId : undefined);

    if (!orgId) {
      throw new ForbiddenException('缺少组织 ID');
    }

    if (req.user?.isPlatformAdmin) return true;

    const member = await this.prisma.orgMember.findUnique({
      where: {
        orgId_userId: { orgId, userId: req.user!.userId },
      },
    });
    if (!member) {
      throw new ForbiddenException('你不是该组织成员');
    }
    if (!roles.includes(member.role)) {
      throw new ForbiddenException('权限不足');
    }
    return true;
  }
}
