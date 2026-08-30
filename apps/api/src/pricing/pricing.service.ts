import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const BASE_PRICE_PER_SEAT = 8000; // ₹8,000 base, adjust as realistic for India

@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService) { }

  async calculatePrice(helipadId: string, capacity: number): Promise<{
    pricePerSeat: number;
    totalPrice: number;
    demandMultiplier: number;
    availableNearby: number;
    heldNearby: number;
  }> {
    const [available, held] = await Promise.all([
      this.prisma.availabilitySlot.count({
        where: { helipadId, status: 'available', endTime: { gt: new Date() } },
      }),
      this.prisma.availabilitySlot.count({
        where: { helipadId, status: 'held' },
      }),
    ]);

    // Demand ratio: how much of the local supply is currently being held (i.e. in active demand)
    const totalNearby = available + held;
    const demandRatio = totalNearby > 0 ? held / totalNearby : 0;

    // Surge multiplier: scales from 1.0x (no demand) up to 1.6x (high demand, low supply)
    const demandMultiplier = 1 + Math.min(demandRatio, 1) * 0.6;

    const pricePerSeat = Math.round(BASE_PRICE_PER_SEAT * demandMultiplier);
    const totalPrice = pricePerSeat * capacity;

    return {
      pricePerSeat,
      totalPrice,
      demandMultiplier: Number(demandMultiplier.toFixed(2)),
      availableNearby: available,
      heldNearby: held,
    };
  }
}