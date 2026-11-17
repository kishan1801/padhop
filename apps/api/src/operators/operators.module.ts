import { Module } from '@nestjs/common';
import {
  OperatorsController,
  AdminOperatorsController,
} from './operators.controller';
import { OperatorsService } from './operators.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [OperatorsController, AdminOperatorsController],
  providers: [OperatorsService],
})
export class OperatorsModule {}
