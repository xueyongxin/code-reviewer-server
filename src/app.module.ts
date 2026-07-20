import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { ConfigCenterModule } from './config-center/config-center.module';
import { HealthModule } from './health/health.module';
import { ChatCommandsModule } from './chat-commands/chat-commands.module';
import { LlmCatalogModule } from './llm-catalog/llm-catalog.module';
import { McpCatalogModule } from './mcp-catalog/mcp-catalog.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrgsModule } from './orgs/orgs.module';
import { PrismaModule } from './prisma/prisma.module';
import { PublicModule } from './public/public.module';
import { ReportsModule } from './reports/reports.module';
import { ReviewMethodsModule } from './review-methods/review-methods.module';
import { SyncModule } from './sync/sync.module';
import { UserRulesModule } from './user-rules/user-rules.module';
import { UsersModule } from './users/users.module';
import { CodeRepoCatalogModule } from './code-repo-catalog/code-repo-catalog.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuditModule,
    AuthModule,
    UsersModule,
    OrgsModule,
    ConfigCenterModule,
    ReportsModule,
    SyncModule,
    BillingModule,
    McpCatalogModule,
    LlmCatalogModule,
    ChatCommandsModule,
    ReviewMethodsModule,
    UserRulesModule,
    NotificationsModule,
    AdminModule,
    PublicModule,
    CodeRepoCatalogModule,
  ],
})
export class AppModule {}

