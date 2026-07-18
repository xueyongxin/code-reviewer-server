import { Module } from '@nestjs/common';
import { ReviewMethodsController } from './review-methods.controller';

@Module({
  controllers: [ReviewMethodsController],
})
export class ReviewMethodsModule {}
