-- 003_relax_hospitals_district.sql
-- Relax hospitals.district_id to NULLABLE for environments already migrated with 001.
-- Idempotent: DROP NOT NULL is a no-op if the column is already nullable.

ALTER TABLE hospitals ALTER COLUMN district_id DROP NOT NULL;
