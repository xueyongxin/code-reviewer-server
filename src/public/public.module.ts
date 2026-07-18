import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PublicController } from './public.controller';

@Module({
  imports: [AuditModule],
  controllers: [PublicController],
})
export class PublicModule {}
