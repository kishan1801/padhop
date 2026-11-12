import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PricingService } from '../pricing/pricing.service';

describe('BookingsService', () => {
  let service: BookingsService;
  let prisma: {
    availabilitySlot: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    booking: {
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let redis: {
    set: jest.Mock;
    get: jest.Mock;
    del: jest.Mock;
    exists: jest.Mock;
  };
  let pricing: { calculatePrice: jest.Mock };
  const availableSlot = (overrides: Record<string, unknown> = {}) => ({
    id: 'slot-1',
    helipadId: 'helipad-1',
    status: 'available',
    startTime: new Date(Date.now() + 60_000),
    endTime: new Date(Date.now() + 120_000),
    aircraft: { capacity: 6 },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      availabilitySlot: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      booking: { findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      exists: jest.fn(),
    };
    pricing = {
      calculatePrice: jest.fn().mockResolvedValue({ totalPrice: 48000 }),
    };

    const module = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: PricingService, useValue: pricing },
      ],
    }).compile();

    service = module.get(BookingsService);
  });

  describe('getPassengerBookings', () => {
    it('returns only records selected for the authenticated passenger', async () => {
      const ownedBooking = {
        id: 'booking-1',
        status: 'confirmed',
        price: 48000,
        createdAt: new Date('2026-11-12T10:00:00Z'),
        slot: {
          startTime: new Date('2026-11-20T10:00:00Z'),
          endTime: new Date('2026-11-20T11:00:00Z'),
          aircraft: { model: 'Bell 407', capacity: 6 },
          helipad: { name: 'HAL Helipad', city: 'Bengaluru' },
        },
        destinationHelipad: { name: 'HAL Helipad', city: 'Bengaluru' },
      };
      const anotherPassengersBooking = { ...ownedBooking, id: 'booking-2' };
      prisma.booking.findMany.mockImplementation(
        async ({ where }: { where: { userId: string } }) =>
          where.userId === 'passenger-1'
            ? [ownedBooking]
            : [anotherPassengersBooking],
      );

      const result = await service.getPassengerBookings('passenger-1');

      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'passenger-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.map((booking) => booking.bookingId)).toEqual(['booking-1']);
      expect(result[0].price).toBe(48000);
    });
  });

  describe('holdSlot', () => {
    it('throws NotFoundException if the slot does not exist', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(null);

      await expect(service.holdSlot('missing-slot', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException if the slot is no longer available', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

      // Simulate the atomic UPDATE affecting zero rows - someone else got there first
      prisma.$transaction.mockImplementation(async (fn) => {
        return fn({
          availabilitySlot: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          booking: { create: jest.fn() },
        });
      });

      await expect(service.holdSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('succeeds and creates a booking when the slot is genuinely available', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation(async (fn) => {
        return fn({
          availabilitySlot: { updateMany },
          booking: {
            create: jest.fn().mockResolvedValue({ id: 'booking-1' }),
          },
        });
      });

      const result = await service.holdSlot('slot-1', 'user-1');

      expect(result.status).toBe('held');
      expect(result.bookingId).toBe('booking-1');
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            startTime: { gt: expect.any(Date) },
            endTime: { gt: expect.any(Date) },
          }),
        }),
      );
      expect(redis.set).toHaveBeenCalledWith(
        'hold:slot-1',
        'user-1',
        'EX',
        expect.any(Number),
      );
    });

    it('allows a new booking after a prior booking was cancelled', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());
      const bookingHistory = [
        {
          id: 'booking-cancelled',
          slotId: 'slot-1',
          status: 'cancelled',
        },
      ];
      const create = jest.fn().mockImplementation(async ({ data }) => {
        const hasActiveBooking = bookingHistory.some(
          (booking) =>
            booking.slotId === data.slotId &&
            (booking.status === 'held' || booking.status === 'confirmed'),
        );
        if (hasActiveBooking) throw new Error('Active booking already exists');

        const booking = {
          id: 'booking-new',
          slotId: data.slotId,
          status: 'held',
        };
        bookingHistory.push(booking);
        return booking;
      });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          availabilitySlot: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          booking: { create },
        }),
      );

      const result = await service.holdSlot('slot-1', 'user-2');

      expect(result.bookingId).toBe('booking-new');
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slotId: 'slot-1', userId: 'user-2' }),
        }),
      );
      expect(bookingHistory.map((booking) => booking.status)).toEqual([
        'cancelled',
        'held',
      ]);
    });

    it('rejects a slot whose start time has passed', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(
        availableSlot({ startTime: new Date(Date.now() - 1_000) }),
      );

      await expect(service.holdSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a slot that has already ended', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(
        availableSlot({
          startTime: new Date(Date.now() - 120_000),
          endTime: new Date(Date.now() - 60_000),
        }),
      );

      await expect(service.holdSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an invalid stored slot schedule', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(
        availableSlot({
          startTime: new Date('invalid'),
        }),
      );

      await expect(service.holdSlot('slot-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows only one of two concurrent holds for the same slot', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

      let available = true;
      const updateMany = jest.fn().mockImplementation(async () => {
        if (!available) return { count: 0 };
        available = false;
        return { count: 1 };
      });
      const create = jest.fn().mockResolvedValue({ id: 'booking-1' });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          availabilitySlot: { updateMany },
          booking: { create },
        }),
      );

      const outcomes = await Promise.allSettled([
        service.holdSlot('slot-1', 'user-1'),
        service.holdSlot('slot-1', 'user-2'),
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => outcome.status === 'rejected'),
      ).toHaveLength(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmSlot', () => {
    it('confirms the booking and deletes its Redis ownership key', async () => {
      redis.get.mockResolvedValue('user-1');
      const findFirst = jest.fn().mockResolvedValue({
        id: 'booking-1',
        userId: 'user-1',
        status: 'held',
      });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          booking: {
            findFirst,
            update: jest.fn().mockResolvedValue({
              id: 'booking-1',
              status: 'confirmed',
            }),
          },
          availabilitySlot: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        }),
      );

      await expect(service.confirmSlot('slot-1', 'user-1')).resolves.toEqual({
        bookingId: 'booking-1',
        slotId: 'slot-1',
        status: 'confirmed',
      });

      expect(redis.del).toHaveBeenCalledWith('hold:slot-1');
    });

    it('throws ConflictException if the Redis hold belongs to a different user', async () => {
      redis.get.mockResolvedValue('someone-else');

      await expect(service.confirmSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects an expired hold when its Redis key is missing', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.confirmSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('confirms the booking even if deleting the Redis key fails afterward', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      redis.get.mockResolvedValue('user-1');
      redis.del.mockRejectedValue(new Error('Redis unavailable'));
      const findFirst = jest.fn().mockResolvedValue({
        id: 'booking-1',
        userId: 'user-1',
        status: 'held',
      });
      const slotUpdate = jest.fn().mockResolvedValue({ count: 1 });
      const bookingUpdate = jest.fn().mockResolvedValue({
        id: 'booking-1',
        status: 'confirmed',
      });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          booking: {
            findFirst,
            update: bookingUpdate,
          },
          availabilitySlot: { updateMany: slotUpdate },
        }),
      );

      await expect(service.confirmSlot('slot-1', 'user-1')).resolves.toEqual({
        bookingId: 'booking-1',
        slotId: 'slot-1',
        status: 'confirmed',
      });

      expect(findFirst).toHaveBeenCalledWith({
        where: { slotId: 'slot-1', userId: 'user-1', status: 'held' },
      });
      expect(slotUpdate).toHaveBeenCalledWith({
        where: { id: 'slot-1', status: 'held' },
        data: { status: 'confirmed' },
      });
      expect(bookingUpdate).toHaveBeenCalledWith({
        where: { id: 'booking-1' },
        data: { status: 'confirmed' },
      });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('releaseExpiredHolds', () => {
    it('does not release a slot confirmed after cleanup fetched held slots', async () => {
      prisma.availabilitySlot.findMany.mockResolvedValue([{ id: 'slot-1' }]);
      redis.exists.mockResolvedValue(0);
      const slotUpdate = jest.fn().mockResolvedValue({ count: 0 });
      const bookingUpdateMany = jest.fn();
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          availabilitySlot: { updateMany: slotUpdate },
          booking: { updateMany: bookingUpdateMany },
        }),
      );

      await service.releaseExpiredHolds();

      expect(prisma.availabilitySlot.findMany).toHaveBeenCalledWith({
        where: { status: 'held' },
        select: { id: true },
      });
      expect(slotUpdate).toHaveBeenCalledWith({
        where: { id: 'slot-1', status: 'held' },
        data: { status: 'available' },
      });
      expect(bookingUpdateMany).not.toHaveBeenCalled();
    });
  });
});
