# Renovamed — by Plenno Medical

**MVP v1.0 — SOFTWARE CONCLUÍDO.** Plataforma de continuidade de tratamento para condições crônicas (Brasil), com Treatment Continuity Engine, cockpit médico, Camilla (assistente de cuidado) e admin operacional.

> "Seu tratamento não pode parar."

## Documentação

- **Começar a desenvolver:** [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- **Arquitetura:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Decisões técnicas (ADRs):** [`docs/DECISOES-TECNICAS.md`](docs/DECISOES-TECNICAS.md)
- **Segurança:** [`docs/SECURITY.md`](docs/SECURITY.md)
- **Staging:** [`docs/STAGING.md`](docs/STAGING.md)
- **Prontidão para piloto:** [`docs/PILOT-READINESS.md`](docs/PILOT-READINESS.md)
- **Matriz de fornecedores:** [`docs/PROVIDERS.md`](docs/PROVIDERS.md)
- **Checklist da Direção Médica:** [`docs/DIRECAO-MEDICA-CHECKLIST.md`](docs/DIRECAO-MEDICA-CHECKLIST.md)
- **Regra dos 180 dias:** [`docs/REGRA-180-DIAS.md`](docs/REGRA-180-DIAS.md)
- **Pendências reais:** [`docs/PENDENCIAS.md`](docs/PENDENCIAS.md)
- **Relatório de release:** [`docs/RELEASE-MVP-V1.md`](docs/RELEASE-MVP-V1.md)

## Stack

Next.js (App Router) + TypeScript + PostgreSQL 16 + `pg` (node-postgres) — ver ADR-001 em `DECISOES-TECNICAS.md` sobre por que não Prisma Client neste ambiente.

## Status

**Piloto interno: GO.** Piloto externo e lançamento comercial dependem de ativação de produção (credenciais/fornecedores/aprovações — nunca funcionalidade faltante). Ver `docs/PILOT-READINESS.md`.
