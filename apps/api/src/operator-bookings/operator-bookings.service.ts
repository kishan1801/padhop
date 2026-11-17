import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type {
  OperatorBookingDetailDto,
  OperatorBookingListResponseDto,
  OperatorBookingListItemDto,
} from './dto/operator-booking.dto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const DEFAULT_STATUS = 'requested';

const BOOKING_STATUSES = [
  'held',
  'requested',
  'accepted',
  'declined',
  'expired',
  'cancelled_by_passenger',
  'cancelled_by_operator',
  'terminated_by_operator',
  'in_progress',
  'completed',
  'confirmed',
  'cancelled',
] as const;

type BookingStatusValue = (typeof BOOKING_STATUSES)[number];

const listSelect = {
  id: true,
  reference: true,
  status: true,
  price: true,
  createdAt: true,
  requestedAt: true,
  decisionDeadline: true,
  acceptedAt: true,
  declinedAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  user: { select: { name: true } },
  slot: {
    select: {
      startTime: true,
      endTime: true,
      aircraft: {
        select: { model: true, registration: true, capacity: true },
      },
      helipad: { select: { id: true, name: true, city: true } },
    },
  },
  destinationHelipad: { select: { id: true, name: true, city: true } },
} satisfies Prisma.BookingSelect;

type ListRecord = Prisma.BookingGetPayload<{ select: typeof listSelect }>;

type DetailRecord = ListRecord & {
  events: { reason: string | null }[];
};

type CursorPayload = {
  v: 1;
  sort: string;
  id: string;
};

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<CursorPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.sort !== 'string' ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0 ||
      Number.isNaN(Date.parse(parsed.sort))
    ) {
      throw new Error('invalid cursor');
    }
    return { v: 1, sort: parsed.sort, id: parsed.id };
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}

function parseStatus(value: string | undefined): BookingStatusValue {
  const status = (value?.trim() || DEFAULT_STATUS) as BookingStatusValue;
  if (!BOOKING_STATUSES.includes(status)) {
    throw new BadRequestException('Unsupported booking status filter');
  }
  return status;
}

function parseLimit(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_LIMIT;
  if (!/^\d+$/.test(value.trim())) {
    throw new BadRequestException('limit must be a positive whole number');
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException(`limit must be between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

function toListItem(record: ListRecord): OperatorBookingListItemDto {
  return {
    bookingId: record.id,
    reference: record.reference,
    status: record.status,
    price: Number(record.price),
    createdAt: record.createdAt,
    requestedAt: record.requestedAt,
    decisionDeadline: record.decisionDeadline,
    passengerName: record.user.name,
    origin: record.slot.helipad,
    destination: record.destinationHelipad,
    slot: {
      startTime: record.slot.startTime,
      endTime: record.slot.endTime,
    },
    aircraft: {
      model: record.slot.aircraft.model,
      registration: record.slot.aircraft.registration,
      capacity: record.slot.aircraft.capacity,
    },
  };
}

@Injectable()
export class OperatorBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireOperator(userId: string) {
    const operator = await this.prisma.operator.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!operator) {
      throw new ForbiddenException(
        'Only registered operators can view booking requests',
      );
    }
    return operator;
  }

  async list(
    userId: string,
    query: { status?: string; limit?: string; cursor?: string },
  ): Promise<OperatorBookingListResponseDto> {
    const operator = await this.requireOperator(userId);
    const status = parseStatus(query.status);
    const limit = parseLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const isRequested = status === 'requested';
    const where: Prisma.BookingWhereInput = {
      status,
      slot: { aircraft: { operatorId: operator.id } },
    };

    if (cursor) {
      const sortDate = new Date(cursor.sort);
      where.OR = isRequested
        ? [
            { decisionDeadline: { gt: sortDate } },
            { decisionDeadline: sortDate, id: { gt: cursor.id } },
          ]
        : [
            { createdAt: { lt: sortDate } },
            { createdAt: sortDate, id: { lt: cursor.id } },
          ];
    }

    const records = await this.prisma.booking.findMany({
      where,
      orderBy: isRequested
        ? [{ decisionDeadline: 'asc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: listSelect,
    });

    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            v: 1,
            sort: (isRequested
              ? last.decisionDeadline?.toISOString()
              : last.createdAt.toISOString()) ?? last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    return { items: page.map(toListItem), nextCursor };
  }

  async detail(userId: string, bookingId: string): Promise<OperatorBookingDetailDto> {
    const operator = await this.requireOperator(userId);

    const booking: DetailRecord | null = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        slot: { aircraft: { operatorId: operator.id } },
      },
      select: {
        ...listSelect,
        events: {
          where: { type: 'declined', reason: { not: null } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { reason: true },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    return {
      ...toListItem(booking),
      acceptedAt: booking.acceptedAt,
      declinedAt: booking.declinedAt,
      startedAt: booking.startedAt,
      completedAt: booking.completedAt,
      cancelledAt: booking.cancelledAt,
      cancellationReason: booking.cancellationReason,
      declineReason: booking.events[0]?.reason ?? null,
    };
  }
}
