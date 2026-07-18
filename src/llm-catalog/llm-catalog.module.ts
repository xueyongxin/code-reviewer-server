import { Module } from '@nestjs/common';
import { LlmCatalogController } from './llm-catalog.controller';

@Module({
  controllers: [LlmCatalogController],
})
export class LlmCatalogModule {}
