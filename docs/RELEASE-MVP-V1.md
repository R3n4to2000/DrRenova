# Renovamed — RELEASE-MVP-V1.md

## Software

- Migrations: 14, aplicadas sequencialmente, histórico completo preservado, 0 erros do zero.
- Schema consistency: 31 tabelas, 0 divergências, 0 órfãs.
- Testes: 113/113, 0 falhas, 0 skips, 5x consecutivas sem flakiness.
- Typecheck: verde. Lint: verde. Build: verde.
- RLS: ativado em todas as tabelas com dado sensível/paciente-específico.
- Audit: runAuditedCommand — mutação + AuditLog na mesma transação, sanitização central obrigatória de metadata.
- Encryption: AES-256-GCM com versionamento de chave (rotação preparada e testada); HMAC-SHA256 para lookup.
- Idempotency: constraint UNIQUE + ON CONFLICT, testado com 20 chamadas concorrentes reais.
- Outbox: claim atômico (FOR UPDATE SKIP LOCKED), backoff exponencial, recuperação de eventos travados.
- Staging preparation: /api/health, .env.staging.example, seed 100% fictício, AUTH_MODE forçando Supabase fora de development.

## Produto

Jornada do paciente: cadastro → consentimento → adesão → anamnese → consulta → elegibilidade → assinatura → dashboard → tratamento ativo → check-in → histórico/evolução → prescrição/documento → acompanhamento longitudinal.

Jornada do médico: MFA → carteira → fila (prioridade orientada a dados reais) → prontuário/timeline → check-ins → intercorrências → revisão → DoctorDecision (append-only) → prescrição → próxima revisão recalculada.

Continuity Engine: periodicidade configurável (override do médico prevalece sobre default da categoria), eventos de domínio, check-ins com state machine, ausência de resposta tratada como pendência operacional.

Camilla: Orchestrator reagindo a eventos do Engine, Conversation persistente, Safety Determinístico (vazio por design) sempre antes do Intent Classifier, Minimum Necessary Context, escalonamento reaproveitando a fila médica existente, observabilidade completa, frequency cap + opt-out, identidade WhatsApp real, Outbox.

Admin: Visão Geral, Corpo Clínico, Configuração, Camilla (métricas + Engagement Coverage), Auditoria.

Domínio financeiro: Adesão sempre antes da avaliação; mensalidade só após EligibilityDecision.APPROVED; snapshot financeiro imutável a mudança posterior de preço.

Domínio de prescrição: DoctorDecision.ISSUE_PRESCRIPTION → Prescription DRAFT → PENDING_SIGNATURE → SIGNED → DELIVERED.

Domínio de telemedicina: OWN_DOCTOR (não-bloqueante) ou EXTERNAL_PROVIDER (staging) via Port, sempre gerando ClinicalEvent.

## Ativação Externa (mantida separada — não concluída)

Ver docs/PILOT-READINESS.md e docs/PROVIDERS.md. 6 dependências de ativação, todas de credencial/contrato/decisão humana, nenhuma de engenharia.
