CREATE UNIQUE INDEX "bookings_active_slot_id_key"
ON "bookings"("slot_id")
WHERE ("status" IN ('held', 'confirmed'));

DROP INDEX "bookings_slot_id_key";
