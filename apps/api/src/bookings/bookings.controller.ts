import { Controller, Post, Param } from '@nestjs/common';
import { BookingsService } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(private bookingsService: BookingsService) { }

  @Post('hold/:slotId')
  async hold(@Param('slotId') slotId: string) {
    return this.bookingsService.holdSlot(slotId);
  }

  @Post('confirm/:slotId')
  async confirm(@Param('slotId') slotId: string) {
    return this.bookingsService.confirmSlot(slotId);
  }
}
