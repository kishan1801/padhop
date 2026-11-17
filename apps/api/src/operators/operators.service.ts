import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_TARGETS } from '../audit/audit.constants';

@Injectable()
export class OperatorsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async onboard(userId: string, companyName: string) {
    const existing = await this.prisma.operator.findUnique({
      where: { userId },
    });
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

  async verify(operatorId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Actor identity comes from the authenticated request, but the role is
      // read from the database so the audit record reflects authoritative state.
      const actor = await tx.user.findUnique({
        where: { id: actorUserId },
        select: { id: true, role: true },
      });
      if (!actor) {
        throw new ForbiddenException('Authenticated actor not found');
      }

      const existing = await tx.operator.findUnique({
        where: { id: operatorId },
        select: { id: true, verified: true },
      });
      if (!existing) {
        throw new NotFoundException('Operator not found');
      }

      // Repeated verification is an idempotent no-op: no state change and no
      // duplicate audit event. Only the first transition writes an event.
      if (existing.verified) {
        return tx.operator.findUniqueOrThrow({ where: { id: operatorId } });
      }

      // Conditional transition keeps concurrent verifications from writing
      // duplicate audit records.
      const claimed = await tx.operator.updateMany({
        where: { id: operatorId, verified: false },
        data: { verified: true },
      });
      if (claimed.count === 0) {
        return tx.operator.findUniqueOrThrow({ where: { id: operatorId } });
      }

      const operator = await tx.operator.findUniqueOrThrow({
        where: { id: operatorId },
      });

      await this.audit.record(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: AUDIT_ACTIONS.OPERATOR_VERIFIED,
          targetType: AUDIT_TARGETS.OPERATOR,
          targetId: operator.id,
          metadata: {
            companyName: operator.companyName,
            verified: operator.verified,
          },
        },
        tx,
      );

      return operator;
    });
  }
}
