-- Issue #10: new fields for the size-transition estimators (§4.5, §8).
-- All nullable: an old client keeps working and simply sends no value.

ALTER TABLE babies  ADD COLUMN sex TEXT;
ALTER TABLE babies  ADD COLUMN gestational_weeks INTEGER;
ALTER TABLE babies  ADD COLUMN birth_weight_kg REAL;
ALTER TABLE weights ADD COLUMN length_cm REAL;
