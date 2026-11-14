import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AircraftService } from './aircraft.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AircraftService', () => {
  let service: AircraftService;
  let prisma: {
    operator: { findUnique: jest.Mock };
    aircraft: { findUnique: jest.Mock };
    helipad: { findUnique: jest.Mock };
    availabilitySlot: { create: jest.Mock };
  };

  const futureStart = () => new Date(Date.now() + 60_000);
  const futureEnd = () => new Date(Date.now() + 3_660_000);
  const readyOperator = () => {
    prisma.operator.findUnique.mockResolvedValue({
      id: 'operator-1',
      verified: true,
    });
    prisma.aircraft.findUnique.mockResolvedValue({
      id: 'aircraft-1',
      operatorId: 'operator-1',
    });
  };

  beforeEach(async () => {
    prisma = {
      operator: { findUnique: jest.fn() },
      aircraft: { findUnique: jest.fn() },
      helipad: {
        findUnique: jest.fn().mockImplementation(
          ({ where }: { where: { id: string } }) =>
            Promise.resolve(
              ['helipad-1', 'helipad-2'].includes(where.id)
                ? { id: where.id }
                : null,
            ),
        ),
      },
      availabilitySlot: {
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'slot-1',
          ...data,
        })),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        AircraftService,
        { provide: PrismaService, useValue: prisma },
      ],
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
        service.createSlot(
          'user-1',
          'aircraft-1',
          'helipad-1',
          'helipad-2',
          futureStart(),
          futureEnd(),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException if the operator is not yet verified', async () => {
      prisma.operator.findUnique.mockResolvedValue({
        id: 'operator-1',
        verified: false,
      });

      await expect(
        service.createSlot(
          'user-1',
          'aircraft-1',
          'helipad-1',
          'helipad-2',
          futureStart(),
          futureEnd(),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });
  });

  describe('createSlot - declared route', () => {
    it('creates an available slot with both origin and destination', async () => {
      readyOperator();

      const result = await service.createSlot(
        'user-1',
        'aircraft-1',
        'helipad-1',
        'helipad-2',
        futureStart(),
        futureEnd(),
      );

      expect(prisma.availabilitySlot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          aircraftId: 'aircraft-1',
          helipadId: 'helipad-1',
          destinationHelipadId: 'helipad-2',
          status: 'available',
        }),
      });
      expect(result).toEqual(
        expect.objectContaining({
          helipadId: 'helipad-1',
          destinationHelipadId: 'helipad-2',
        }),
      );
    });

    it('requires an origin helipad', async () => {
      readyOperator();

      await expect(
        service.createSlot(
          'user-1',
          'aircraft-1',
          '',
          'helipad-2',
          futureStart(),
          futureEnd(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });

    it('requires a destination helipad', async () => {
      readyOperator();

      await expect(
        service.createSlot(
          'user-1',
          'aircraft-1',
          'helipad-1',
          '   ',
          futureStart(),
          futureEnd(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown origin helipad with 404', async () => {
      readyOperator();

      await expect(
        service.createSlot(
          'user-1',
          'aircraft-1',
          'missing-origin',
          'helipad-2',
          futureStart(),
          futureEnd(),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown destination helipad with 404', async () => {
      readyOperator();

      await expect(
        service.createSlot(
          'user-1',
          'aircraft-1',
          'helipad-1',
          'missing-destination',
          futureStart(),
          futureEnd(),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });

    it('rejects identical origin and destination', async () => {
      readyOperator();

      await expect(
        service.createSlot(
          'user-1',
          'aircraft-1',
          'helipad-1',
          'helipad-1',
          futureStart(),
          futureEnd(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });

    it('rejects a start time in the past', async () => {
      readyOperator();

      await expect(
        service.createSlot(
          'user-1',
          'aircraft-1',
          'helipad-1',
          'helipad-2',
          new Date(Date.now() - 60_000),
          futureEnd(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });

    it('rejects invalid dates', async () => {
      readyOperator();

      await expect(
        service.createSlot(
          'user-1',
          'aircraft-1',
          'helipad-1',
          'helipad-2',
          new Date('invalid'),
          futureEnd(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });

    it('rejects an end time that is not after the start time', async () => {
      readyOperator();
      const start = futureStart();

      await expect(
        service.createSlot(
          'user-1',
          'aircraft-1',
          'helipad-1',
          'helipad-2',
          start,
          start,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.availabilitySlot.create).not.toHaveBeenCalled();
    });
  });
});
