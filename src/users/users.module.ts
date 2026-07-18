import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UserMcpController } from './user-mcp.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, UserMcpController],
})
export class UsersModule {}
