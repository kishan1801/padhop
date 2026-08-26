import { Controller, Post, Param, UseGuards, Request } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('bookings')
export class BookingsController {
  constructor(private bookingsService: BookingsService) { }

  @UseGuards(JwtAuthGuard)
  @Post('hold/:slotId')
  async hold(@Param('slotId') slotId: string, @Request() req) {
    return this.bookingsService.holdSlot(slotId, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('confirm/:slotId')
  async confirm(@Param('slotId') slotId: string, @Request() req) {
    return this.bookingsService.confirmSlot(slotId, req.user.userId);
  }
}