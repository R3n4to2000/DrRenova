# Renovamed — Pilot Readiness (MVP v1.0)

## Tabela de Componentes

| Componente | Status | Piloto interno | Piloto externo | Ação restante |
|---|---|---|---|---|
| Auth/MFA | REAL | Sim | Sim | Testar contra projeto Supabase real |
| RLS | REAL | Sim | Sim | — |
| Outbox | REAL | Sim | Sim | — |
| WhatsApp (identidade) | REAL | Sim | Sim | — |
| WhatsApp (envio) | STAGING | Sim | Não | Contratar provedor |
| Payment | STAGING | Sim | Não | Contratar provedor |
| Prescription | STAGING | Sim | Não | Fornecedor jurídico válido |
| Telemedicine | STAGING (OWN_DOCTOR não-bloqueante) | Sim | Parcial | Provedor externo se não usar médico próprio |
| Camilla/LLM | STAGING (heurística) | Sim | Não | Credencial de LLM |
| KMS | BLOQUEADO | Sim | Não | Provedor de nuvem (KMS gerenciado) |
| Regra 180 dias | REAL (config) | Sim | Não | Decisão jurídico-médica |
| Aprovação médica (Safety Rules) | BLOQUEADO | Sim | Não | Direção Médica aprovar checklist |
| Admin | REAL | Sim | Sim | — |

## Métricas (regressão final)

- Testes: 113/113, 0 falhas, 0 skips, 5x consecutivas sem flakiness (banco reconstruído do zero).
- Migrations: 14, 0 erros do zero.
- Schema: 31 tabelas, 0 divergências, 0 órfãs.
- Typecheck/lint/build: verdes.
- E2E: Playwright bloqueado por política de rede do ambiente de build — equivalente funcional (mesma cadeia de Commands da Jornada 1) implementado e passando.

## PILOTO INTERNO: GO

Condições: dados fictícios, adapters staging, nenhuma cobrança real, nenhuma prescrição juridicamente real.

## PILOTO EXTERNO CONTROLADO: NO-GO — 6 dependências de ativação

Nenhuma é falta de funcionalidade — todas são credencial/contrato/decisão humana:

1. Supabase Auth real (projeto/credencial)
2. WhatsApp provider real (credencial)
3. Payment provider real (credencial)
4. Prescription provider jurídico (contrato)
5. KMS gerenciado (provedor de nuvem)
6. Aprovação médica das Safety Rules + regra dos 180 dias (decisão humana)

## LANÇAMENTO COMERCIAL

Condicionado às mesmas 6 dependências acima, mais decisão comercial de precificação/contrato com os fornecedores escolhidos.
