import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OperatorBookingsController } from './operator-bookings.controller';
import { ROLES_KEY } from '../auth/roles.decorator';
import { JwtOrSessionAuthGuard } from '../auth/jwt-or-session-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CsrfGuard } from '../auth/csrf.guard';
import { OriginGuard } from '../auth/origin.guard';

describe('OperatorBookingsController decisions', () => {
  const req = { user: { userId: 'user-1', role: 'operator' } };
  let operatorBookingsService: { detail: jest.Mock; list: jest.Mock };
  let bookingsService: { acceptRequest: jest.Mock; declineRequest: jest.Mock };
  let controller: OperatorBookingsController;

  const detailDto = {
    bookingId: 'booking-1',
    reference: 'PH-20261118-ABCDEFGH',
    status: 'accepted',
    price: 48000,
    createdAt: new Date(),
    requestedAt: new Date(),
    decisionDeadline: new Date(),
    passengerName: 'Asha Rao',
    origin: { id: 'h1', name: 'A', city: 'B' },
    destination: null,
    slot: { startTime: new Date(), endTime: new Date() },
    aircraft: { model: 'Bell 429', registration: 'VT-ABC1', capacity: 7 },
    acceptedAt: new Date(),
    declinedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    declineReason: null,
  };

  beforeEach(() => {
    operatorBookingsService = {
      detail: jest.fn().mockResolvedValue(detailDto),
      list: jest.fn(),
    };
    bookingsService = {
      acceptRequest: jest.fn(),
      declineRequest: jest.fn(),
    };
    controller = new OperatorBookingsController(
      operatorBookingsService as never,
      bookingsService as never,
    );
  });

  it('protects decision routes with auth, role, CSRF and Origin guards', () => {
    for (const handler of [
      OperatorBookingsController.prototype.accept,
      OperatorBookingsController.prototype.decline,
    ]) {
      const guards = Reflect.getMetadata('__guards__', handler) as unknown[];
      expect(guards).toEqual([
        JwtOrSessionAuthGuard,
        RolesGuard,
        CsrfGuard,
        OriginGuard,
      ]);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['operator']);
    }
  });

  it('derives the actor from the authenticated user and ignores client fields', async () => {
    bookingsService.acceptRequest.mockResolvedValue({
      kind: 'decided',
      bookingId: 'booking-1',
      idempotent: false,
    });

    const result = await controller.accept(req as never, 'booking-1');

    expect(bookingsService.acceptRequest).toHaveBeenCalledWith(
      'booking-1',
      'user-1',
    );
    expect(operatorBookingsService.detail).toHaveBeenCalledWith(
      'user-1',
      'booking-1',
    );
    expect(result).toEqual({ ...detailDto, idempotent: false });
  });

  it('passes the raw decline reason and respects the idempotent flag', async () => {
    bookingsService.declineRequest.mockResolvedValue({
      kind: 'decided',
      bookingId: 'booking-1',
      idempotent: true,
    });

    const result = await controller.decline(
      req as never,
      'booking-1',
      { reason: '  Unavailable  ', actorId: 'attacker' },
    );

    expect(bookingsService.declineRequest).toHaveBeenCalledWith(
      'booking-1',
      'user-1',
      '  Unavailable  ',
    );
    expect(result.idempotent).toBe(true);
  });

  it('committed lazy expiry is reported as 409, not success', async () => {
    bookingsService.acceptRequest.mockResolvedValue({
      kind: 'expired',
      bookingId: 'booking-1',
    });

    await expect(
      controller.accept(req as never, 'booking-1'),
    ).rejects.toThrow(ConflictException);
    expect(operatorBookingsService.detail).not.toHaveBeenCalled();
  });

  it('maps conflict, not-found and forbidden outcomes', async () => {
    bookingsService.acceptRequest
      .mockResolvedValueOnce({ kind: 'conflict', bookingId: 'booking-1' })
      .mockResolvedValueOnce({ kind: 'not-found' })
      .mockResolvedValueOnce({ kind: 'forbidden' });

    await expect(
      controller.accept(req as never, 'booking-1'),
    ).rejects.toThrow(ConflictException);
    await expect(
      controller.accept(req as never, 'booking-x'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      controller.accept(req as never, 'booking-1'),
    ).rejects.toThrow(ForbiddenException);
  });
});
