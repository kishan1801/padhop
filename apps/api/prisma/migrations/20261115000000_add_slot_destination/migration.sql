-- AlterTable: add nullable declared destination (legacy rows remain NULL)
ALTER TABLE "availability_slots" ADD COLUMN "destination_helipad_id" TEXT;

-- AddForeignKey
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_destination_helipad_id_fkey" FOREIGN KEY ("destination_helipad_id") REFERENCES "helipads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "availability_slots_helipad_id_destination_helipad_id_idx" ON "availability_slots"("helipad_id", "destination_helipad_id");

-- Destination, when declared, must differ from the origin helipad
ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_destination_differs_from_origin_check" CHECK ("destination_helipad_id" IS NULL OR "destination_helipad_id" <> "helipad_id");
