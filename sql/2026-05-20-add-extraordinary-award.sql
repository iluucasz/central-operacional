ALTER TABLE payroll
ADD COLUMN IF NOT EXISTS extraordinary_award_value NUMERIC(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN payroll.extraordinary_award_value IS
  'Premiacao extraordinaria por meta de OS: 80 OS = 250, 160 OS = 600.';
