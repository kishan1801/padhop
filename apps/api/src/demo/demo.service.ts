import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const MIN_SLOTS_PER_HELIPAD = 2;
const DEMO_AIRCRAFT_REGISTRATION = 'VT-TEST1';

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(private prisma: PrismaService) { }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async replenishDemoAvailability() {
    const aircraft = await this.prisma.aircraft.findUnique({
      where: { registration: DEMO_AIRCRAFT_REGISTRATION },
    });
    if (!aircraft) {
      this.logger.warn('Demo aircraft not found - skipping replenishment');
      return;
    }

    const helipads = await this.prisma.helipad.findMany();

    for (const helipad of helipads) {
      const availableCount = await this.prisma.availabilitySlot.count({
        where: {
          helipadId: helipad.id,
          status: 'available',
          endTime: { gt: new Date() },
        },
      });

      const needed = MIN_SLOTS_PER_HELIPAD - availableCount;
      if (needed <= 0) continue;

      for (let i = 0; i < needed; i++) {
        const startTime = new Date(Date.now() + (i + 1) * 60 * 60 * 1000);
        const endTime = new Date(startTime.getTime() + 3 * 60 * 60 * 1000);

        await this.prisma.availabilitySlot.create({
          data: {
            aircraftId: aircraft.id,
            helipadId: helipad.id,
            startTime,
            endTime,
            status: 'available',
          },
        });
      }

      this.logger.log(`Replenished ${needed} demo slot(s) at ${helipad.name}`);
    }
  }
}