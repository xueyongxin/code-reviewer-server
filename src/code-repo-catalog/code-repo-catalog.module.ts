import { Module } from '@nestjs/common';
import { CodeRepoCatalogController } from './code-repo-catalog.controller';

@Module({
  controllers: [CodeRepoCatalogController],
})
export class CodeRepoCatalogModule {}
