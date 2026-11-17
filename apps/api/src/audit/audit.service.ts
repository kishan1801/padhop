import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export type RecordAuditEventInput = {
  actorId: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

const FORBIDDEN_METADATA_KEY =
  /pass(word)?|secret|token|hash|cookie|session|authorization|csrf|api[-_]?key/i;

const MAX_IDENTIFIER_LENGTH = 64;
const MAX_REASON_LENGTH = 500;

function requireIdentifier(
  value: string | null | undefined,
  field: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(`${field} is required`);
  }
  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    throw new BadRequestException(
      `${field} must be ${MAX_IDENTIFIER_LENGTH} characters or fewer`,
    );
  }
  return trimmed;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return sanitizeRecord(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (FORBIDDEN_METADATA_KEY.test(key)) continue;
    if (value === undefined) continue;
    cleaned[key] = sanitizeValue(value);
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

/**
 * Removes credential-like keys from audit metadata so secrets can never be
 * persisted in the audit trail.
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;
  const cleaned = sanitizeRecord(metadata);
  return cleaned as Prisma.InputJsonValue | undefined;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends an audit event. Passing a transaction client makes the audit
   * write atomic with the sensitive action it records.
   */
  async record(
    input: RecordAuditEventInput,
    tx?: Prisma.TransactionClient,
  ) {
    const actorId = requireIdentifier(input.actorId, 'actorId');
    const actorRole = requireIdentifier(input.actorRole, 'actorRole');
    const action = requireIdentifier(input.action, 'action');
    const targetType = requireIdentifier(input.targetType, 'targetType');
    const targetId = requireIdentifier(input.targetId, 'targetId');

    const reason = input.reason?.trim()
      ? input.reason.trim().slice(0, MAX_REASON_LENGTH)
      : null;

    const metadata = sanitizeAuditMetadata(input.metadata);

    const client = tx ?? this.prisma;
    return client.auditEvent.create({
      data: {
        actorId,
        actorRole,
        action,
        targetType,
        targetId,
        reason,
        metadata,
      },
    });
  }
}
