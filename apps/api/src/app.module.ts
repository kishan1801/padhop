import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HelipadsModule } from './helipads/helipads.module';
import { BookingsModule } from './bookings/bookings.module';
import { AuthModule } from './auth/auth.module';
import { AircraftModule } from './aircraft/aircraft.module';
import { OperatorsModule } from './operators/operators.module';
import { WeatherModule } from './weather/weather.module';
import { PricingModule } from './pricing/pricing.module';
import { ChatModule } from './chat/chat.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }]),
    PrismaModule,
    RedisModule,
    HelipadsModule,
    BookingsModule,
    AuthModule,
    AircraftModule,
    OperatorsModule,
    WeatherModule,
    PricingModule,
    ChatModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule { }