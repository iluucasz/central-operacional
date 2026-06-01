ALTER TABLE services
ADD COLUMN IF NOT EXISTS time_performed TIME;

COMMENT ON COLUMN services.time_performed IS
  'Hora do atendimento da ordem de servico.';
