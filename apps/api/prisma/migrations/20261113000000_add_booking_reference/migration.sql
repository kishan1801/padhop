-- Add booking reference column (nullable initially)
ALTER TABLE "bookings" ADD COLUMN "reference" VARCHAR(20);

-- Backfill existing bookings with unique references
-- Uses deterministic sequence per UTC date, ordered by created_at then id
-- Encodes sequence in 32-char alphabet (ABCDEFGHJKLMNPQRSTUVWXYZ23456789), left-padded to 8 chars with 'A'
WITH sequenced AS (
  SELECT
    id,
    created_at,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDD') AS ref_date,
    ROW_NUMBER() OVER (
      PARTITION BY to_char(created_at AT TIME ZONE 'UTC', 'YYYYMMDD')
      ORDER BY created_at, id
    ) - 1 AS seq
  FROM "bookings"
  WHERE "reference" IS NULL
),
encoded AS (
  SELECT
    id,
    ref_date,
    seq,
    -- Base32 encode using the 32-character alphabet
    -- 8 characters supports up to 32^8 ≈ 1.1T values per day
    (
      SELECT string_agg(chr, '' ORDER BY pos DESC)
      FROM (
        SELECT
          pos,
          substring('ABCDEFGHJKLMNPQRSTUVWXYZ23456789' FROM ((seq::bigint / power_val) % 32)::int + 1 FOR 1) AS chr
        FROM generate_series(0, 7) AS pos
        CROSS JOIN LATERAL (
          SELECT CASE pos
            WHEN 0 THEN 1::bigint
            WHEN 1 THEN 32::bigint
            WHEN 2 THEN 1024::bigint
            WHEN 3 THEN 32768::bigint
            WHEN 4 THEN 1048576::bigint
            WHEN 5 THEN 33554432::bigint
            WHEN 6 THEN 1073741824::bigint
            WHEN 7 THEN 34359738368::bigint
          END AS power_val
        ) pv
      ) sub
    ) AS suffix
  FROM sequenced
)
UPDATE "bookings" b
SET "reference" = 'PH-' || e.ref_date || '-' || e.suffix
FROM encoded e
WHERE b.id = e.id;

-- Verify all existing bookings have references and no duplicates
DO $$
DECLARE
  null_count int;
  dup_count int;
BEGIN
  SELECT count(*) INTO null_count FROM "bookings" WHERE "reference" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % bookings still have NULL reference', null_count;
  END IF;

  SELECT count(*) INTO dup_count
  FROM (
    SELECT "reference" FROM "bookings" GROUP BY "reference" HAVING count(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % duplicate references found', dup_count;
  END IF;
END $$;

-- Add unique index
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- Set NOT NULL
ALTER TABLE "bookings" ALTER COLUMN "reference" SET NOT NULL;