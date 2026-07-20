import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgsModule } from '../orgs/orgs.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [AuditModule, OrgsModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
