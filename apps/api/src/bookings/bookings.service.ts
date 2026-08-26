import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Cron, CronExpression } from '@nestjs/schedule';

const HOLD_TTL_SECONDS = 5 * 60; // 5 minutes
@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) { }

  async holdSlot(slotId: string) {
    // Atomic conditional update: only succeeds if status is currently 'available'.
    // If two requests race for the same slot, only one of these updates
    // will actually match a row - Postgres guarantees that.
    const result = await this.prisma.$executeRaw`
  UPDATE availability_slots
  SET status = 'held'
  WHERE id = ${slotId} AND status = 'available'
`;

    if (result === 0) {
      // Either the slot doesn't exist, or someone else already holds it
      const slot = await this.prisma.availabilitySlot.findUnique({
        where: { id: slotId },
      });
      if (!slot) {
        throw new NotFoundException('Slot not found');
      }
      throw new ConflictException('Slot is no longer available');
    }

    // Set a Redis key with a TTL - this is our "5 minutes to confirm" timer.
    // If it expires without confirmation, a cleanup job releases the hold.
    await this.redis.set(`hold:${slotId}`, '1', 'EX', HOLD_TTL_SECONDS);

    return { slotId, status: 'held', expiresInSeconds: HOLD_TTL_SECONDS };
  }

  async confirmSlot(slotId: string) {
    const result = await this.prisma.$executeRaw`
    UPDATE availability_slots
    SET status = 'confirmed'
    WHERE id = ${slotId} AND status = 'held'
  `;

    if (result === 0) {
      throw new ConflictException('Slot is not currently held - cannot confirm');
    }

    // Hold fulfilled - remove the expiry timer, it's no longer needed
    await this.redis.del(`hold:${slotId}`);

    return { slotId, status: 'confirmed' };
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
        console.log(`Released expired hold on slot ${slot.id}`);
      }
    }
  }
}
