export const AUDIT_ACTIONS = {
  OPERATOR_VERIFIED: 'operator.verified',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_TARGETS = {
  OPERATOR: 'operator',
} as const;

export type AuditTargetType =
  (typeof AUDIT_TARGETS)[keyof typeof AUDIT_TARGETS];
