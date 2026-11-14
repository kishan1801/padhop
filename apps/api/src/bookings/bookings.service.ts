import {
  BadRequestException,
  Injectable,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PricingService } from '../pricing/pricing.service';
import { generateBookingReference } from './booking-reference';
import type { PassengerBookingDto } from './dto/passenger-booking.dto';

const HOLD_TTL_SECONDS = 5 * 60; // 5 minutes
const MAX_REFERENCE_RETRIES = 3;
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private pricing: PricingService,
  ) {}

  async holdSlot(
    slotId: string,
    userId: string,
    destinationHelipadId?: string,
  ) {
    const requestedDestinationId = destinationHelipadId?.trim();
    if (!requestedDestinationId) {
      throw new BadRequestException('destinationHelipadId is required');
    }

    const slot = await this.prisma.availabilitySlot.findUnique({
      where: { id: slotId },
      include: {
        aircraft: true,
        helipad: { select: { id: true, name: true, city: true } },
        destinationHelipad: { select: { id: true, name: true, city: true } },
      },
    });
    if (!slot) throw new NotFoundException('Slot not found');

    // Legacy origin-only slots have no declared destination and are not
    // bookable as routes. A passenger may never invent a destination.
    if (!slot.destinationHelipadId) {
      throw new BadRequestException(
        'This availability slot has no operator-declared destination and cannot be booked as a route',
      );
    }

    const declaredDestinationId = slot.destinationHelipadId;

    // The destination of a route must always differ from its origin.
    if (requestedDestinationId === slot.helipadId) {
      throw new BadRequestException(
        'Destination must be different from the origin',
      );
    }

    const destinationExists = await this.prisma.helipad.findUnique({
      where: { id: requestedDestinationId },
      select: { id: true },
    });
    if (!destinationExists) {
      throw new NotFoundException('Destination helipad not found');
    }

    // The passenger must book exactly the leg declared by the operator.
    if (requestedDestinationId !== declaredDestinationId) {
      throw new BadRequestException(
        'Destination does not match the declared route for this slot',
      );
    }

    if (declaredDestinationId === slot.helipadId) {
      throw new BadRequestException(
        'Declared route destination must be different from the origin',
      );
    }

    if (!slot.destinationHelipad) {
      throw new NotFoundException('Declared destination helipad not found');
    }

    if (
      !Number.isFinite(slot.startTime.getTime()) ||
      !Number.isFinite(slot.endTime.getTime()) ||
      slot.endTime <= slot.startTime
    ) {
      throw new BadRequestException('Slot has an invalid schedule');
    }

    const now = new Date();
    if (
      slot.status !== 'available' ||
      slot.startTime <= now ||
      slot.endTime <= now
    ) {
      throw new ConflictException('Slot is no longer available');
    }

    const { totalPrice } = await this.pricing.calculatePrice(
      slot.helipadId,
      slot.aircraft.capacity,
    );

    const destinationHelipad = slot.destinationHelipad;

    let booking: { id: string; reference: string };
    for (let attempt = 1; attempt <= MAX_REFERENCE_RETRIES; attempt++) {
      const reference = generateBookingReference();
      try {
        booking = await this.prisma.$transaction(async (tx) => {
          const eligibilityTime = new Date();
          const updated = await tx.availabilitySlot.updateMany({
            where: {
              id: slotId,
              status: 'available',
              startTime: { gt: eligibilityTime },
              endTime: { gt: eligibilityTime },
            },
            data: { status: 'held' },
          });

          if (updated.count === 0) {
            throw new ConflictException('Slot is no longer available');
          }

          return tx.booking.create({
            data: {
              userId,
              slotId,
              destinationHelipadId: declaredDestinationId,
              bookingType: 'now',
              price: totalPrice,
              reference,
            },
          });
        });
        break;
      } catch (error) {
        const prismaError = error as {
          code?: string;
          meta?: { target?: string[] };
        };
        if (
          prismaError.code === 'P2002' &&
          Array.isArray(prismaError.meta?.target) &&
          prismaError.meta.target.includes('reference')
        ) {
          if (attempt === MAX_REFERENCE_RETRIES) {
            throw new ConflictException(
              'Unable to generate unique booking reference',
            );
          }
          continue;
        }
        throw error;
      }
    }

    await this.redis.set(`hold:${slotId}`, userId, 'EX', HOLD_TTL_SECONDS);

    return {
      bookingId: booking!.id,
      reference: booking!.reference,
      slotId,
      status: 'held',
      expiresInSeconds: HOLD_TTL_SECONDS,
      price: totalPrice,
      origin: slot.helipad,
      destination: destinationHelipad,
    };
  }

  async getPassengerBookings(userId: string): Promise<PassengerBookingDto[]> {
    const bookings = await this.prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reference: true,
        status: true,
        price: true,
        createdAt: true,
        slot: {
          select: {
            startTime: true,
            endTime: true,
            aircraft: {
              select: {
                model: true,
                capacity: true,
                registration: true,
                operator: {
                  select: { companyName: true },
                },
              },
            },
            helipad: { select: { id: true, name: true, city: true } },
          },
        },
        destinationHelipad: { select: { id: true, name: true, city: true } },
      },
    });

    return bookings.map((booking) => ({
      bookingId: booking.id,
      reference: booking.reference,
      status: booking.status,
      price: Number(booking.price),
      createdAt: booking.createdAt,
      slot: {
        startTime: booking.slot.startTime,
        endTime: booking.slot.endTime,
        aircraft: {
          model: booking.slot.aircraft.model,
          capacity: booking.slot.aircraft.capacity,
          registration: booking.slot.aircraft.registration,
        },
        operator: booking.slot.aircraft.operator,
        helipad: booking.slot.helipad,
      },
      destinationHelipad: booking.destinationHelipad,
    }));
  }

  async getPassengerBookingById(
    userId: string,
    bookingId: string,
  ): Promise<PassengerBookingDto | null> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, userId },
      select: {
        id: true,
        reference: true,
        status: true,
        price: true,
        createdAt: true,
        slot: {
          select: {
            startTime: true,
            endTime: true,
            aircraft: {
              select: {
                model: true,
                capacity: true,
                registration: true,
                operator: {
                  select: { companyName: true },
                },
              },
            },
            helipad: { select: { id: true, name: true, city: true } },
          },
        },
        destinationHelipad: { select: { id: true, name: true, city: true } },
      },
    });

    if (!booking) {
      return null;
    }

    return {
      bookingId: booking.id,
      reference: booking.reference,
      status: booking.status,
      price: Number(booking.price),
      createdAt: booking.createdAt,
      slot: {
        startTime: booking.slot.startTime,
        endTime: booking.slot.endTime,
        aircraft: {
          model: booking.slot.aircraft.model,
          capacity: booking.slot.aircraft.capacity,
          registration: booking.slot.aircraft.registration,
        },
        operator: booking.slot.aircraft.operator,
        helipad: booking.slot.helipad,
      },
      destinationHelipad: booking.destinationHelipad,
    };
  }

  async confirmSlot(slotId: string, userId: string) {
    const heldBy = await this.redis.get(`hold:${slotId}`);
    if (heldBy !== userId) {
      throw new ConflictException(
        'Your hold has expired or belongs to another passenger',
      );
    }

    const booking = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findFirst({
        where: { slotId, userId, status: 'held' },
      });
      if (!existing || existing.userId !== userId) {
        throw new ConflictException('Slot is not currently held by you');
      }

      const slot = await tx.availabilitySlot.findUnique({
        where: { id: slotId },
        select: { id: true, helipadId: true, destinationHelipadId: true },
      });
      if (!slot) {
        throw new NotFoundException('Slot not found');
      }

      // Route integrity: both origin-only legacy bookings and bookings whose
      // destination no longer matches the declared slot leg are rejected.
      if (!slot.destinationHelipadId || !existing.destinationHelipadId) {
        throw new ConflictException(
          'Booking route is incomplete and cannot be confirmed',
        );
      }
      if (existing.destinationHelipadId !== slot.destinationHelipadId) {
        throw new ConflictException(
          'Booking destination does not match the declared slot route',
        );
      }
      if (existing.destinationHelipadId === slot.helipadId) {
        throw new ConflictException(
          'Booking destination must be different from the origin',
        );
      }

      const destination = await tx.helipad.findUnique({
        where: { id: existing.destinationHelipadId },
        select: { id: true },
      });
      if (!destination) {
        throw new NotFoundException('Destination helipad not found');
      }

      const updated = await tx.availabilitySlot.updateMany({
        where: { id: slotId, status: 'held' },
        data: { status: 'confirmed' },
      });
      if (updated.count === 0)
        throw new ConflictException('Slot is not currently held');

      return tx.booking.update({
        where: { id: existing.id },
        data: { status: 'confirmed' },
      });
    });

    try {
      await this.redis.del(`hold:${slotId}`);
    } catch (error) {
      const errorType = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Confirmed booking ${booking.id}; Redis hold-key cleanup failed (${errorType}). The key will expire by TTL.`,
      );
    }

    return {
      bookingId: booking.id,
      reference: booking.reference,
      slotId,
      status: 'confirmed',
    };
  }

  // ...inside the BookingsService class, alongside holdSlot/confirmSlot:

  @Cron(CronExpression.EVERY_30_SECONDS)
  async releaseExpiredHolds() {
    // Find slots stuck in 'held' status
    const heldSlots = await this.prisma.availabilitySlot.findMany({
      where: { status: 'held' },
      select: { id: true },
    });

    for (const slot of heldSlots) {
      const stillHeld = await this.redis.exists(`hold:${slot.id}`);
      if (!stillHeld) {
        const released = await this.prisma.$transaction(async (tx) => {
          const released = await tx.availabilitySlot.updateMany({
            where: { id: slot.id, status: 'held' },
            data: { status: 'available' },
          });
          if (released.count === 0) return false;

          await tx.booking.updateMany({
            where: { slotId: slot.id, status: 'held' },
            data: { status: 'cancelled' },
          });
          return true;
        });
        if (released) {
          console.log(`Released expired hold on slot ${slot.id}`);
        }
      }
    }
  }
}
