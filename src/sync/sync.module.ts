import { Module } from '@nestjs/common';
import { ConfigCenterModule } from '../config-center/config-center.module';
import { ReportsModule } from '../reports/reports.module';
import { SyncController } from './sync.controller';

@Module({
  imports: [ConfigCenterModule, ReportsModule],
  controllers: [SyncController],
})
export class SyncModule {}
