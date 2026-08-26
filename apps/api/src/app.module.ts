import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HelipadsModule } from './helipads/helipads.module';

@Module({
  imports: [PrismaModule, HelipadsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
