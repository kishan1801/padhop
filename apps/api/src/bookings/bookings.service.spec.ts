import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PricingService } from '../pricing/pricing.service';

describe('BookingsService', () => {
  let service: BookingsService;
  let prisma: {
    availabilitySlot: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let redis: { set: jest.Mock; get: jest.Mock; del: jest.Mock };
  let pricing: { calculatePrice: jest.Mock };

  beforeEach(async () => {
    prisma = {
      availabilitySlot: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };
    pricing = { calculatePrice: jest.fn().mockResolvedValue({ totalPrice: 48000 }) };

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

  describe('holdSlot', () => {
    it('throws NotFoundException if the slot does not exist', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue(null);

      await expect(service.holdSlot('missing-slot', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException if the slot is no longer available', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue({
        id: 'slot-1',
        helipadId: 'helipad-1',
        aircraft: { capacity: 6 },
      });

      // Simulate the atomic UPDATE affecting zero rows - someone else got there first
      prisma.$transaction.mockImplementation(async (fn) => {
        return fn({
          availabilitySlot: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          booking: { create: jest.fn() },
        });
      });

      await expect(service.holdSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('succeeds and creates a booking when the slot is genuinely available', async () => {
      prisma.availabilitySlot.findUnique.mockResolvedValue({
        id: 'slot-1',
        helipadId: 'helipad-1',
        aircraft: { capacity: 6 },
      });

      prisma.$transaction.mockImplementation(async (fn) => {
        return fn({
          availabilitySlot: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
          booking: {
            create: jest.fn().mockResolvedValue({ id: 'booking-1' }),
          },
        });
      });

      const result = await service.holdSlot('slot-1', 'user-1');

      expect(result.status).toBe('held');
      expect(result.bookingId).toBe('booking-1');
      expect(redis.set).toHaveBeenCalledWith(
        'hold:slot-1',
        'user-1',
        'EX',
        expect.any(Number),
      );
    });
  });

  describe('confirmSlot', () => {
    it('throws ConflictException if the Redis hold belongs to a different user', async () => {
      redis.get.mockResolvedValue('someone-else');

      await expect(service.confirmSlot('slot-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});