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

  describe('confirmSlot', () => {
    it('confirms the booking and deletes its Redis ownership key', async () => {
      redis.get.mockResolvedValue('user-1');
      const findFirst = jest.fn().mockResolvedValue({
        id: 'booking-1',
        userId: 'user-1',
        status: 'held',
        destinationHelipadId: 'helipad-2',
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
            findUnique: jest.fn().mockResolvedValue({
              id: 'slot-1',
              helipadId: 'helipad-1',
              destinationHelipadId: 'helipad-2',
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          helipad: {
            findUnique: jest.fn().mockResolvedValue({ id: 'helipad-2' }),
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
        destinationHelipadId: 'helipad-2',
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
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'slot-1',
              helipadId: 'helipad-1',
              destinationHelipadId: 'helipad-2',
            }),
            updateMany: slotUpdate,
          },
          helipad: {
            findUnique: jest.fn().mockResolvedValue({ id: 'helipad-2' }),
          },
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

    it('rejects confirmation when the stored destination differs from the slot route', async () => {
      redis.get.mockResolvedValue('user-1');
      const bookingUpdate = jest.fn();
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          booking: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'booking-1',
              userId: 'user-1',
              status: 'held',
              destinationHelipadId: 'helipad-9',
            }),
            update: bookingUpdate,
          },
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'slot-1',
              helipadId: 'helipad-1',
              destinationHelipadId: 'helipad-2',
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          helipad: { findUnique: jest.fn() },
        }),
      );

      await expect(service.confirmSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(bookingUpdate).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('rejects confirmation when the stored destination record no longer exists', async () => {
      redis.get.mockResolvedValue('user-1');
      const bookingUpdate = jest.fn();
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          booking: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'booking-1',
              userId: 'user-1',
              status: 'held',
              destinationHelipadId: 'helipad-2',
            }),
            update: bookingUpdate,
          },
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'slot-1',
              helipadId: 'helipad-1',
              destinationHelipadId: 'helipad-2',
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          helipad: { findUnique: jest.fn().mockResolvedValue(null) },
        }),
      );

      await expect(service.confirmSlot('slot-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(bookingUpdate).not.toHaveBeenCalled();
    });

    it('rejects confirmation for a legacy booking with no destination', async () => {
      redis.get.mockResolvedValue('user-1');
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          booking: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'booking-1',
              userId: 'user-1',
              status: 'held',
              destinationHelipadId: null,
            }),
            update: jest.fn(),
          },
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'slot-1',
              helipadId: 'helipad-1',
              destinationHelipadId: 'helipad-2',
            }),
            updateMany: jest.fn(),
          },
          helipad: { findUnique: jest.fn() },
        }),
      );

      await expect(service.confirmSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects confirmation when the destination equals the origin', async () => {
      redis.get.mockResolvedValue('user-1');
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          booking: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'booking-1',
              userId: 'user-1',
              status: 'held',
              destinationHelipadId: 'helipad-1',
            }),
            update: jest.fn(),
          },
          availabilitySlot: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'slot-1',
              helipadId: 'helipad-1',
              destinationHelipadId: 'helipad-1',
            }),
            updateMany: jest.fn(),
          },
          helipad: { findUnique: jest.fn() },
        }),
      );

      await expect(service.confirmSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
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
