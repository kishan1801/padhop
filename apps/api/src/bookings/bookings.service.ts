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
import type { PassengerBookingDto } from './dto/passenger-booking.dto';

const HOLD_TTL_SECONDS = 5 * 60; // 5 minutes
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
    const slot = await this.prisma.availabilitySlot.findUnique({
      where: { id: slotId },
      include: { aircraft: true },
    });
    if (!slot) throw new NotFoundException('Slot not found');

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

    const booking = await this.prisma.$transaction(async (tx) => {
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
          destinationHelipadId: destinationHelipadId ?? slot.helipadId,
          bookingType: 'now',
          price: totalPrice,
        },
      });
    });

    await this.redis.set(`hold:${slotId}`, userId, 'EX', HOLD_TTL_SECONDS);

    return {
      bookingId: booking.id,
      slotId,
      status: 'held',
      expiresInSeconds: HOLD_TTL_SECONDS,
      price: totalPrice,
    };
  }

  async getPassengerBookings(userId: string): Promise<PassengerBookingDto[]> {
    const bookings = await this.prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        price: true,
        createdAt: true,
        slot: {
          select: {
            startTime: true,
            endTime: true,
            aircraft: { select: { model: true, capacity: true } },
            helipad: { select: { name: true, city: true } },
          },
        },
        destinationHelipad: { select: { name: true, city: true } },
      },
    });

    return bookings.map((booking) => ({
      bookingId: booking.id,
      status: booking.status,
      price: Number(booking.price),
      createdAt: booking.createdAt,
      slot: booking.slot,
      destinationHelipad: booking.destinationHelipad,
    }));
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

    return { bookingId: booking.id, slotId, status: 'confirmed' };
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
