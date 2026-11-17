import { Module } from '@nestjs/common';
import { OperatorBookingsController } from './operator-bookings.controller';
import { OperatorBookingsService } from './operator-bookings.service';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [AuthModule, BookingsModule],
  controllers: [OperatorBookingsController],
  providers: [OperatorBookingsService],
})
export class OperatorBookingsModule {}
