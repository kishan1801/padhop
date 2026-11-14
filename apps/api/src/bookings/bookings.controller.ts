import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import type { HoldBookingDto } from './dto/hold-booking.dto';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { OriginGuard } from '../auth/origin.guard';

interface AuthenticatedRequest {
  user: { userId: string };
}

@Controller('bookings')
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  @UseGuards(JwtOrSessionAuthGuard)
  @Get('mine')
  async mine(@Request() req: AuthenticatedRequest) {
    return this.bookingsService.getPassengerBookings(req.user.userId);
  }

  @UseGuards(JwtOrSessionAuthGuard)
  @Get(':id')
  async getById(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    const booking = await this.bookingsService.getPassengerBookingById(
      req.user.userId,
      id,
    );
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  @UseGuards(JwtOrSessionAuthGuard, CsrfGuard, OriginGuard)
  @Post('hold/:slotId')
  async hold(
    @Param('slotId') slotId: string,
    @Request() req: AuthenticatedRequest,
    @Body() body: HoldBookingDto,
  ) {
    return this.bookingsService.holdSlot(
      slotId,
      req.user.userId,
      body?.destinationHelipadId,
    );
  }

  @UseGuards(JwtOrSessionAuthGuard, CsrfGuard, OriginGuard)
  @Post('confirm/:slotId')
  async confirm(
    @Param('slotId') slotId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.confirmSlot(slotId, req.user.userId);
  }
}
