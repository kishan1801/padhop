import { Body, Controller, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AircraftService } from './aircraft.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('aircraft')
export class AircraftController {
  constructor(private aircraftService: AircraftService) { }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('operator')
  @Post()
  async create(
    @Request() req,
    @Body() body: { model: string; capacity: number; registration: string },
  ) {
    return this.aircraftService.create(req.user.userId, body.model, body.capacity, body.registration);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('operator')
  @Post(':aircraftId/slots')
  async createSlot(
    @Request() req,
    @Param('aircraftId') aircraftId: string,
    @Body() body: { helipadId: string; startTime: string; endTime: string },
  ) {
    return this.aircraftService.createSlot(
      req.user.userId,
      aircraftId,
      body.helipadId,
      new Date(body.startTime),
      new Date(body.endTime),
    );
  }
}