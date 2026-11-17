import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OperatorsService } from './operators.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OperatorsService', () => {
  let service: OperatorsService;
  let tx: {
    user: { findUnique: jest.Mock };
    operator: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
    };
    auditEvent: { create: jest.Mock };
  };
  let prisma: { $transaction: jest.Mock };

  const verifiedOperator = {
    id: 'operator-1',
    companyName: 'Skyline Charters',
    verified: true,
  };

  beforeEach(async () => {
    tx = {
      user: { findUnique: jest.fn() },
      operator: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        OperatorsService,
        AuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(OperatorsService);
  });

  function arrangeFirstVerification() {
    tx.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    tx.operator.findUnique.mockResolvedValue({
      id: 'operator-1',
      verified: false,
    });
    tx.operator.updateMany.mockResolvedValue({ count: 1 });
    tx.operator.findUniqueOrThrow.mockResolvedValue(verifiedOperator);
  }

  it('verifies the operator and records exactly one audit event', async () => {
    arrangeFirstVerification();

    const result = await service.verify('operator-1', 'admin-1');

    expect(result).toEqual(verifiedOperator);
    expect(tx.operator.updateMany).toHaveBeenCalledWith({
      where: { id: 'operator-1', verified: false },
      data: { verified: true },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        actorRole: 'admin',
        action: 'operator.verified',
        targetType: 'operator',
        targetId: 'operator-1',
        reason: null,
        metadata: {
          companyName: 'Skyline Charters',
          verified: true,
        },
      },
    });
  });

  it('derives the actor from the authenticated user id, not request input', async () => {
    arrangeFirstVerification();
    tx.user.findUnique.mockResolvedValue({ id: 'admin-2', role: 'admin' });

    await service.verify('operator-1', 'admin-2');

    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'admin-2' },
      select: { id: true, role: true },
    });
    expect(tx.auditEvent.create.mock.calls[0][0].data.actorId).toBe('admin-2');
    expect(tx.auditEvent.create.mock.calls[0][0].data.actorRole).toBe('admin');
  });

  it('rejects when the authenticated actor no longer exists', async () => {
    tx.user.findUnique.mockResolvedValue(null);

    await expect(service.verify('operator-1', 'ghost')).rejects.toThrow(
      ForbiddenException,
    );
    expect(tx.operator.updateMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown operator without writing an audit event', async () => {
    tx.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    tx.operator.findUnique.mockResolvedValue(null);

    await expect(service.verify('missing', 'admin-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(tx.operator.updateMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('is an idempotent no-op when the operator is already verified', async () => {
    tx.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    tx.operator.findUnique.mockResolvedValue({
      id: 'operator-1',
      verified: true,
    });
    tx.operator.findUniqueOrThrow.mockResolvedValue(verifiedOperator);

    const result = await service.verify('operator-1', 'admin-1');

    expect(result).toEqual(verifiedOperator);
    expect(tx.operator.updateMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not duplicate the audit event when a concurrent request wins the claim', async () => {
    tx.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    tx.operator.findUnique.mockResolvedValue({
      id: 'operator-1',
      verified: false,
    });
    tx.operator.updateMany.mockResolvedValue({ count: 0 });
    tx.operator.findUniqueOrThrow.mockResolvedValue(verifiedOperator);

    const result = await service.verify('operator-1', 'admin-1');

    expect(result).toEqual(verifiedOperator);
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not report success when the audit write fails', async () => {
    arrangeFirstVerification();
    tx.auditEvent.create.mockRejectedValue(new Error('audit unavailable'));

    await expect(service.verify('operator-1', 'admin-1')).rejects.toThrow(
      'audit unavailable',
    );
  });

  it('does not write an audit event when verification itself fails', async () => {
    tx.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    tx.operator.findUnique.mockResolvedValue({
      id: 'operator-1',
      verified: false,
    });
    tx.operator.updateMany.mockRejectedValue(new Error('Record not found'));

    await expect(service.verify('operator-1', 'admin-1')).rejects.toThrow(
      'Record not found',
    );
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('keeps verification behavior compatible', async () => {
    arrangeFirstVerification();

    const result = await service.verify('operator-1', 'admin-1');

    expect(result).toEqual(verifiedOperator);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('never includes credential-like fields in audit metadata', async () => {
    arrangeFirstVerification();

    await service.verify('operator-1', 'admin-1');

    const data = tx.auditEvent.create.mock.calls[0][0].data;
    expect(JSON.stringify(data)).not.toMatch(
      /password|passwordHash|token|secret|cookie|session/i,
    );
  });
});
