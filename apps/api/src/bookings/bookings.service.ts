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
import type { Prisma } from '../../generated/prisma/client';

type BookingEventCreate = Omit<
  Prisma.BookingEventUncheckedCreateInput,
  'bookingId' | 'actorId' | 'actorRole'
>;

const HOLD_TTL_SECONDS = 5 * 60; // 5 minutes
const REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const EXPIRY_BATCH_SIZE = 50;
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
        requestedAt: true,
        decisionDeadline: true,
        events: {
          where: { type: 'declined', reason: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { reason: true },
        },
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
      requestedAt: booking.requestedAt,
      decisionDeadline: booking.decisionDeadline,
      declineReason: booking.events?.[0]?.reason ?? null,
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
        requestedAt: true,
        decisionDeadline: true,
        events: {
          where: { type: 'declined', reason: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { reason: true },
        },
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
      requestedAt: booking.requestedAt,
      decisionDeadline: booking.decisionDeadline,
      declineReason: booking.events?.[0]?.reason ?? null,
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

  private async appendBookingEvent(
    tx: Prisma.TransactionClient,
    bookingId: string,
    actorId: string | null,
    actorRole: string,
    event: BookingEventCreate,
  ) {
    return tx.bookingEvent.create({
      data: { bookingId, actorId, actorRole, ...event },
    });
  }

  /**
   * Submits a held slot as a booking request (held -> requested) and starts the
   * operator response deadline. Redis only governs the initial hold; after this
   * transition the persisted database deadline is authoritative.
   */
  async requestSlot(slotId: string, userId: string) {
    // Idempotent repeat: the passenger already submitted this request. This does
    // not depend on the Redis hold key, which may already be gone.
    const alreadyRequested = await this.prisma.booking.findFirst({
      where: { slotId, userId, status: 'requested' },
      select: {
        id: true,
        reference: true,
        status: true,
        price: true,
        requestedAt: true,
        decisionDeadline: true,
      },
    });
    if (alreadyRequested) {
      return {
        bookingId: alreadyRequested.id,
        reference: alreadyRequested.reference,
        slotId,
        status: alreadyRequested.status,
        requestedAt: alreadyRequested.requestedAt,
        decisionDeadline: alreadyRequested.decisionDeadline,
        price: Number(alreadyRequested.price),
        duplicate: true,
      };
    }

    const heldBy = await this.redis.get(`hold:${slotId}`);
    if (heldBy !== userId) {
      throw new ConflictException(
        'Your hold has expired or belongs to another passenger',
      );
    }

    const requestedAt = new Date();
    const decisionDeadline = new Date(requestedAt.getTime() + REQUEST_WINDOW_MS);

    const booking = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.booking.findFirst({
        where: { slotId, userId, status: 'held' },
      });
      if (!existing) {
        // A concurrent submission may have won; return the request if it is ours.
        const current = await tx.booking.findFirst({
          where: { slotId, userId, status: 'requested' },
          select: {
            id: true,
            reference: true,
            status: true,
            price: true,
            requestedAt: true,
            decisionDeadline: true,
          },
        });
        if (current) {
          return { ...current, duplicate: true };
        }
        throw new ConflictException('Slot is not currently held by you');
      }

      const slot = await tx.availabilitySlot.findUnique({
        where: { id: slotId },
        select: {
          id: true,
          status: true,
          helipadId: true,
          destinationHelipadId: true,
        },
      });
      if (!slot) {
        throw new NotFoundException('Slot not found');
      }
      if (slot.status !== 'held') {
        throw new ConflictException('Slot is no longer held for this request');
      }
      if (
        !slot.destinationHelipadId ||
        existing.destinationHelipadId !== slot.destinationHelipadId ||
        existing.destinationHelipadId === slot.helipadId
      ) {
        throw new ConflictException(
          'Booking route is inconsistent with the declared slot route',
        );
      }

      const transitioned = await tx.booking.updateMany({
        where: { id: existing.id, userId, status: 'held' },
        data: { status: 'requested', requestedAt, decisionDeadline },
      });
      if (transitioned.count === 0) {
        // Lost a race to the expiry job or another submission.
        const current = await tx.booking.findFirst({
          where: { slotId, userId, status: 'requested' },
          select: {
            id: true,
            reference: true,
            status: true,
            price: true,
            requestedAt: true,
            decisionDeadline: true,
          },
        });
        if (current) {
          return { ...current, duplicate: true };
        }
        throw new ConflictException('Booking is no longer held');
      }

      const updated = await tx.booking.findUniqueOrThrow({
        where: { id: existing.id },
        select: {
          id: true,
          reference: true,
          status: true,
          price: true,
          requestedAt: true,
          decisionDeadline: true,
        },
      });

      await this.appendBookingEvent(tx, updated.id, userId, 'passenger', {
        type: 'requested',
        fromStatus: 'held',
        toStatus: 'requested',
        metadata: { decisionDeadline: decisionDeadline.toISOString() },
      });

      return { ...updated, duplicate: false };
    });

    // The hold key is no longer required once the request is persisted.
    try {
      await this.redis.del(`hold:${slotId}`);
    } catch (error) {
      const errorType = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Request ${booking.id} persisted; Redis hold-key cleanup failed (${errorType}). The key will expire by TTL.`,
      );
    }

    return {
      bookingId: booking.id,
      reference: booking.reference,
      slotId,
      status: booking.status,
      requestedAt: booking.requestedAt,
      decisionDeadline: booking.decisionDeadline,
      price: Number(booking.price),
      duplicate: booking.duplicate,
    };
  }

  /**
   * @deprecated Use {@link requestSlot}. Kept for one release; the old behavior
   * of transitioning a held booking directly to `confirmed` is no longer valid.
   */
  async confirmSlot(slotId: string, userId: string) {
    return this.requestSlot(slotId, userId);
  }

  private normalizeDeclineReason(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('A decline reason is required');
    }
    const normalized = value
      .replace(/\r\n?|\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) {
      throw new BadRequestException('A decline reason is required');
    }
    if (normalized.length > 500) {
      throw new BadRequestException(
        'Decline reason must be 500 characters or fewer',
      );
    }
    return normalized;
  }

  async acceptRequest(bookingId: string, userId: string) {
    return this.runDecision(bookingId, userId, 'accept');
  }

  async declineRequest(bookingId: string, userId: string, reason: unknown) {
    const normalizedReason = this.normalizeDeclineReason(reason);
    return this.runDecision(bookingId, userId, 'decline', normalizedReason);
  }

  /**
   * Conditional operator decision. HTTP exceptions that must be returned after
   * a lazy-expiry commit are derived by the caller from the returned outcome;
   * only rollback-worthy failures throw inside the transaction.
   */
  private async runDecision(
    bookingId: string,
    userId: string,
    action: 'accept' | 'decline',
    reason?: string,
  ) {
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const operator = await tx.operator.findUnique({
        where: { userId },
        select: { id: true, verified: true },
      });
      if (!operator || !operator.verified) {
        return { kind: 'forbidden' as const };
      }

      const claimed = await tx.booking.updateMany({
        where: {
          id: bookingId,
          status: 'requested',
          decisionDeadline: { gt: now },
          slot: { aircraft: { operatorId: operator.id } },
        },
        data:
          action === 'accept'
            ? { status: 'accepted', acceptedAt: now }
            : { status: 'declined', declinedAt: now },
      });

      if (claimed.count === 1) {
        if (action === 'decline') {
          const row = await tx.booking.findUniqueOrThrow({
            where: { id: bookingId },
            select: { slotId: true },
          });
          const slot = await tx.availabilitySlot.updateMany({
            where: { id: row.slotId, status: 'held' },
            data: { status: 'available' },
          });
          if (slot.count !== 1) {
            throw new ConflictException(
              'Slot is no longer held for this booking',
            );
          }
        }

        await this.appendBookingEvent(
          tx,
          bookingId,
          userId,
          'operator',
          action === 'accept'
            ? {
                type: 'accepted',
                fromStatus: 'requested',
                toStatus: 'accepted',
              }
            : {
                type: 'declined',
                fromStatus: 'requested',
                toStatus: 'declined',
                reason: reason ?? null,
              },
        );

        return {
          kind: 'decided' as const,
          bookingId,
          idempotent: false,
        };
      }

      const existing = await tx.booking.findFirst({
        where: {
          id: bookingId,
          slot: { aircraft: { operatorId: operator.id } },
        },
        select: { id: true, status: true, decisionDeadline: true },
      });
      if (!existing) {
        return { kind: 'not-found' as const };
      }

      if (
        existing.status === 'requested' &&
        existing.decisionDeadline &&
        existing.decisionDeadline.getTime() <= now.getTime()
      ) {
        const expired = await tx.booking.updateMany({
          where: {
            id: bookingId,
            status: 'requested',
            decisionDeadline: { lte: now },
          },
          data: { status: 'expired' },
        });
        if (expired.count === 1) {
          const row = await tx.booking.findUniqueOrThrow({
            where: { id: bookingId },
            select: { slotId: true },
          });
          const slot = await tx.availabilitySlot.updateMany({
            where: { id: row.slotId, status: 'held' },
            data: { status: 'available' },
          });
          if (slot.count !== 1) {
            throw new ConflictException(
              'Slot state changed during request expiry',
            );
          }
          await this.appendBookingEvent(tx, bookingId, null, 'system', {
            type: 'expired',
            fromStatus: 'requested',
            toStatus: 'expired',
            metadata: { decisionDeadline: now.toISOString() },
          });
        }
        return { kind: 'expired' as const, bookingId };
      }

      if (action === 'accept' && existing.status === 'accepted') {
        return {
          kind: 'decided' as const,
          bookingId,
          idempotent: true,
        };
      }
      if (action === 'decline' && existing.status === 'declined') {
        return {
          kind: 'decided' as const,
          bookingId,
          idempotent: true,
        };
      }

      return { kind: 'conflict' as const, bookingId };
    });
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async releaseExpiredHolds() {
    await this.releaseExpiredTemporaryHolds();
    await this.expireOverdueRequests();
  }

  /** Releases 5-minute holds whose Redis key has disappeared. */
  async releaseExpiredTemporaryHolds(batchSize = EXPIRY_BATCH_SIZE) {
    const heldBookings = await this.prisma.booking.findMany({
      where: { status: 'held', slot: { status: 'held' } },
      select: { id: true, slotId: true },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    for (const booking of heldBookings) {
      const stillHeld = await this.redis.exists(`hold:${booking.slotId}`);
      if (stillHeld) continue;

      const released = await this.prisma.$transaction(async (tx) => {
        const transitioned = await tx.booking.updateMany({
          where: { id: booking.id, status: 'held' },
          data: { status: 'cancelled', cancelledAt: new Date() },
        });
        if (transitioned.count === 0) return false;

        const slot = await tx.availabilitySlot.updateMany({
          where: { id: booking.slotId, status: 'held' },
          data: { status: 'available' },
        });
        if (slot.count === 0) {
          throw new ConflictException('Slot state changed during hold expiry');
        }

        await this.appendBookingEvent(tx, booking.id, null, 'system', {
          type: 'hold_expired',
          fromStatus: 'held',
          toStatus: 'cancelled',
        });

        return true;
      });

      if (released) {
        this.logger.log(`Released expired hold on slot ${booking.slotId}`);
      }
    }
  }

  /**
   * Expires booking requests whose 24-hour operator response deadline passed.
   * The deadline write predicate is authoritative; this sweeper only applies it.
   */
  async expireOverdueRequests(batchSize = EXPIRY_BATCH_SIZE) {
    const now = new Date();
    const overdue = await this.prisma.booking.findMany({
      where: { status: 'requested', decisionDeadline: { lte: now } },
      select: { id: true, slotId: true },
      orderBy: { decisionDeadline: 'asc' },
      take: batchSize,
    });

    for (const booking of overdue) {
      await this.prisma.$transaction(async (tx) => {
        const transitioned = await tx.booking.updateMany({
          where: {
            id: booking.id,
            status: 'requested',
            decisionDeadline: { lte: now },
          },
          data: { status: 'expired' },
        });
        if (transitioned.count === 0) return;

        const slot = await tx.availabilitySlot.updateMany({
          where: { id: booking.slotId, status: 'held' },
          data: { status: 'available' },
        });
        if (slot.count === 0) {
          throw new ConflictException(
            'Slot state changed during request expiry',
          );
        }

        await this.appendBookingEvent(tx, booking.id, null, 'system', {
          type: 'expired',
          fromStatus: 'requested',
          toStatus: 'expired',
          metadata: { decisionDeadline: now.toISOString() },
        });
      });
    }
  }
}
