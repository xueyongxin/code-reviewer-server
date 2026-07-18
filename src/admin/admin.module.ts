import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgsModule } from '../orgs/orgs.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [AuditModule, OrgsModule],
  controllers: [AdminController],
})
export class AdminModule {}
