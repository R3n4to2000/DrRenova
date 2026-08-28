# Renovamed — Matriz de Fornecedores (Provider Matrix)

Nenhum fornecedor é escolhido neste documento — só o status atual de cada Port.

| Capability | Port | Adapter atual | Produção |
|---|---|---|---|
| Auth | HTTP Security Context | Verificação real de JWT Supabase (offline) + dev-token (só development) | Credencial/projeto Supabase real |
| WhatsApp | WhatsAppGatewayPort | fakeWhatsAppGateway (staging) — identidade resolvida de verdade (hash), envio simulado | Provider real (ex.: Meta Cloud API, Twilio) |
| Payment | PaymentGatewayPort | fakePaymentGateway (staging) — sempre aprova | Provider real (ex.: Stripe, Pagar.me) |
| Telemedicine | TelemedicineProviderPort | fakeTelemedicineProvider (staging); OWN_DOCTOR é caminho real não-bloqueante | Provider externo, se não usar médico próprio |
| Prescription | PrescriptionProviderPort | fakePrescriptionProvider (staging) | Provider juridicamente válido (ICP-Brasil ou equivalente) |
| AI (Camilla) | IntentClassifierPort / AnswerStructurerPort | Heurística por palavra-chave (staging) — nunca um LLM real | Provider de LLM real + credencial |
| Secrets | encryption abstraction | Chaves versionadas via variável de ambiente | Managed KMS (AWS KMS/GCP KMS/Vault) |

Todo adapter de staging tem o prefixo fake/staging no próprio nome no código. A troca por um provider real não exige mudança na camada de domínio, só uma nova implementação do Port correspondente.
