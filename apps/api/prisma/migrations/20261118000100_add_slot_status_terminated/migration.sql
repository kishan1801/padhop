-- Additive SlotStatus value only. Not used in this migration.
ALTER TYPE "SlotStatus" ADD VALUE IF NOT EXISTS 'terminated';
