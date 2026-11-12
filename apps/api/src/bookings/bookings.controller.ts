import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

interface AuthenticatedRequest {
  user: { userId: string };
}

@Controller('bookings')
export class BookingsController {
  constructor(private bookingsService: BookingsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  async mine(@Request() req: AuthenticatedRequest) {
    return this.bookingsService.getPassengerBookings(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('hold/:slotId')
  async hold(
    @Param('slotId') slotId: string,
    @Request() req: AuthenticatedRequest,
    @Body() body: { destinationHelipadId?: string },
  ) {
    return this.bookingsService.holdSlot(
      slotId,
      req.user.userId,
      body.destinationHelipadId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('confirm/:slotId')
  async confirm(
    @Param('slotId') slotId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.bookingsService.confirmSlot(slotId, req.user.userId);
  }
}
