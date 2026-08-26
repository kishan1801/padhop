import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HelipadsService {
  constructor(private prisma: PrismaService) {}

  async findNearest(latitude: number, longitude: number, radiusKm = 50) {
    const radiusMeters = radiusKm * 1000;

    return this.prisma.$queryRaw`
      SELECT
        id,
        name,
        city,
        latitude,
        longitude,
        ST_Distance(
          location,
          ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
        ) / 1000 AS distance_km
      FROM helipads
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        ${radiusMeters}
      )
      ORDER BY distance_km ASC;
    `;
  }
}
