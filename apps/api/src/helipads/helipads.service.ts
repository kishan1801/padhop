import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HelipadsService {
  constructor(private prisma: PrismaService) {}

  async listAll() {
    return this.prisma.helipad.findMany({
      select: { id: true, name: true, city: true },
      orderBy: { name: 'asc' },
    });
  }

  async findNearest(latitude: number, longitude: number, radiusKm = 50) {
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      !Number.isFinite(radiusKm) ||
      radiusKm <= 0
    ) {
      throw new BadRequestException('Invalid location or search radius');
    }

    const radiusMeters = radiusKm * 1000;

    return this.prisma.$queryRaw`
    SELECT
      h.id,
      h.name,
      h.city,
      h.latitude,
      h.longitude,
      ST_Distance(
        h.location,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
      ) / 1000 AS distance_km,
     COUNT(s.id)::int AS available_slots
    FROM helipads h
    INNER JOIN availability_slots s ON s.helipad_id = h.id
    WHERE
      s.status = 'available'
      AND s.start_time > now()
      AND s.end_time > now()
      AND ST_DWithin(
        h.location,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        ${radiusMeters}
      )
    GROUP BY h.id, h.name, h.city, h.latitude, h.longitude, h.location
    ORDER BY distance_km ASC;
  `;
  }

  async findAvailableSlots(helipadId: string) {
    const now = new Date();

    return this.prisma.availabilitySlot.findMany({
      where: {
        helipadId,
        status: 'available',
        startTime: { gt: now },
        endTime: { gt: now },
      },
      orderBy: { startTime: 'asc' },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        aircraft: {
          select: { model: true, capacity: true, registration: true },
        },
      },
    });
  }

  async searchByRoute(originId: string, destinationId: string) {
    const originKey = originId?.trim();
    const destinationKey = destinationId?.trim();
    if (!originKey || !destinationKey) {
      throw new BadRequestException(
        'originId and destinationId are required',
      );
    }

    const origin = await this.prisma.helipad.findUnique({
      where: { id: originKey },
      select: { id: true, name: true, city: true },
    });
    if (!origin) {
      throw new NotFoundException('Origin helipad not found');
    }

    const destination = await this.prisma.helipad.findUnique({
      where: { id: destinationKey },
      select: { id: true, name: true, city: true },
    });
    if (!destination) {
      throw new NotFoundException('Destination helipad not found');
    }

    if (origin.id === destination.id) {
      throw new BadRequestException(
        'Origin and destination must be different helipads',
      );
    }

    const now = new Date();

    const slots = await this.prisma.availabilitySlot.findMany({
      where: {
        helipadId: origin.id,
        destinationHelipadId: destination.id,
        status: 'available',
        startTime: { gt: now },
        endTime: { gt: now },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
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
      },
    });

    return {
      origin,
      destination,
      slots,
    };
  }
}
