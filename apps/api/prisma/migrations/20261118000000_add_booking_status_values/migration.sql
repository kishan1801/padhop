-- Additive BookingStatus values only. New values must not be used in this migration.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'requested';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'accepted';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'declined';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'cancelled_by_passenger';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'cancelled_by_operator';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'terminated_by_operator';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'in_progress';
