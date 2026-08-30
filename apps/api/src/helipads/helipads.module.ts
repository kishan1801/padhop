import { Module } from '@nestjs/common';
import { HelipadsController } from './helipads.controller';
import { HelipadsService } from './helipads.service';

@Module({
  controllers: [HelipadsController],
  providers: [HelipadsService],
  exports: [HelipadsService],
})
export class HelipadsModule { }