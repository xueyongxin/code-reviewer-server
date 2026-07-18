import { Module } from '@nestjs/common';
import { McpCatalogController } from './mcp-catalog.controller';

@Module({
  controllers: [McpCatalogController],
})
export class McpCatalogModule {}
