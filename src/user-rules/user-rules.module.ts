import { Module } from '@nestjs/common';
import { UserRulesController } from './user-rules.controller';

@Module({
  controllers: [UserRulesController],
})
export class UserRulesModule {}
