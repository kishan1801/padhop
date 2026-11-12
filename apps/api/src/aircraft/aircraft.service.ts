import {
  Injectable,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AircraftService {
  constructor(private prisma: PrismaService) {}

  async listMine(userId: string) {
    const operator = await this.prisma.operator.findUnique({
      where: { userId },
    });
    if (!operator) {
      throw new ForbiddenException(
        'Only registered operators can view their fleet',
      );
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

  async create(
    userId: string,
    model: string,
    capacity: number,
    registration: string,
  ) {
    const normalizedModel = model?.trim();
    const normalizedRegistration = registration?.trim().toUpperCase();

    if (!normalizedModel || !normalizedRegistration) {
      throw new BadRequestException('Model and registration are required');
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new BadRequestException('Capacity must be a positive whole number');
    }

    const operator = await this.prisma.operator.findUnique({
      where: { userId },
    });
    if (!operator) {
      throw new ForbiddenException(
        'Only registered operators can add aircraft',
      );
    }
    if (!operator.verified) {
      throw new ForbiddenException(
        'Your operator account is pending verification',
      );
    }

    const existing = await this.prisma.aircraft.findUnique({
      where: { registration: normalizedRegistration },
    });
    if (existing) {
      throw new ConflictException(
        'An aircraft with this registration already exists',
      );
    }

    return this.prisma.aircraft.create({
      data: {
        operatorId: operator.id,
        model: normalizedModel,
        capacity,
        registration: normalizedRegistration,
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
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new BadRequestException('Start and end times must be valid dates');
    }
    if (startTime <= new Date()) {
      throw new BadRequestException('Start time must be in the future');
    }

    const operator = await this.prisma.operator.findUnique({
      where: { userId },
    });
    if (!operator) {
      throw new ForbiddenException(
        'Only registered operators can manage slots',
      );
    }
    if (!operator.verified) {
      throw new ForbiddenException(
        'Your operator account is pending verification',
      );
    }

    const aircraft = await this.prisma.aircraft.findUnique({
      where: { id: aircraftId },
    });
    if (!aircraft || aircraft.operatorId !== operator.id) {
      throw new ForbiddenException('This aircraft does not belong to you');
    }

    if (endTime <= startTime) {
      throw new BadRequestException('End time must be after start time');
    }

    const helipad = await this.prisma.helipad.findUnique({
      where: { id: helipadId },
      select: { id: true },
    });
    if (!helipad) {
      throw new NotFoundException('Helipad not found');
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
