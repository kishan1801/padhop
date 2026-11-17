-- CreateEnum
CREATE TYPE "BookingEventType" AS ENUM (
  'held_created',
  'requested',
  'accepted',
  'declined',
  'expired',
  'cancelled_by_passenger',
  'cancelled_by_operator',
  'cancellation_requested',
  'started',
  'completed',
  'terminated',
  'hold_expired'
);

-- CreateTable
CREATE TABLE "booking_events" (
  "id" TEXT NOT NULL,
  "booking_id" TEXT NOT NULL,
  "actor_id" TEXT,
  "actor_role" TEXT NOT NULL,
  "type" "BookingEventType" NOT NULL,
  "from_status" "BookingStatus",
  "to_status" "BookingStatus",
  "reason" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_events_booking_id_created_at_idx" ON "booking_events"("booking_id", "created_at");

-- AddForeignKey
ALTER TABLE "booking_events"
  ADD CONSTRAINT "booking_events_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only enforcement: booking history rows must never be updated or deleted
CREATE OR REPLACE FUNCTION prevent_booking_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'booking_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_events_append_only
  BEFORE UPDATE OR DELETE ON "booking_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_booking_event_mutation();
