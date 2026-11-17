-- AlterTable: nullable lifecycle timestamps and cancellation reason
ALTER TABLE "bookings"
  ADD COLUMN "requested_at" TIMESTAMP(3),
  ADD COLUMN "decision_deadline" TIMESTAMP(3),
  ADD COLUMN "accepted_at" TIMESTAMP(3),
  ADD COLUMN "declined_at" TIMESTAMP(3),
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "cancelled_at" TIMESTAMP(3),
  ADD COLUMN "cancellation_reason" TEXT;

-- CreateIndex
CREATE INDEX "bookings_user_id_status_idx" ON "bookings"("user_id", "status");

-- CreateIndex
CREATE INDEX "bookings_status_decision_deadline_idx" ON "bookings"("status", "decision_deadline");
