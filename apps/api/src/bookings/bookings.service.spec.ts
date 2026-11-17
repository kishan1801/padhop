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
    helipad: {
      findUnique: jest.Mock;
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
    destinationHelipadId: 'helipad-2',
    status: 'available',
    startTime: new Date(Date.now() + 60_000),
    endTime: new Date(Date.now() + 120_000),
    aircraft: { capacity: 6 },
    helipad: { id: 'helipad-1', name: 'HAL Helipad', city: 'Bengaluru' },
    destinationHelipad: {
      id: 'helipad-2',
      name: 'Electronic City Helipad',
      city: 'Bengaluru',
    },
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      availabilitySlot: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      booking: { findMany: jest.fn(), findFirst: jest.fn() },
      helipad: {
        findUnique: jest.fn().mockResolvedValue({ id: 'helipad-2' }),
      },
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
          aircraft: {
            model: 'Bell 407',
            capacity: 6,
            registration: 'VT-TEST1',
          },
          operator: { companyName: 'Test Charter Co' },
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

    it('returns aircraft registration', async () => {
      const ownedBooking = {
        id: 'booking-1',
        status: 'confirmed',
        price: 48000,
        createdAt: new Date('2026-11-12T10:00:00Z'),
        slot: {
          startTime: new Date('2026-11-20T10:00:00Z'),
          endTime: new Date('2026-11-20T11:00:00Z'),
          aircraft: {
            model: 'Bell 407',
            capacity: 6,
            registration: 'VT-ABC1',
          },
          operator: { companyName: 'Test Charter Co' },
          helipad: { name: 'HAL Helipad', city: 'Bengaluru' },
        },
        destinationHelipad: { name: 'HAL Helipad', city: 'Bengaluru' },
      };
      prisma.booking.findMany.mockResolvedValue([ownedBooking]);

      const result = await service.getPassengerBookings('passenger-1');

      expect(result[0].slot.aircraft.registration).toBe('VT-ABC1');
    });

    it('returns null aircraft registration when absent', async () => {
      const ownedBooking = {
        id: 'booking-1',
        status: 'confirmed',
        price: 48000,
        createdAt: new Date('2026-11-12T10:00:00Z'),
        slot: {
          startTime: new Date('2026-11-20T10:00:00Z'),
          endTime: new Date('2026-11-20T11:00:00Z'),
          aircraft: {
            model: 'Bell 407',
            capacity: 6,
            registration: null,
          },
          operator: { companyName: 'Test Charter Co' },
          helipad: { name: 'HAL Helipad', city: 'Bengaluru' },
        },
        destinationHelipad: { name: 'HAL Helipad', city: 'Bengaluru' },
      };
      prisma.booking.findMany.mockResolvedValue([ownedBooking]);

      const result = await service.getPassengerBookings('passenger-1');

      expect(result[0].slot.aircraft.registration).toBeNull();
    });

    it('returns operator companyName', async () => {
      const ownedBooking = {
        id: 'booking-1',
        status: 'confirmed',
        price: 48000,
        createdAt: new Date('2026-11-12T10:00:00Z'),
        slot: {
          startTime: new Date('2026-11-20T10:00:00Z'),
          endTime: new Date('2026-11-20T11:00:00Z'),
          aircraft: {
            model: 'Bell 407',
            capacity: 6,
            registration: 'VT-TEST1',
            operator: { companyName: 'SkyCharters Pvt Ltd' },
          },
          helipad: { name: 'HAL Helipad', city: 'Bengaluru' },
        },
        destinationHelipad: { name: 'HAL Helipad', city: 'Bengaluru' },
      };
      prisma.booking.findMany.mockResolvedValue([ownedBooking]);

      const result = await service.getPassengerBookings('passenger-1');

      expect(result[0].slot.operator?.companyName).toBe('SkyCharters Pvt Ltd');
    });

    it('returns null operator when absent', async () => {
      const ownedBooking = {
        id: 'booking-1',
        status: 'confirmed',
        price: 48000,
        createdAt: new Date('2026-11-12T10:00:00Z'),
        slot: {
          startTime: new Date('2026-11-20T10:00:00Z'),
          endTime: new Date('2026-11-20T11:00:00Z'),
          aircraft: {
            model: 'Bell 407',
            capacity: 6,
            registration: 'VT-TEST1',
            operator: null,
          },
          helipad: { name: 'HAL Helipad', city: 'Bengaluru' },
        },
        destinationHelipad: { name: 'HAL Helipad', city: 'Bengaluru' },
      };
      prisma.booking.findMany.mockResolvedValue([ownedBooking]);

      const result = await service.getPassengerBookings('passenger-1');

      expect(result[0].slot.operator).toBeNull();
    });
  });

  describe('getPassengerBookingById', () => {
    const fullBooking = {
      id: 'booking-1',
      reference: 'PH-20261113-ABC12345',
      status: 'confirmed',
      price: 48000,
      createdAt: new Date('2026-11-12T10:00:00Z'),
      slot: {
        startTime: new Date('2026-11-20T10:00:00Z'),
        endTime: new Date('2026-11-20T11:00:00Z'),
        aircraft: {
          model: 'Bell 407',
          capacity: 6,
          registration: 'VT-TEST1',
          operator: { companyName: 'Test Charter Co' },
        },
        helipad: { id: 'origin-1', name: 'HAL Helipad', city: 'Bengaluru' },
      },
      destinationHelipad: {
        id: 'destination-1',
        name: 'Bengaluru City Helipad',
        city: 'Bengaluru',
      },
    };

    it('returns the booking when the authenticated user owns it', async () => {
      prisma.booking.findFirst.mockResolvedValue(fullBooking);

      const result = await service.getPassengerBookingById(
        'passenger-1',
        'booking-1',
      );

      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1', userId: 'passenger-1' },
        }),
      );
      expect(result).not.toBeNull();
      expect(result!.bookingId).toBe('booking-1');
      expect(result!.reference).toBe('PH-20261113-ABC12345');
      expect(result!.status).toBe('confirmed');
      expect(result!.price).toBe(48000);
      expect(result!.createdAt).toEqual(new Date('2026-11-12T10:00:00Z'));
      expect(result!.slot.startTime).toEqual(new Date('2026-11-20T10:00:00Z'));
      expect(result!.slot.endTime).toEqual(new Date('2026-11-20T11:00:00Z'));
      expect(result!.slot.aircraft.model).toBe('Bell 407');
      expect(result!.slot.aircraft.capacity).toBe(6);
      expect(result!.slot.aircraft.registration).toBe('VT-TEST1');
      expect(result!.slot.operator?.companyName).toBe('Test Charter Co');
      expect(result!.slot.helipad.id).toBe('origin-1');
      expect(result!.slot.helipad.name).toBe('HAL Helipad');
      expect(result!.slot.helipad.city).toBe('Bengaluru');
      expect(result!.destinationHelipad?.id).toBe('destination-1');
      expect(result!.destinationHelipad?.name).toBe('Bengaluru City Helipad');
      expect(result!.destinationHelipad?.city).toBe('Bengaluru');
    });

    it('selects helipad IDs from the database relations', async () => {
      prisma.booking.findFirst.mockResolvedValue(fullBooking);

      await service.getPassengerBookingById('passenger-1', 'booking-1');

      const query = prisma.booking.findFirst.mock.calls[0][0];
      expect(query.select.slot.select.helipad.select.id).toBe(true);
      expect(query.select.destinationHelipad.select.id).toBe(true);
    });

    it('returns distinct origin and destination helipad IDs', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        ...fullBooking,
        slot: {
          ...fullBooking.slot,
          helipad: {
            id: 'origin-1',
            name: 'HAL Helipad',
            city: 'Bengaluru',
          },
        },
        destinationHelipad: {
          id: 'destination-1',
          name: 'Electronic City Helipad',
          city: 'Bengaluru',
        },
      });

      const result = await service.getPassengerBookingById(
        'passenger-1',
        'booking-1',
      );

      expect(result!.slot.helipad.id).toBe('origin-1');
      expect(result!.destinationHelipad?.id).toBe('destination-1');
      expect(result!.slot.helipad.id).not.toBe(
        result!.destinationHelipad?.id,
      );
    });

    it('returns identical origin and destination IDs for legacy bookings', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        ...fullBooking,
        slot: {
          ...fullBooking.slot,
          helipad: {
            id: 'helipad-1',
            name: 'HAL Helipad',
            city: 'Bengaluru',
          },
        },
        destinationHelipad: {
          id: 'helipad-1',
          name: 'HAL Helipad',
          city: 'Bengaluru',
        },
      });

      const result = await service.getPassengerBookingById(
        'passenger-1',
        'booking-1',
      );

      expect(result!.slot.helipad.id).toBe('helipad-1');
      expect(result!.destinationHelipad?.id).toBe('helipad-1');
    });

    it('returns a null destination when none is recorded', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        ...fullBooking,
        destinationHelipad: null,
      });

      const result = await service.getPassengerBookingById(
        'passenger-1',
        'booking-1',
      );

      expect(result!.destinationHelipad).toBeNull();
    });

    it('keeps helipad IDs authoritative when names differ', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        ...fullBooking,
        slot: {
          ...fullBooking.slot,
          helipad: {
            id: 'helipad-1',
            name: 'HAL Helipad',
            city: 'Bengaluru',
          },
        },
        destinationHelipad: {
          id: 'helipad-1',
          name: 'Legacy label for the same helipad',
          city: 'Bengaluru',
        },
      });

      const result = await service.getPassengerBookingById(
        'passenger-1',
        'booking-1',
      );

      expect(result!.slot.helipad.id).toBe(
        result!.destinationHelipad?.id,
      );
      expect(result!.slot.helipad.name).not.toBe(
        result!.destinationHelipad?.name,
      );
    });

    it('returns null when the booking does not exist', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      const result = await service.getPassengerBookingById(
        'passenger-1',
        'nonexistent-booking',
      );

      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'nonexistent-booking', userId: 'passenger-1' },
        }),
      );
      expect(result).toBeNull();
    });

    it('returns null when another passenger owns the booking', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      const result = await service.getPassengerBookingById(
        'passenger-2',
        'booking-1',
      );

      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'booking-1', userId: 'passenger-2' },
        }),
      );
      expect(result).toBeNull();
    });

    it('scopes the Prisma query by both booking ID and user ID', async () => {
      prisma.booking.findFirst.mockResolvedValue(fullBooking);

      await service.getPassengerBookingById('passenger-1', 'booking-1');

      const callArgs = prisma.booking.findFirst.mock.calls[0][0];
      expect(callArgs.where).toEqual({
        id: 'booking-1',
        userId: 'passenger-1',
      });
    });
  });

  describe('holdSlot', () => {
    it('throws NotFoundException if the slot does not exist', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(null);

      await expect(service.holdSlot('missing-slot', 'user-1', 'helipad-2')).rejects.toThrow(
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

      await expect(service.holdSlot('slot-1', 'user-1', 'helipad-2')).rejects.toThrow(
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

      const result = await service.holdSlot('slot-1', 'user-1', 'helipad-2');

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

      const result = await service.holdSlot('slot-1', 'user-2', 'helipad-2');

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

      await expect(service.holdSlot('slot-1', 'user-1', 'helipad-2')).rejects.toThrow(
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

      await expect(service.holdSlot('slot-1', 'user-1', 'helipad-2')).rejects.toThrow(
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

      await expect(service.holdSlot('slot-1', 'user-1', 'helipad-2')).rejects.toThrow(
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
        service.holdSlot('slot-1', 'user-1', 'helipad-2'),
        service.holdSlot('slot-1', 'user-2', 'helipad-2'),
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

    it('requires a destination helipad id for every new hold', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

      await expect(service.holdSlot('slot-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a blank destination helipad id', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

      await expect(
        service.holdSlot('slot-1', 'user-1', '   '),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects legacy slots with no operator-declared destination', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(
        availableSlot({
          destinationHelipadId: null,
          destinationHelipad: null,
        }),
      );

      await expect(
        service.holdSlot('slot-1', 'user-1', 'helipad-2'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a passenger destination that differs from the declared route', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

      await expect(
        service.holdSlot('slot-1', 'user-1', 'helipad-3'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a destination equal to the origin', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

      await expect(
        service.holdSlot('slot-1', 'user-1', 'helipad-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown destination helipad', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());
      prisma.helipad.findUnique.mockResolvedValue(null);

      await expect(
        service.holdSlot('slot-1', 'user-1', 'missing-destination'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('persists the declared route and returns origin and destination', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());
      const create = jest.fn().mockResolvedValue({
        id: 'booking-1',
        reference: 'PH-20261115-ABCDEFGH',
      });
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          availabilitySlot: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          booking: { create },
        }),
      );

      const result = await service.holdSlot(
        'slot-1',
        'user-1',
        'helipad-2',
      );

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slotId: 'slot-1',
            destinationHelipadId: 'helipad-2',
          }),
        }),
      );
      expect(result.origin).toEqual({
        id: 'helipad-1',
        name: 'HAL Helipad',
        city: 'Bengaluru',
      });
      expect(result.destination).toEqual({
        id: 'helipad-2',
        name: 'Electronic City Helipad',
        city: 'Bengaluru',
      });
    });

    describe('reference collision retry', () => {
      it('retries on reference unique constraint violation and succeeds on second attempt', async () => {
        prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

        let transactionCallCount = 0;
        const create = jest.fn().mockImplementation(async ({ data }) => {
          return { id: 'booking-1', reference: data.reference };
        });

        prisma.$transaction.mockImplementation(async (fn) => {
          transactionCallCount++;
          if (transactionCallCount === 1) {
            const error = new Error('Unique constraint failed') as any;
            error.code = 'P2002';
            error.meta = { target: ['reference'] };
            throw error;
          }
          return fn({
            availabilitySlot: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            booking: { create },
          });
        });

        const result = await service.holdSlot('slot-1', 'user-1', 'helipad-2');

        expect(result.status).toBe('held');
        expect(result.bookingId).toBe('booking-1');
        expect(transactionCallCount).toBe(2);
        expect(redis.set).toHaveBeenCalledTimes(1);
      });

      it('exhausts retries after three reference collisions', async () => {
        prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

        let transactionCallCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        prisma.$transaction.mockImplementation(async (fn) => {
          transactionCallCount++;

          const error = new Error('Unique constraint failed') as any;
          error.code = 'P2002';
          error.meta = { target: ['reference'] };
          throw error;
        });

        await expect(service.holdSlot('slot-1', 'user-1', 'helipad-2')).rejects.toThrow(
          ConflictException,
        );
        expect(transactionCallCount).toBe(3);
        expect(redis.set).not.toHaveBeenCalled();
      });

      it('does not retry on active-slot unique constraint violation', async () => {
        prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

        let transactionCallCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        prisma.$transaction.mockImplementation(async (fn) => {
          transactionCallCount++;

          const error = new Error('Unique constraint failed') as any;
          error.code = 'P2002';
          error.meta = { target: ['bookings_active_slot_id_key'] };
          throw error;
        });

        await expect(service.holdSlot('slot-1', 'user-1', 'helipad-2')).rejects.toThrow(
          /Unique constraint failed/,
        );
        expect(transactionCallCount).toBe(1);
        expect(redis.set).not.toHaveBeenCalled();
      });

      it('does not retry on other database errors (e.g., P2003)', async () => {
        prisma.availabilitySlot.findUnique.mockResolvedValue(availableSlot());

        let transactionCallCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        prisma.$transaction.mockImplementation(async (fn) => {
          transactionCallCount++;

          const error = new Error('Foreign key constraint failed') as any;
          error.code = 'P2003';
          throw error;
        });

        await expect(service.holdSlot('slot-1', 'user-1', 'helipad-2')).rejects.toThrow(
          Error,
        );
        expect(transactionCallCount).toBe(1);
        expect(redis.set).not.toHaveBeenCalled();
      });
    });
  });


  describe('requestSlot', () => {
    const requestedBooking = {
      id: 'booking-1',
      reference: 'PH-20261118-ABCDEFGH',
      status: 'requested',
      price: 48000,
      requestedAt: new Date('2026-11-18T10:00:00Z'),
      decisionDeadline: new Date('2026-11-19T10:00:00Z'),
    };

    type TxOptions = {
      updateCount?: number;
      slotStatus?: string;
      heldDestination?: string | null;
      secondLookupStatus?: 'requested' | null;
      eventRejects?: boolean;
    };

    function arrangeTransaction(options: TxOptions = {}) {
      const {
        updateCount = 1,
        slotStatus = 'held',
        heldDestination = 'helipad-2',
        secondLookupStatus = 'requested',
        eventRejects = false,
      } = options;

      const txBookingFindFirst = jest
        .fn()
        .mockResolvedValueOnce({
          id: 'booking-1',
          userId: 'user-1',
          status: 'held',
          destinationHelipadId: heldDestination,
        })
        .mockResolvedValue(
          secondLookupStatus === 'requested'
            ? { ...requestedBooking }
            : null,
        );
      const updateMany = jest.fn().mockResolvedValue({ count: updateCount });
      const findUniqueOrThrow = jest.fn().mockResolvedValue(requestedBooking);
      const eventCreate = eventRejects
        ? jest.fn().mockRejectedValue(new Error('event write failed'))
        : jest.fn().mockResolvedValue({ id: 'event-1' });
      const slotUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          booking: {
            findFirst: txBookingFindFirst,
            updateMany,
            findUniqueOrThrow,
          },
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'slot-1',
              status: slotStatus,
              helipadId: 'helipad-1',
              destinationHelipadId: 'helipad-2',
            }),
            updateMany: slotUpdateMany,
          },
          bookingEvent: { create: eventCreate },
        }),
      );

      return { updateMany, eventCreate, findUniqueOrThrow, slotUpdateMany };
    }

    beforeEach(() => {
      prisma.booking.findFirst.mockResolvedValue(null);
      redis.get.mockResolvedValue('user-1');
    });

    it('transitions a held booking to requested and records one event', async () => {
      const { updateMany, eventCreate, slotUpdateMany } = arrangeTransaction();

      const result = await service.requestSlot('slot-1', 'user-1');

      expect(result.status).toBe('requested');
      expect(result.duplicate).toBe(false);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'booking-1', userId: 'user-1', status: 'held' },
        data: expect.objectContaining({
          status: 'requested',
          requestedAt: expect.any(Date),
          decisionDeadline: expect.any(Date),
        }),
      });
      expect(eventCreate).toHaveBeenCalledTimes(1);
      expect(eventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bookingId: 'booking-1',
          actorId: 'user-1',
          actorRole: 'passenger',
          type: 'requested',
          fromStatus: 'held',
          toStatus: 'requested',
        }),
      });
      // The slot must stay reserved for the requested booking.
      expect(slotUpdateMany).not.toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith('hold:slot-1');
    });

    it('sets the decision deadline exactly 24 hours after server request time', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-18T10:00:00Z'));
      const { updateMany } = arrangeTransaction();

      await service.requestSlot('slot-1', 'user-1');

      const data = updateMany.mock.calls[0][0].data;
      expect(data.requestedAt).toEqual(new Date('2026-11-18T10:00:00Z'));
      expect(data.decisionDeadline).toEqual(new Date('2026-11-19T10:00:00Z'));
      expect(
        data.decisionDeadline.getTime() - data.requestedAt.getTime(),
      ).toBe(24 * 60 * 60 * 1000);
      jest.useRealTimers();
    });

    it('rejects a passenger who does not own the Redis hold', async () => {
      redis.get.mockResolvedValue('someone-else');

      await expect(service.requestSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a missing or expired Redis hold', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.requestSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('is idempotent when the request was already submitted', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        ...requestedBooking,
      });

      const result = await service.requestSlot('slot-1', 'user-1');

      expect(result.duplicate).toBe(true);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('does not duplicate events when the conditional transition loses a race', async () => {
      const { eventCreate } = arrangeTransaction({
        updateCount: 0,
        secondLookupStatus: 'requested',
      });

      const result = await service.requestSlot('slot-1', 'user-1');

      expect(result.duplicate).toBe(true);
      expect(eventCreate).not.toHaveBeenCalled();
    });

    it('rejects when the slot is no longer held', async () => {
      arrangeTransaction({ slotStatus: 'available' });

      await expect(service.requestSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('rejects when the booking route is inconsistent with the slot', async () => {
      arrangeTransaction({ heldDestination: 'helipad-9' });

      await expect(service.requestSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a legacy booking with no route destination', async () => {
      arrangeTransaction({ heldDestination: null });

      await expect(service.requestSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects when a route points back to its origin', async () => {
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          booking: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'booking-1',
              userId: 'user-1',
              status: 'held',
              destinationHelipadId: 'helipad-1',
            }),
            updateMany: jest.fn(),
            findUniqueOrThrow: jest.fn(),
          },
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'slot-1',
              status: 'held',
              helipadId: 'helipad-1',
              destinationHelipadId: 'helipad-1',
            }),
            updateMany: jest.fn(),
          },
          bookingEvent: { create: jest.fn() },
        }),
      );

      await expect(service.requestSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not report success when the event write fails', async () => {
      arrangeTransaction({ eventRejects: true });

      await expect(service.requestSlot('slot-1', 'user-1')).rejects.toThrow(
        'event write failed',
      );
    });

    it('repeated submission remains idempotent after Redis hold deletion', async () => {
      arrangeTransaction();
      await service.requestSlot('slot-1', 'user-1');

      redis.get.mockResolvedValue(null);
      prisma.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        ...requestedBooking,
      });

      const second = await service.requestSlot('slot-1', 'user-1');
      expect(second.duplicate).toBe(true);
    });

    it('confirmSlot keeps identical request semantics as a deprecated alias', async () => {
      const spy = jest
        .spyOn(service, 'requestSlot')
        .mockResolvedValue({ duplicate: false } as never);

      await service.confirmSlot('slot-1', 'user-1');

      expect(spy).toHaveBeenCalledWith('slot-1', 'user-1');
      spy.mockRestore();
    });

    it('exposes requested timestamps in passenger DTO responses', async () => {
      prisma.booking.findFirst.mockResolvedValue({
        id: 'booking-1',
        reference: 'PH-20261118-ABCDEFGH',
        status: 'requested',
        price: 48000,
        createdAt: new Date('2026-11-18T09:55:00Z'),
        requestedAt: requestedBooking.requestedAt,
        decisionDeadline: requestedBooking.decisionDeadline,
        slot: {
          startTime: new Date('2026-11-20T10:00:00Z'),
          endTime: new Date('2026-11-20T11:00:00Z'),
          aircraft: {
            model: 'Bell 407',
            capacity: 6,
            registration: 'VT-TEST1',
            operator: { companyName: 'Test Charter Co' },
          },
          helipad: { id: 'helipad-1', name: 'HAL Helipad', city: 'Bengaluru' },
        },
        destinationHelipad: {
          id: 'helipad-2',
          name: 'Kempegowda Airport Helipad',
          city: 'Bengaluru',
        },
      });

      const booking = await service.getPassengerBookingById(
        'user-1',
        'booking-1',
      );

      expect(booking?.status).toBe('requested');
      expect(booking?.requestedAt).toEqual(requestedBooking.requestedAt);
      expect(booking?.decisionDeadline).toEqual(
        requestedBooking.decisionDeadline,
      );
    });
  });

  describe('expiry sweeper', () => {
    type TxCounts = {
      bookingCount?: number;
      slotCount?: number;
      eventRejects?: boolean;
    };

    function arrangeExpiryTx(options: TxCounts = {}) {
      const { bookingCount = 1, slotCount = 1, eventRejects = false } = options;
      const bookingUpdate = jest.fn().mockResolvedValue({ count: bookingCount });
      const slotUpdate = jest.fn().mockResolvedValue({ count: slotCount });
      const eventCreate = eventRejects
        ? jest.fn().mockRejectedValue(new Error('event write failed'))
        : jest.fn().mockResolvedValue({ id: 'event-1' });
      prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          booking: { updateMany: bookingUpdate },
          availabilitySlot: { updateMany: slotUpdate },
          bookingEvent: { create: eventCreate },
        }),
      );
      return { bookingUpdate, slotUpdate, eventCreate };
    }

    it('only sweeps five-minute holds that are still in held state', async () => {
      prisma.booking.findMany.mockImplementation(
        (args: { where: { status: string } }) =>
          Promise.resolve(
            args.where.status === 'held'
              ? [{ id: 'booking-1', slotId: 'slot-1' }]
              : [],
          ),
      );
      redis.exists.mockResolvedValue(0);
      const { bookingUpdate, slotUpdate, eventCreate } = arrangeExpiryTx();

      await service.releaseExpiredHolds();

      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'held', slot: { status: 'held' } },
        }),
      );
      expect(bookingUpdate).toHaveBeenCalledWith({
        where: { id: 'booking-1', status: 'held' },
        data: expect.objectContaining({ status: 'cancelled' }),
      });
      expect(slotUpdate).toHaveBeenCalledWith({
        where: { id: 'slot-1', status: 'held' },
        data: { status: 'available' },
      });
      expect(eventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'hold_expired',
          actorId: null,
          actorRole: 'system',
          fromStatus: 'held',
          toStatus: 'cancelled',
        }),
      });
    });

    it('keeps holds whose Redis key still exists', async () => {
      prisma.booking.findMany.mockImplementation(
        (args: { where: { status: string } }) =>
          Promise.resolve(
            args.where.status === 'held'
              ? [{ id: 'booking-1', slotId: 'slot-1' }]
              : [],
          ),
      );
      redis.exists.mockResolvedValue(1);
      const { bookingUpdate, eventCreate } = arrangeExpiryTx();

      await service.releaseExpiredHolds();

      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(eventCreate).not.toHaveBeenCalled();
    });

    it('expires only requested bookings past their deadline', async () => {
      prisma.booking.findMany.mockImplementation(
        (args: { where: { status: string } }) =>
          Promise.resolve(
            args.where.status === 'requested'
              ? [{ id: 'booking-2', slotId: 'slot-2' }]
              : [],
          ),
      );
      const { bookingUpdate, slotUpdate, eventCreate } = arrangeExpiryTx();

      await service.releaseExpiredHolds();

      expect(prisma.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'requested',
            decisionDeadline: { lte: expect.any(Date) },
          },
        }),
      );
      expect(bookingUpdate).toHaveBeenCalledWith({
        where: {
          id: 'booking-2',
          status: 'requested',
          decisionDeadline: { lte: expect.any(Date) },
        },
        data: { status: 'expired' },
      });
      expect(slotUpdate).toHaveBeenCalledWith({
        where: { id: 'slot-2', status: 'held' },
        data: { status: 'available' },
      });
      expect(eventCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'expired',
          actorId: null,
          actorRole: 'system',
          fromStatus: 'requested',
          toStatus: 'expired',
        }),
      });
    });

    it('leaves future-deadline requests reserved', async () => {
      prisma.booking.findMany.mockImplementation(
        (args: { where: { status: string } }) =>
          Promise.resolve(
            args.where.status === 'requested'
              ? [{ id: 'booking-2', slotId: 'slot-2' }]
              : [],
          ),
      );
      // Simulate the database returning no rows because the deadline is in the future.
      const { bookingUpdate, eventCreate } = arrangeExpiryTx({
        bookingCount: 0,
      });

      await service.releaseExpiredHolds();

      expect(bookingUpdate).toHaveBeenCalled();
      expect(eventCreate).not.toHaveBeenCalled();
    });

    it('releases the slot exactly once when the conditional transition loses a race', async () => {
      prisma.booking.findMany.mockImplementation(
        (args: { where: { status: string } }) =>
          Promise.resolve(
            args.where.status === 'requested'
              ? [{ id: 'booking-2', slotId: 'slot-2' }]
              : [],
          ),
      );
      const { slotUpdate, eventCreate } = arrangeExpiryTx({
        bookingCount: 0,
      });

      await service.releaseExpiredHolds();

      expect(slotUpdate).not.toHaveBeenCalled();
      expect(eventCreate).not.toHaveBeenCalled();
    });

    it('writes exactly one expiry event per booking', async () => {
      prisma.booking.findMany.mockImplementation(
        (args: { where: { status: string } }) =>
          Promise.resolve(
            args.where.status === 'requested'
              ? [{ id: 'booking-2', slotId: 'slot-2' }]
              : [],
          ),
      );
      const { eventCreate } = arrangeExpiryTx();

      await service.releaseExpiredHolds();

      expect(eventCreate).toHaveBeenCalledTimes(1);
    });

    it('does not touch legacy confirmed or cancelled bookings', async () => {
      prisma.booking.findMany.mockImplementation(
        () => Promise.resolve([]),
      );
      const { bookingUpdate } = arrangeExpiryTx();

      await service.releaseExpiredHolds();

      const statuses = prisma.booking.findMany.mock.calls.map(
        (call) => call[0].where.status,
      );
      expect(statuses).toEqual(['held', 'requested']);
      expect(bookingUpdate).not.toHaveBeenCalled();
    });

    it('does not release a requested booking when its Redis key is gone', async () => {
      prisma.booking.findMany.mockImplementation(
        (args: { where: { status: string } }) =>
          Promise.resolve(
            args.where.status === 'requested'
              ? [{ id: 'booking-2', slotId: 'slot-2' }]
              : [],
          ),
      );
      redis.exists.mockResolvedValue(0);
      const { bookingUpdate } = arrangeExpiryTx();

      await service.releaseExpiredHolds();

      // The held-phase query uses status 'held', so a requested booking can only
      // be expired through the deadline predicate.
      expect(bookingUpdate).toHaveBeenCalledTimes(1);
      expect(bookingUpdate.mock.calls[0][0].data).toEqual({
        status: 'expired',
      });
    });
  });
});
