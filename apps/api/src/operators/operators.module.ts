import { Module } from '@nestjs/common';
import {
  OperatorsController,
  AdminOperatorsController,
} from './operators.controller';
import { OperatorsService } from './operators.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OperatorsController, AdminOperatorsController],
  providers: [OperatorsService],
})
export class OperatorsModule {}
