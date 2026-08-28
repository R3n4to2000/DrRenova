-- Renovamed — Pilot Readiness — Migration 0012: Transactional Outbox
--
-- Item 3: decisão clínica + audit + outbox precisam commitar juntos, na
-- MESMA transação; a chamada externa (ex.: enviar WhatsApp) acontece DEPOIS
-- do commit, lida por um dispatcher separado, com retry/backoff e
-- idempotência. Uma falha do provedor externo NUNCA desfaz a mutação
-- clínica que já foi persistida.

CREATE TYPE outbox_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD_LETTER');

CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  status          outbox_status NOT NULL DEFAULT 'PENDING',
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  idempotency_key text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX idx_outbox_pending ON outbox_events(status, next_attempt_at) WHERE status IN ('PENDING','FAILED');

GRANT SELECT, INSERT, UPDATE ON outbox_events TO app_runtime;
