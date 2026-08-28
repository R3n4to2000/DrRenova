# Renovamed — Checklist de Aprovação da Direção Médica

Este documento lista exatamente o que precisa de aprovação médica/jurídica antes do piloto externo. Nada aqui foi decidido tecnicamente — são todos pontos de decisão humana, fora do escopo de engenharia.

## 1. Deterministic Safety Rules (Camilla)
`deterministic_safety_rules` está vazia por design. Antes do piloto externo, a Direção Médica precisa definir e aprovar, por escrito, pelo menos:
- Quais campos de check-in (ex.: `valor_generico` de pressão, peso, etc.) justificam uma regra de segurança determinística.
- Os limiares numéricos exatos (operador + valor) para cada regra.
- A ação resultante quando a regra dispara (hoje só `ESCALATE` é suportado).
- Quem tem autoridade para publicar/aprovar uma nova versão de regra (`approved_by`).

**Sem isso, a Camilla escala qualquer relato numérico fora do fluxo trivial de STRUCTURED_FOLLOWUP para o médico** — comportamento seguro por padrão, mas não é o comportamento final desejado do produto.

## 2. Intent Classifier / Escalonamento
- Validar se a lista de intenções (`ADMINISTRATIVE`, `STRUCTURED_FOLLOWUP`, `CLINICAL_QUESTION`, `POSSIBLE_INTERCURRENCE`, `POTENTIAL_URGENCY`, `HUMAN_SUPPORT_REQUIRED`) é suficiente e clinicamente adequada.
- Aprovar os textos exatos de resposta da Camilla em cada cenário de escalonamento (hoje são textos fixos no código — ver `camilla-orchestrator.service.ts`).
- Confirmar que nenhuma mensagem da Camilla, mesmo em staging, seria interpretada por um paciente real como orientação clínica.

## 3. Mensagens Clínicas Permitidas/Proibidas
Confirmar a lista de frases proibidas (já aplicada como princípio de projeto, não como filtro técnico automatizado):
- "Seu quadro está melhor" / "Essa pressão está boa" / "O medicamento está funcionando" / "Você pode continuar nessa dose" — e variações equivalentes.
- Aprovar os textos permitidos usados hoje (ex.: "Seu médico já concluiu sua revisão").

## 4. Regra dos 180 Dias (Resolução CFM 2.314/2022)
- `CategoryConfig.inPersonEvaluationRuleEnabled`/`inPersonEvaluationMaxDays` existem como infraestrutura configurável — **nenhuma interpretação jurídica foi feita**.
- Decisão pendente: o valor é 180 dias corridos? Conta a partir de qual evento (última consulta presencial, última decisão médica, ativação do tratamento)?
- Decisão pendente: quando a regra "dispara", o sistema hoje só pode gerar uma pendência/alerta — a Direção Médica precisa confirmar que esse é o comportamento correto (nunca uma ação automática de suspensão/cancelamento).

## 5. Fornecedor de Prescrição
- `PrescriptionProviderPort` está pronto tecnicamente, mas nenhum fornecedor juridicamente válido foi contratado.
- Confirmar qual fornecedor de assinatura digital (ICP-Brasil ou equivalente) será usado antes de qualquer prescrição real ser emitida.

## 6. Consulta Inicial
- Confirmar se "médico próprio" (`OWN_DOCTOR`) é suficiente para o piloto interno, ou se um fornecedor de telemedicina externo é obrigatório desde já.

## 7. Elegibilidade
- Confirmar que os critérios de elegibilidade permanecem **exclusivamente** a critério médico — nenhuma automação deste sistema jamais decide `APPROVED`/`NOT_ELIGIBLE` (já garantido tecnicamente; item aqui é confirmação formal, não mudança técnica).
