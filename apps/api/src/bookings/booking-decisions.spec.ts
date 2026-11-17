import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PricingService } from '../pricing/pricing.service';

type Outcome = { kind: string; idempotent?: boolean };

describe('BookingsService operator decisions', () => {
  let service: BookingsService;
  let prisma: { $transaction: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock; exists: jest.Mock };
  let tx: {
    operator: { findUnique: jest.Mock };
    booking: {
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    availabilitySlot: { updateMany: jest.Mock };
    bookingEvent: { create: jest.Mock };
  };

  const now = new Date('2026-11-18T12:00:00Z');

  beforeEach(async () => {
    tx = {
      operator: { findUnique: jest.fn().mockResolvedValue({ id: 'operator-1', verified: true }) },
      booking: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ slotId: 'slot-1' }),
      },
      availabilitySlot: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bookingEvent: { create: jest.fn().mockResolvedValue({ id: 'event-1' }) },
    };
    prisma = {
      $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) => cb(tx)),
    };
    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: PricingService, useValue: {} },
      ],
    }).compile();

    service = module.get(BookingsService);
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('accept', () => {
    it('accepts a requested booking without modifying the slot', async () => {
      tx.booking.updateMany.mockResolvedValue({ count: 1 });

      const outcome = (await service.acceptRequest('booking-1', 'user-1')) as Outcome;

      expect(outcome).toEqual({
        kind: 'decided',
        bookingId: 'booking-1',
        idempotent: false,
      });
      expect(tx.booking.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'booking-1',
          status: 'requested',
          decisionDeadline: { gt: now },
          slot: { aircraft: { operatorId: 'operator-1' } },
        },
        data: { status: 'accepted', acceptedAt: now },
      });
      expect(tx.availabilitySlot.updateMany).not.toHaveBeenCalled();
      expect(tx.bookingEvent.create).toHaveBeenCalledTimes(1);
      expect(tx.bookingEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bookingId: 'booking-1',
          actorId: 'user-1',
          actorRole: 'operator',
          type: 'accepted',
          fromStatus: 'requested',
          toStatus: 'accepted',
        }),
      });
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('returns forbidden for an unverified operator', async () => {
      tx.operator.findUnique.mockResolvedValue({ id: 'operator-1', verified: false });

      const outcome = (await service.acceptRequest('booking-1', 'user-1')) as Outcome;

      expect(outcome.kind).toBe('forbidden');
      expect(tx.booking.updateMany).not.toHaveBeenCalled();
    });

    it('returns forbidden when no operator record exists', async () => {
      tx.operator.findUnique.mockResolvedValue(null);

      const outcome = (await service.acceptRequest('booking-1', 'user-1')) as Outcome;

      expect(outcome.kind).toBe('forbidden');
    });

    it('returns not-found for unknown or non-owned bookings', async () => {
      const outcome = (await service.acceptRequest('booking-x', 'user-1')) as Outcome;

      expect(outcome.kind).toBe('not-found');
      expect(tx.booking.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'booking-x',
          slot: { aircraft: { operatorId: 'operator-1' } },
        },
        select: { id: true, status: true, decisionDeadline: true },
      });
    });

    it('lazily expires an overdue requested booking before conflict', async () => {
      tx.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        status: 'requested',
        decisionDeadline: new Date(now.getTime() - 1),
      });
      tx.booking.updateMany
        .mockResolvedValueOnce({ count: 0 }) // decision claim
        .mockResolvedValueOnce({ count: 1 }); // expiry claim

      const outcome = (await service.acceptRequest('booking-1', 'user-1')) as Outcome;

      expect(outcome.kind).toBe('expired');
      const expiryCall = tx.booking.updateMany.mock.calls[1][0];
      expect(expiryCall).toEqual({
        where: {
          id: 'booking-1',
          status: 'requested',
          decisionDeadline: { lte: now },
        },
        data: { status: 'expired' },
      });
      expect(tx.availabilitySlot.updateMany).toHaveBeenCalledWith({
        where: { id: 'slot-1', status: 'held' },
        data: { status: 'available' },
      });
      expect(tx.bookingEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'expired',
          actorId: null,
          actorRole: 'system',
          fromStatus: 'requested',
          toStatus: 'expired',
        }),
      });
    });

    it('rejects when the lazy expiry slot release fails', async () => {
      tx.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        status: 'requested',
        decisionDeadline: new Date(now.getTime() - 1),
      });
      tx.booking.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      tx.availabilitySlot.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.acceptRequest('booking-1', 'user-1'),
      ).rejects.toThrow();
    });

    it('is idempotent when already accepted', async () => {
      tx.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        status: 'accepted',
        decisionDeadline: new Date(now.getTime() + 60_000),
      });

      const outcome = (await service.acceptRequest('booking-1', 'user-1')) as Outcome;

      expect(outcome).toEqual({
        kind: 'decided',
        bookingId: 'booking-1',
        idempotent: true,
      });
      expect(tx.bookingEvent.create).not.toHaveBeenCalled();
    });

    it('returns conflict when accepting a declined booking', async () => {
      tx.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        status: 'declined',
        decisionDeadline: new Date(now.getTime() + 60_000),
      });

      const outcome = (await service.acceptRequest('booking-1', 'user-1')) as Outcome;

      expect(outcome.kind).toBe('conflict');
      expect(tx.bookingEvent.create).not.toHaveBeenCalled();
    });

    it('rolls back when the accepted event write fails', async () => {
      tx.booking.updateMany.mockResolvedValue({ count: 1 });
      tx.bookingEvent.create.mockRejectedValue(new Error('event write failed'));

      await expect(
        service.acceptRequest('booking-1', 'user-1'),
      ).rejects.toThrow('event write failed');
    });

    it('does not modify legacy confirmed or cancelled bookings', async () => {
      for (const status of ['confirmed', 'cancelled']) {
        tx.booking.findFirst.mockResolvedValue({
          id: 'booking-1',
          status,
          decisionDeadline: null,
        });

        const outcome = (await service.acceptRequest('booking-1', 'user-1')) as Outcome;
        expect(outcome.kind).toBe('conflict');
      }
      expect(tx.bookingEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('decline', () => {
    function arrangeDeclineSuccess() {
      tx.booking.updateMany.mockResolvedValue({ count: 1 });
    }

    it('normalizes the reason and releases the held slot exactly once', async () => {
      arrangeDeclineSuccess();

      const outcome = (await service.declineRequest(
        'booking-1',
        'user-1',
        '  Aircraft\r\nunavailable   for this leg. ',
      )) as Outcome;

      expect(outcome).toEqual({
        kind: 'decided',
        bookingId: 'booking-1',
        idempotent: false,
      });
      expect(tx.booking.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'booking-1',
          status: 'requested',
          decisionDeadline: { gt: now },
          slot: { aircraft: { operatorId: 'operator-1' } },
        },
        data: { status: 'declined', declinedAt: now },
      });
      expect(tx.availabilitySlot.updateMany).toHaveBeenCalledWith({
        where: { id: 'slot-1', status: 'held' },
        data: { status: 'available' },
      });
      expect(tx.bookingEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'declined',
          actorId: 'user-1',
          actorRole: 'operator',
          reason: 'Aircraft unavailable for this leg.',
        }),
      });
    });

    it('rejects missing, non-string, and blank reasons before any transaction', async () => {
      for (const reason of [undefined, null, 42, {}, '   ', '\r\n\t']) {
        await expect(
          service.declineRequest('booking-1', 'user-1', reason),
        ).rejects.toThrow(BadRequestException);
      }
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('enforces the 500 character limit after normalization', async () => {
      await expect(
        service.declineRequest('booking-1', 'user-1', 'x'.repeat(501)),
      ).rejects.toThrow(BadRequestException);

      arrangeDeclineSuccess();
      await expect(
        service.declineRequest('booking-1', 'user-1', 'y'.repeat(500)),
      ).resolves.toEqual(
        expect.objectContaining({ kind: 'decided', idempotent: false }),
      );
    });

    it('rolls back when the slot release does not affect one row', async () => {
      arrangeDeclineSuccess();
      tx.availabilitySlot.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.declineRequest('booking-1', 'user-1', 'Unavailable'),
      ).rejects.toThrow();
      expect(tx.bookingEvent.create).not.toHaveBeenCalled();
    });

    it('rolls back when the declined event write fails', async () => {
      arrangeDeclineSuccess();
      tx.bookingEvent.create.mockRejectedValue(new Error('event write failed'));

      await expect(
        service.declineRequest('booking-1', 'user-1', 'Unavailable'),
      ).rejects.toThrow('event write failed');
    });

    it('is idempotent and preserves the original reason on repeat decline', async () => {
      tx.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        status: 'declined',
        decisionDeadline: new Date(now.getTime() + 60_000),
      });

      const outcome = (await service.declineRequest(
        'booking-1',
        'user-1',
        'A different reason',
      )) as Outcome;

      expect(outcome).toEqual({
        kind: 'decided',
        bookingId: 'booking-1',
        idempotent: true,
      });
      expect(tx.availabilitySlot.updateMany).not.toHaveBeenCalled();
      expect(tx.bookingEvent.create).not.toHaveBeenCalled();
    });

    it('returns conflict when declining an accepted booking', async () => {
      tx.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        status: 'accepted',
        decisionDeadline: new Date(now.getTime() + 60_000),
      });

      const outcome = (await service.declineRequest(
        'booking-1',
        'user-1',
        'Too late',
      )) as Outcome;

      expect(outcome.kind).toBe('conflict');
      expect(tx.bookingEvent.create).not.toHaveBeenCalled();
    });

    it('lazily expires overdue requests before a decline conflict', async () => {
      tx.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        status: 'requested',
        decisionDeadline: new Date(now.getTime() - 1),
      });
      tx.booking.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const outcome = (await service.declineRequest(
        'booking-1',
        'user-1',
        'Unavailable',
      )) as Outcome;

      expect(outcome.kind).toBe('expired');
    });
  });
});
