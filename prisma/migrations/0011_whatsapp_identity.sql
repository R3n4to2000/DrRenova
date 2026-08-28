-- Renovamed — Pilot Readiness — Migration 0011: identidade WhatsApp segura
--
-- Item 2: número/canal → Patient nunca pode confiar em um `patientId`
-- enviado externamente (webhook). Resolvemos o paciente pelo HASH do
-- WhatsApp (mesmo padrão já usado para CPF — HMAC-SHA256, não reversível,
-- nunca loga o número em claro).

ALTER TABLE patients ADD COLUMN whatsapp_hash text;
CREATE UNIQUE INDEX idx_patients_whatsapp_hash ON patients(whatsapp_hash) WHERE whatsapp_hash IS NOT NULL;

-- Nullable propositalmente — permite backfill gradual sem quebrar
-- constraint. Sem dados reais de produção, o backfill é trivial;
-- documentado como pendência formal antes de qualquer paciente real.
