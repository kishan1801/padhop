import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { AircraftService } from './aircraft.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AircraftService', () => {
  let service: AircraftService;
  let prisma: {
    operator: { findUnique: jest.Mock };
    aircraft: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      operator: { findUnique: jest.fn() },
      aircraft: { findUnique: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [AircraftService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AircraftService);
  });

  describe('createSlot - ownership check', () => {
    it('throws ForbiddenException if the aircraft belongs to a different operator', async () => {
      prisma.operator.findUnique.mockResolvedValue({
        id: 'operator-1',
        verified: true,
      });
      prisma.aircraft.findUnique.mockResolvedValue({
        id: 'aircraft-1',
        operatorId: 'a-different-operator-id',
      });

      await expect(
        service.createSlot('user-1', 'aircraft-1', 'helipad-1', new Date(), new Date(Date.now() + 3600000)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException if the operator is not yet verified', async () => {
      prisma.operator.findUnique.mockResolvedValue({
        id: 'operator-1',
        verified: false,
      });

      await expect(
        service.createSlot('user-1', 'aircraft-1', 'helipad-1', new Date(), new Date(Date.now() + 3600000)),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});