import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import {
  OrgInvitesPublicController,
  OrgsController,
} from './orgs.controller';
import { OrgsService } from './orgs.service';

@Module({
  imports: [AuditModule],
  controllers: [OrgsController, OrgInvitesPublicController],
  providers: [OrgsService],
  exports: [OrgsService],
})
export class OrgsModule {}
