import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() req: { user: { userId: string } }) {
    return this.prisma.notification.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Patch(':id/read')
  async markRead(
    @Param('id') id: string,
    @Req() req: { user: { userId: string } },
  ) {
    await this.prisma.notification.updateMany({
      where: { id, userId: req.user.userId },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @Post('read-all')
  async readAll(@Req() req: { user: { userId: string } }) {
    await this.prisma.notification.updateMany({
      where: { userId: req.user.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
