import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OperatorBookingsService } from './operator-bookings.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OperatorBookingsService', () => {
  let service: OperatorBookingsService;
  let prisma: {
    operator: { findUnique: jest.Mock };
    booking: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update?: jest.Mock;
      create?: jest.Mock;
      updateMany?: jest.Mock;
    };
  };

  const record = (overrides: Record<string, unknown> = {}) => ({
    id: 'booking-1',
    reference: 'PH-20261118-ABCDEFGH',
    status: 'requested',
    price: 48000,
    createdAt: new Date('2026-11-18T09:00:00Z'),
    requestedAt: new Date('2026-11-18T10:00:00Z'),
    decisionDeadline: new Date('2026-11-19T10:00:00Z'),
    acceptedAt: null,
    declinedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    user: { name: 'Asha Rao' },
    slot: {
      startTime: new Date('2026-11-21T10:00:00Z'),
      endTime: new Date('2026-11-21T11:00:00Z'),
      aircraft: { model: 'Bell 429', registration: 'VT-ABC1', capacity: 7 },
      helipad: { id: 'helipad-1', name: 'HAL Helipad', city: 'Bengaluru' },
    },
    destinationHelipad: {
      id: 'helipad-2',
      name: 'Kempegowda Airport Helipad',
      city: 'Bengaluru',
    },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      operator: { findUnique: jest.fn() },
      booking: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        OperatorBookingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(OperatorBookingsService);
    prisma.operator.findUnique.mockResolvedValue({ id: 'operator-1' });
  });

  describe('list', () => {
    it('scopes the query to the authenticated operator and defaults to requested', async () => {
      prisma.booking.findMany.mockResolvedValue([record()]);

      const result = await service.list('user-1', {});

      expect(prisma.operator.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { id: true },
      });
      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'requested',
            slot: { aircraft: { operatorId: 'operator-1' } },
          },
          orderBy: [{ decisionDeadline: 'asc' }, { id: 'asc' }],
          take: 21,
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          bookingId: 'booking-1',
          reference: 'PH-20261118-ABCDEFGH',
          status: 'requested',
          price: 48000,
          passengerName: 'Asha Rao',
          destination: expect.objectContaining({ id: 'helipad-2' }),
        }),
      );
    });

    it('only selects passenger display name', async () => {
      prisma.booking.findMany.mockResolvedValue([]);

      await service.list('user-1', {});

      const query = prisma.booking.findMany.mock.calls[0][0];
      expect(query.select.user).toEqual({ select: { name: true } });
      const serialized = JSON.stringify(query);
      expect(serialized).not.toMatch(/email|phone|password/i);
    });

    it('rejects missing operator relationships', async () => {
      prisma.operator.findUnique.mockResolvedValue(null);

      await expect(service.list('passenger-1', {})).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.booking.findMany).not.toHaveBeenCalled();
    });

    it('rejects unknown status filters', async () => {
      await expect(service.list('user-1', { status: 'bogus' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('validates limit values and defaults to 20', async () => {
      await service.list('user-1', {});
      expect(prisma.booking.findMany.mock.calls[0][0].take).toBe(21);

      await expect(service.list('user-1', { limit: '0' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.list('user-1', { limit: '51' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.list('user-1', { limit: 'abc' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('uses createdAt ordering for history statuses', async () => {
      prisma.booking.findMany.mockResolvedValue([record({ status: 'accepted' })]);

      await service.list('user-1', { status: 'accepted' });

      const query = prisma.booking.findMany.mock.calls[0][0];
      expect(query.where.status).toBe('accepted');
      expect(query.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    });

    it('paginates with an opaque cursor and no duplicates', async () => {
      const first = [
        record({ id: 'a', decisionDeadline: new Date('2026-11-19T10:00:00Z') }),
        record({ id: 'b', decisionDeadline: new Date('2026-11-19T11:00:00Z') }),
        record({ id: 'c', decisionDeadline: new Date('2026-11-19T12:00:00Z') }),
      ];
      prisma.booking.findMany
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce([record({ id: 'c' })]);

      const page1 = await service.list('user-1', { limit: '2' });
      expect(page1.items.map((item) => item.bookingId)).toEqual(['a', 'b']);
      expect(page1.nextCursor).toBeTruthy();

      const page2 = await service.list('user-1', {
        limit: '2',
        cursor: page1.nextCursor ?? undefined,
      });
      const all = [
        ...page1.items.map((item) => item.bookingId),
        ...page2.items.map((item) => item.bookingId),
      ];
      expect(new Set(all).size).toBe(all.length);
      expect(prisma.booking.findMany.mock.calls[1][0].where.OR).toEqual([
        { decisionDeadline: { gt: new Date('2026-11-19T11:00:00Z') } },
        {
          decisionDeadline: new Date('2026-11-19T11:00:00Z'),
          id: { gt: 'b' },
        },
      ]);
    });

    it('rejects malformed cursors', async () => {
      await expect(
        service.list('user-1', { cursor: 'not-a-cursor' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('performs no write operations', async () => {
      prisma.booking.findMany.mockResolvedValue([]);

      await service.list('user-1', {});

      expect(prisma.booking.create).not.toHaveBeenCalled();
      expect(prisma.booking.update).not.toHaveBeenCalled();
      expect(prisma.booking.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('detail', () => {
    it('returns 404 for non-owned or unknown bookings', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await expect(service.detail('user-1', 'booking-x')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'booking-x',
            slot: { aircraft: { operatorId: 'operator-1' } },
          },
        }),
      );
    });

    it('returns a passenger-safe decline reason and timestamps', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        ...record({ status: 'declined', declinedAt: new Date('2026-11-19T09:00:00Z') }),
        events: [{ reason: 'Aircraft unavailable for this leg.' }],
      });

      const result = await service.detail('user-1', 'booking-1');

      expect(result.declineReason).toBe('Aircraft unavailable for this leg.');
      expect(result.declinedAt).toEqual(new Date('2026-11-19T09:00:00Z'));
      const query = prisma.booking.findFirst.mock.calls[0][0];
      expect(query.select.events).toEqual({
        where: { type: 'declined', reason: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { reason: true },
      });
      expect(JSON.stringify(query.select)).not.toMatch(/email|phone|password/i);
    });

    it('handles a missing decline event safely', async () => {
      prisma.booking.findFirst.mockResolvedValue({ ...record(), events: [] });

      const result = await service.detail('user-1', 'booking-1');

      expect(result.declineReason).toBeNull();
      expect(result.acceptedAt).toBeNull();
    });

    it('rejects missing operator relationships', async () => {
      prisma.operator.findUnique.mockResolvedValue(null);

      await expect(service.detail('passenger-1', 'booking-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
