import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HelipadsModule } from './helipads/helipads.module';
import { RedisModule } from './redis/redis.module';
import { BookingsModule } from './bookings/bookings.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [PrismaModule, RedisModule, HelipadsModule, BookingsModule, ScheduleModule.forRoot()], controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
