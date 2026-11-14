import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HelipadsService } from './helipads.service';
import { PrismaService } from '../prisma/prisma.service';

describe('HelipadsService', () => {
  let service: HelipadsService;
  let prisma: {
    helipad: { findMany: jest.Mock; findUnique: jest.Mock };
    availabilitySlot: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      helipad: { findMany: jest.fn(), findUnique: jest.fn() },
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

  describe('searchByRoute', () => {
    const origin = {
      id: 'origin-1',
      name: 'HAL Helipad',
      city: 'Bengaluru',
    };
    const destination = {
      id: 'destination-1',
      name: 'Electronic City Helipad',
      city: 'Bengaluru',
    };

    const slot = {
      id: 'slot-1',
      startTime: new Date('2026-12-01T10:00:00.000Z'),
      endTime: new Date('2026-12-01T11:00:00.000Z'),
      aircraft: {
        model: 'Bell 407',
        capacity: 6,
        registration: 'VT-ABC1',
        operator: { companyName: 'SkyCharters Pvt Ltd' },
      },
    };

    beforeEach(() => {
      prisma.helipad.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === origin.id) return Promise.resolve(origin);
          if (where.id === destination.id) return Promise.resolve(destination);
          return Promise.resolve(null);
        },
      );
    });

    it('returns declared slots for the requested origin and destination', async () => {
      prisma.availabilitySlot.findMany.mockResolvedValue([slot]);

      const result = await service.searchByRoute(origin.id, destination.id);

      expect(result).toEqual({ origin, destination, slots: [slot] });
      const query = prisma.availabilitySlot.findMany.mock.calls[0][0];
      expect(query.where.helipadId).toBe(origin.id);
      expect(query.where.destinationHelipadId).toBe(destination.id);
      expect(query.where.status).toBe('available');
      expect(query.orderBy).toEqual([{ startTime: 'asc' }, { id: 'asc' }]);
    });

    it('rejects a missing origin id', async () => {
      await expect(service.searchByRoute('   ', destination.id)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.helipad.findUnique).not.toHaveBeenCalled();
      expect(prisma.availabilitySlot.findMany).not.toHaveBeenCalled();
    });

    it('rejects a missing destination id', async () => {
      await expect(service.searchByRoute(origin.id, '')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.helipad.findUnique).not.toHaveBeenCalled();
      expect(prisma.availabilitySlot.findMany).not.toHaveBeenCalled();
    });

    it('returns 404 when the origin helipad does not exist', async () => {
      await expect(service.searchByRoute('missing', destination.id)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.availabilitySlot.findMany).not.toHaveBeenCalled();
    });

    it('returns 404 when the destination helipad does not exist', async () => {
      await expect(service.searchByRoute(origin.id, 'missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.availabilitySlot.findMany).not.toHaveBeenCalled();
    });

    it('rejects identical origin and destination', async () => {
      await expect(service.searchByRoute(origin.id, origin.id)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.availabilitySlot.findMany).not.toHaveBeenCalled();
    });

    it('excludes legacy slots with a NULL destination', async () => {
      await service.searchByRoute(origin.id, destination.id);

      const query = prisma.availabilitySlot.findMany.mock.calls[0][0];
      // Exact-match filter means NULL destinations can never match
      expect(query.where.destinationHelipadId).toBe(destination.id);
      expect(query.where.destinationHelipadId).not.toBeNull();
      expect(query.where.OR).toBeUndefined();
    });

    it('excludes slots declared for a different destination', async () => {
      await service.searchByRoute(origin.id, destination.id);

      const query = prisma.availabilitySlot.findMany.mock.calls[0][0];
      expect(query.where.destinationHelipadId).toBe(destination.id);
      expect(query.where.destinationHelipadId).not.toBe(origin.id);
      expect(query.where.destinationHelipadId).not.toBe('other-destination');
    });

    it('excludes held or otherwise unavailable slots', async () => {
      await service.searchByRoute(origin.id, destination.id);

      const query = prisma.availabilitySlot.findMany.mock.calls[0][0];
      expect(query.where.status).toBe('available');
    });

    it('excludes slots that are already in the past', async () => {
      await service.searchByRoute(origin.id, destination.id);

      const query = prisma.availabilitySlot.findMany.mock.calls[0][0];
      expect(query.where.startTime.gt).toBeInstanceOf(Date);
      expect(query.where.endTime.gt).toBeInstanceOf(Date);
      expect(query.where.endTime.gt).toBe(query.where.startTime.gt);
      expect(query.where.startTime.gt.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    });

    it('includes aircraft and operator details in the response selection', async () => {
      await service.searchByRoute(origin.id, destination.id);

      const query = prisma.availabilitySlot.findMany.mock.calls[0][0];
      expect(query.select.aircraft.select).toEqual({
        model: true,
        capacity: true,
        registration: true,
        operator: { select: { companyName: true } },
      });
      expect(query.select.id).toBe(true);
      expect(query.select.startTime).toBe(true);
      expect(query.select.endTime).toBe(true);
    });

    it('returns an empty slot list cleanly when no declared leg exists', async () => {
      prisma.availabilitySlot.findMany.mockResolvedValue([]);

      const result = await service.searchByRoute(origin.id, destination.id);

      expect(result).toEqual({ origin, destination, slots: [] });
    });
  });
});
