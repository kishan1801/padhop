import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { OperatorBookingsService } from './operator-bookings.service';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

interface AuthenticatedRequest {
  user: { userId: string };
}

@Controller('operator/bookings')
export class OperatorBookingsController {
  constructor(private readonly operatorBookingsService: OperatorBookingsService) {}

  @UseGuards(JwtOrSessionAuthGuard, RolesGuard)
  @Roles('operator')
  @Get()
  async list(
    @Request() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.operatorBookingsService.list(req.user.userId, {
      status,
      limit,
      cursor,
    });
  }

  @UseGuards(JwtOrSessionAuthGuard, RolesGuard)
  @Roles('operator')
  @Get(':id')
  async detail(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.operatorBookingsService.detail(req.user.userId, id);
  }
}
