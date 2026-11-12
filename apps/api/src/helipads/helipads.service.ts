import { BadRequestException, Injectable } from '@nestjs/common';
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
}
