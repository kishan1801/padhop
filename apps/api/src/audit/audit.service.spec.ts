import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  AuditService,
  sanitizeAuditMetadata,
} from './audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_ACTIONS, AUDIT_TARGETS } from './audit.constants';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: { auditEvent: { create: jest.Mock } };

  const baseInput = {
    actorId: 'admin-1',
    actorRole: 'admin',
    action: AUDIT_ACTIONS.OPERATOR_VERIFIED,
    targetType: AUDIT_TARGETS.OPERATOR,
    targetId: 'operator-1',
  };

  beforeEach(async () => {
    prisma = { auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) } };

    const module = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AuditService);
  });

  it('records a fully attributed audit event', async () => {
    await service.record({
      ...baseInput,
      reason: '  KYC documents reviewed  ',
      metadata: { companyName: 'Skyline Charters' },
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        actorRole: 'admin',
        action: 'operator.verified',
        targetType: 'operator',
        targetId: 'operator-1',
        reason: 'KYC documents reviewed',
        metadata: { companyName: 'Skyline Charters' },
      },
    });
  });

  it('rejects missing required fields', async () => {
    await expect(
      service.record({ ...baseInput, actorId: '   ' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.record({ ...baseInput, action: '' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.record({ ...baseInput, targetId: '' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('uses the provided transaction client instead of the root client', async () => {
    const txCreate = jest.fn().mockResolvedValue({ id: 'audit-tx' });
    const tx = {
      auditEvent: { create: txCreate },
    } as unknown as Parameters<typeof service.record>[1];

    await service.record(baseInput, tx);

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('strips credential-like metadata keys recursively', () => {
    const sanitized = sanitizeAuditMetadata({
      companyName: 'Skyline Charters',
      password: 'super-secret',
      passwordHash: 'hash',
      sessionToken: 'token',
      nested: {
        apiKey: 'key',
        csrfToken: 'csrf',
        note: 'safe',
      },
      items: [{ token: 'abc', label: 'ok' }],
    });

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toMatch(/super-secret|passwordHash|apiKey|csrfToken|"token"/);
    expect(sanitized).toEqual({
      companyName: 'Skyline Charters',
      nested: { note: 'safe' },
      items: [{ label: 'ok' }],
    });
  });

  it('never persists credential values passed as metadata', async () => {
    await service.record({
      ...baseInput,
      metadata: { note: 'ok', cookie: 'session=abc', password: 'x' },
    });

    const call = prisma.auditEvent.create.mock.calls[0][0];
    expect(JSON.stringify(call)).not.toMatch(/session=abc|"password"/);
  });
});
