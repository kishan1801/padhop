import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HelipadsModule } from './helipads/helipads.module';
import { BookingsModule } from './bookings/bookings.module';
import { AuthModule } from './auth/auth.module';
import { AircraftModule } from './aircraft/aircraft.module';
import { ScheduleModule } from '@nestjs/schedule';
import { OperatorsModule } from './operators/operators.module'
import { WeatherModule } from './weather/weather.module'

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    HelipadsModule,
    BookingsModule,
    AuthModule,
    AircraftModule,
    OperatorsModule,
    WeatherModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }