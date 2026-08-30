import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PricingService } from '../pricing/pricing.service';

const HOLD_TTL_SECONDS = 5 * 60; // 5 minutes
@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private pricing: PricingService,
  ) { }

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

    const { totalPrice } = await this.pricing.calculatePrice(slot.helipadId, slot.aircraft.capacity);

    const booking = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.availabilitySlot.updateMany({
        where: { id: slotId, status: 'available' },
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

  async confirmSlot(slotId: string, userId: string) {
    const heldBy = await this.redis.get(`hold:${slotId}`);
    if (heldBy !== userId) {
      throw new ConflictException(
        'Your hold has expired or belongs to another passenger',
      );
    }

    const booking = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findUnique({ where: { slotId } });
      if (
        !existing ||
        existing.userId !== userId ||
        existing.status !== 'held'
      ) {
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

    await this.redis.del(`hold:${slotId}`);

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
        // Redis key expired (TTL ran out) but the DB still says 'held' - release it
        await this.prisma.$executeRaw`
        UPDATE availability_slots
        SET status = 'available'
        WHERE id = ${slot.id} AND status = 'held'
      `;
        await this.prisma.booking.updateMany({
          where: { slotId: slot.id, status: 'held' },
          data: { status: 'cancelled' },
        });
        console.log(`Released expired hold on slot ${slot.id}`);
      }
    }
  }
}
