-- Replace the active-booking partial unique index predicate.
-- Legacy `confirmed` stays reserved; completed/terminated bookings release the slot.
DROP INDEX "bookings_active_slot_id_key";

CREATE UNIQUE INDEX "bookings_active_slot_id_key"
  ON "bookings"("slot_id")
  WHERE "status" IN ('held', 'requested', 'accepted', 'in_progress', 'confirmed');
