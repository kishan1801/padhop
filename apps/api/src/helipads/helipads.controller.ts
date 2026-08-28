import { Controller, Get, Param, Query } from '@nestjs/common';
import { HelipadsService } from './helipads.service';

@Controller('helipads')
export class HelipadsController {
  constructor(private helipadsService: HelipadsService) {}

  @Get('nearest')
  async nearest(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('radiusKm') radiusKm?: string,
  ) {
    return this.helipadsService.findNearest(
      parseFloat(lat),
      parseFloat(lng),
      radiusKm ? parseFloat(radiusKm) : undefined,
    );
  }

  @Get(':id/slots')
  async availableSlots(@Param('id') id: string) {
    return this.helipadsService.findAvailableSlots(id);
  }
}
