import { Injectable, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AircraftService {
  constructor(private prisma: PrismaService) { }

  async listMine(userId: string) {
    const operator = await this.prisma.operator.findUnique({ where: { userId } });
    if (!operator) {
      throw new ForbiddenException('Only registered operators can view their fleet');
    }

    return this.prisma.aircraft.findMany({
      where: { operatorId: operator.id },
      include: {
        slots: {
          orderBy: { startTime: 'asc' },
        },
      },
    });
  }

  async create(userId: string, model: string, capacity: number, registration: string) {
    const operator = await this.prisma.operator.findUnique({ where: { userId } });
    if (!operator) {
      throw new ForbiddenException('Only registered operators can add aircraft');
    }
    if (!operator.verified) {
      throw new ForbiddenException('Your operator account is pending verification');
    }

    const existing = await this.prisma.aircraft.findUnique({ where: { registration } });
    if (existing) {
      throw new ConflictException('An aircraft with this registration already exists');
    }

    return this.prisma.aircraft.create({
      data: {
        operatorId: operator.id,
        model,
        capacity,
        registration,
      },
    });
  }

  async createSlot(
    userId: string,
    aircraftId: string,
    helipadId: string,
    startTime: Date,
    endTime: Date,
  ) {
    const operator = await this.prisma.operator.findUnique({ where: { userId } });
    if (!operator) {
      throw new ForbiddenException('Only registered operators can manage slots');
    }
    if (!operator.verified) {
      throw new ForbiddenException('Your operator account is pending verification');
    }

    const aircraft = await this.prisma.aircraft.findUnique({ where: { id: aircraftId } });
    if (!aircraft || aircraft.operatorId !== operator.id) {
      throw new ForbiddenException('This aircraft does not belong to you');
    }

    if (endTime <= startTime) {
      throw new ConflictException('End time must be after start time');
    }

    return this.prisma.availabilitySlot.create({
      data: {
        aircraftId,
        helipadId,
        startTime,
        endTime,
        status: 'available',
      },
    });
  }
}
