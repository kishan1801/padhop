import { Test } from '@nestjs/testing';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PricingService } from '../pricing/pricing.service';

describe('BookingsService passenger decline reason', () => {
  let service: BookingsService;
  let prisma: { booking: { findFirst: jest.Mock } };

  beforeEach(async () => {
    prisma = { booking: { findFirst: jest.fn() } };

    const module = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: {} },
        { provide: PricingService, useValue: {} },
      ],
    }).compile();

    service = module.get(BookingsService);
  });

  const record = (events: { reason: string | null }[]) => ({
    id: 'booking-1',
    reference: 'PH-20261119-ABCDEFGH',
    status: 'declined',
    price: 48000,
    createdAt: new Date('2026-11-18T09:00:00Z'),
    requestedAt: new Date('2026-11-18T10:00:00Z'),
    decisionDeadline: new Date('2026-11-19T10:00:00Z'),
    events,
    slot: {
      startTime: new Date('2026-11-21T10:00:00Z'),
      endTime: new Date('2026-11-21T11:00:00Z'),
      aircraft: {
        model: 'Bell 429',
        capacity: 7,
        registration: 'VT-ABC1',
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

  it('exposes only the passenger-safe decline reason', async () => {
    prisma.booking.findFirst.mockResolvedValue(
      record([{ reason: 'Aircraft unavailable for this leg.' }]),
    );

    const booking = await service.getPassengerBookingById(
      'passenger-1',
      'booking-1',
    );

    expect(booking?.declineReason).toBe('Aircraft unavailable for this leg.');
    const query = prisma.booking.findFirst.mock.calls[0][0];
    expect(query.select.events).toEqual({
      where: { type: 'declined', reason: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { reason: true },
    });
    expect(JSON.stringify(booking)).not.toMatch(/email|phone|password/i);
  });

  it('returns null when no decline reason is recorded', async () => {
    prisma.booking.findFirst.mockResolvedValue(record([]));

    const booking = await service.getPassengerBookingById(
      'passenger-1',
      'booking-1',
    );

    expect(booking?.declineReason).toBeNull();
  });
});
