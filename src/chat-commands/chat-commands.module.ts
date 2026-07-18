import { Module } from '@nestjs/common';
import { ChatCommandsController } from './chat-commands.controller';

@Module({
  controllers: [ChatCommandsController],
})
export class ChatCommandsModule {}
