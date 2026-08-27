import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OperatorsService {
  constructor(private prisma: PrismaService) { }

  async onboard(userId: string, companyName: string) {
    const existing = await this.prisma.operator.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException('You are already registered as an operator');
    }

    const operator = await this.prisma.operator.create({
      data: { userId, companyName, verified: false },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'operator' },
    });

    return operator;
  }

  async listPending() {
    return this.prisma.operator.findMany({ where: { verified: false } });
  }

  async verify(operatorId: string) {
    return this.prisma.operator.update({
      where: { id: operatorId },
      data: { verified: true },
    });
  }
}