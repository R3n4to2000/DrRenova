# Renovamed — Staging Formal

## Healthcheck
`GET /api/health` — verifica conectividade com o banco, se `AUTH_MODE` é seguro para o ambiente (produção nunca aceita `development`), e se as migrations mais recentes foram aplicadas. Retorna 503 se qualquer checagem falhar.

## Variáveis de Ambiente
Ver `.env.staging.example`. Diferença crítica: `AUTH_MODE=supabase` (nunca `development`) e `NODE_ENV=production`. Nenhum secret real neste repositório.

## Seed
`scripts/seed-staging.mjs` — 100% fictício (planos, categoria, questionário). Nunca cria paciente/médico diretamente no banco — isso exigiria um `authUserId` real do Supabase Auth de staging; contas de teste devem vir do fluxo real de cadastro.

## Migrations
14 migrations, aplicadas sequencialmente. Testado do zero, 5× consecutivas, 0 erros.

## Logs Sanitizados
Nenhum `console.log`/`console.error` no código de aplicação imprime dado sensível. `AuditLog.metadata` passa pelo sanitizador central incondicionalmente.

## dev-login Desabilitado em Staging
`AUTH_MODE=supabase` faz `POST /api/dev-login` retornar 403 sempre — testado.

## Deterministic Clinical Rules Vazias
Não populada por nenhum seed de staging/produção — só testes criam regras, sempre com prefixo `TEST_ONLY_`.

## Adapters — Identificação Explícita

| Port | Implementação em staging | Arquivo |
|---|---|---|
| PaymentGatewayPort | fakePaymentGateway — sempre aprova | src/ports/fakes.ts |
| WhatsAppGatewayPort | fakeWhatsAppGateway — loga, não entrega | src/ports/fakes.ts |
| TelemedicineProviderPort | fakeTelemedicineProvider | src/ports/fakes.ts |
| PrescriptionProviderPort | fakePrescriptionProvider | src/ports/fakes.ts |
| IntentClassifierPort | stagingIntentClassifier — heurística, não LLM | src/ports/fakes.ts |
| AnswerStructurerPort | stagingAnswerStructurer — regex simples | src/ports/fakes.ts |
| Auth | Supabase Auth real (verificação offline) — não testado contra projeto real (sem rede/credencial) | src/lib/supabase-auth.ts |

Todos os adapters staging têm o prefixo `fake`/`staging` no próprio nome.
