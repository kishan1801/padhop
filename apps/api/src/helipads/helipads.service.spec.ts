import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HelipadsService } from './helipads.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HelipadsService', () => {
  let service: HelipadsService;
  let prisma: {
    helipad: { findMany: jest.Mock };
    availabilitySlot: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      helipad: { findMany: jest.fn() },
      availabilitySlot: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        HelipadsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(HelipadsService);
  });

  describe('findNearest', () => {
    it('filters out slots that have already started', async () => {
      await service.findNearest(12.97, 77.59);

      const [query] = prisma.$queryRaw.mock.calls[0];
      const sql = query.join('');
      expect(sql).toContain('s.start_time > now()');
      expect(sql).toContain('s.end_time > now()');
    });

    it('rejects invalid coordinates and search radii', async () => {
      await expect(service.findNearest(91, 77.59)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.findNearest(12.97, 77.59, 0)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('findAvailableSlots', () => {
    it('requires both the start and end times to be in the future', async () => {
      await service.findAvailableSlots('helipad-1');

      const query = prisma.availabilitySlot.findMany.mock.calls[0][0];
      expect(query.where.startTime.gt).toBeInstanceOf(Date);
      expect(query.where.endTime.gt).toBe(query.where.startTime.gt);
    });
  });
});
