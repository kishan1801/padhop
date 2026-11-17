import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { OperatorBookingsService } from './operator-bookings.service';
import { BookingsService } from '../bookings/bookings.service';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { OriginGuard } from '../auth/origin.guard';
import { Roles } from '../auth/roles.decorator';
import type {
  DeclineBookingRequestDto,
  OperatorBookingDecisionDto,
} from './dto/operator-booking.dto';

interface AuthenticatedRequest {
  user: { userId: string };
}

type DecisionOutcome =
  | { kind: 'decided'; bookingId: string; idempotent: boolean }
  | { kind: 'expired'; bookingId: string }
  | { kind: 'conflict'; bookingId: string }
  | { kind: 'not-found' }
  | { kind: 'forbidden' };

@Controller('operator/bookings')
export class OperatorBookingsController {
  constructor(
    private readonly operatorBookingsService: OperatorBookingsService,
    private readonly bookingsService: BookingsService,
  ) {}

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

  @UseGuards(JwtOrSessionAuthGuard, RolesGuard, CsrfGuard, OriginGuard)
  @Roles('operator')
  @Post(':id/accept')
  async accept(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<OperatorBookingDecisionDto> {
    const outcome = await this.bookingsService.acceptRequest(
      id,
      req.user.userId,
    );
    return this.decisionResponse(outcome, req.user.userId, id);
  }

  @UseGuards(JwtOrSessionAuthGuard, RolesGuard, CsrfGuard, OriginGuard)
  @Roles('operator')
  @Post(':id/decline')
  async decline(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: DeclineBookingRequestDto,
  ): Promise<OperatorBookingDecisionDto> {
    const outcome = await this.bookingsService.declineRequest(
      id,
      req.user.userId,
      body?.reason,
    );
    return this.decisionResponse(outcome, req.user.userId, id);
  }

  private async decisionResponse(
    outcome: DecisionOutcome,
    userId: string,
    bookingId: string,
  ): Promise<OperatorBookingDecisionDto> {
    switch (outcome.kind) {
      case 'decided': {
        const booking = await this.operatorBookingsService.detail(
          userId,
          bookingId,
        );
        return { ...booking, idempotent: outcome.idempotent };
      }
      case 'expired':
        // The expiry transaction has committed; only now do we reject.
        throw new ConflictException('Response deadline has passed');
      case 'conflict':
        throw new ConflictException(
          'Booking is not awaiting this decision',
        );
      case 'not-found':
        throw new NotFoundException('Booking not found');
      case 'forbidden':
        throw new ForbiddenException('Operator verification required');
      default:
        throw new ConflictException('Booking decision could not be completed');
    }
  }
}
