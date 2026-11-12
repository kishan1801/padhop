import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { HelipadsService } from './helipads.service';

function parseQueryNumber(value: string | undefined, name: string): number {
  if (!value?.trim()) {
    throw new BadRequestException(`${name} must be a valid number`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException(`${name} must be a valid number`);
  }

  return parsed;
}

@Controller('helipads')
export class HelipadsController {
  constructor(private helipadsService: HelipadsService) {}

  @Get()
  async list() {
    return this.helipadsService.listAll();
  }

  @Get('nearest')
  async nearest(
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Query('radiusKm') radiusKm?: string,
  ) {
    return this.helipadsService.findNearest(
      parseQueryNumber(lat, 'lat'),
      parseQueryNumber(lng, 'lng'),
      radiusKm === undefined
        ? undefined
        : parseQueryNumber(radiusKm, 'radiusKm'),
    );
  }

  @Get(':id/slots')
  async availableSlots(@Param('id') id: string) {
    return this.helipadsService.findAvailableSlots(id);
  }
}
