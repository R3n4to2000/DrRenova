-- Renovamed — Pilot Readiness — Migration 0013: Outbox — claim atômico
--
-- Item 3 (validação): a implementação original de dispatchPending() fazia
-- SELECT (sem lock) e só marcava o status DEPOIS de tentar enviar — dois
-- dispatchers concorrentes podiam pegar a MESMA linha PENDING e enviar a
-- mensagem duas vezes antes que qualquer um marcasse o status. Corrigido
-- com claim atômico via `FOR UPDATE SKIP LOCKED` + status intermediário
-- PROCESSING, e uma coluna para detectar/recuperar eventos presos.

ALTER TYPE outbox_status ADD VALUE 'PROCESSING';

ALTER TABLE outbox_events ADD COLUMN processing_since timestamptz;
