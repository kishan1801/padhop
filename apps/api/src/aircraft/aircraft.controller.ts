import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AircraftService } from './aircraft.service';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session-auth.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { OriginGuard } from '../auth/origin.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('aircraft')
export class AircraftController {
  constructor(private aircraftService: AircraftService) {}

  @UseGuards(JwtOrSessionAuthGuard, RolesGuard)
  @Roles('operator')
  @Get('mine')
  async listMine(@Request() req) {
    return this.aircraftService.listMine(req.user.userId);
  }

  @UseGuards(JwtOrSessionAuthGuard, RolesGuard, CsrfGuard, OriginGuard)
  @Roles('operator')
  @Post()
  async create(
    @Request() req,
    @Body() body: { model: string; capacity: number; registration: string },
  ) {
    return this.aircraftService.create(
      req.user.userId,
      body.model,
      body.capacity,
      body.registration,
    );
  }

  @UseGuards(JwtOrSessionAuthGuard, RolesGuard, CsrfGuard, OriginGuard)
  @Roles('operator')
  @Post(':aircraftId/slots')
  async createSlot(
    @Request() req,
    @Param('aircraftId') aircraftId: string,
    @Body()
    body: {
      helipadId: string;
      destinationHelipadId: string;
      startTime: string;
      endTime: string;
    },
  ) {
    return this.aircraftService.createSlot(
      req.user.userId,
      aircraftId,
      body.helipadId,
      body.destinationHelipadId,
      new Date(body.startTime),
      new Date(body.endTime),
    );
  }
}
