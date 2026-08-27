import { Module } from '@nestjs/common';
import { OperatorsController, AdminOperatorsController } from './operators.controller';
import { OperatorsService } from './operators.service';

@Module({
  controllers: [OperatorsController, AdminOperatorsController],
  providers: [OperatorsService],
})
export class OperatorsModule { }