import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConfigCenterController } from './config-center.controller';
import { ConfigCenterService } from './config-center.service';

@Module({
  imports: [AuditModule],
  controllers: [ConfigCenterController],
  providers: [ConfigCenterService],
  exports: [ConfigCenterService],
})
export class ConfigCenterModule {}
