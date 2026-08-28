# Renovamed — Regra dos 180 Dias (Resolução CFM 2.314/2022)

## O que existe tecnicamente (implementado, testado)

`CategoryConfig.inPersonEvaluationRuleEnabled` (boolean) e `CategoryConfig.inPersonEvaluationMaxDays` (int) — infraestrutura de configuração administrável por categoria de tratamento, versionada junto com o resto de CategoryConfig. `Treatment.lastInPersonContactAt` guarda a base de cálculo.

## O que NÃO existe (deliberadamente)

Nenhuma lógica calcula vencimento nem gera alerta a partir desses campos. Nenhum valor "180" está hardcoded em nenhum lugar do código — verificado por teste automatizado que varre o código-fonte por esse padrão. Nenhuma ação automática (bloqueio, suspensão, cancelamento) está implementada nem seria implementada sem aprovação.

## Decisão pendente (jurídico-médica, não técnica)

1. O prazo é 180 dias corridos? A partir de qual evento exatamente — última consulta presencial, última decisão médica, ativação do tratamento?
2. Quando o prazo se aproxima/vence, qual é a ação correta? Hoje a única ação tecnicamente possível seria gerar uma pendência/alerta operacional (via Intercorrencia, mesmo padrão já usado para outras pendências) — nunca uma ação automática sobre o tratamento ou a assinatura.
3. Essa regra é a mesma para todas as categorias, ou varia por categoria?

## Por que a infraestrutura já existe sem a regra

Para não bloquear o restante do MVP nem exigir uma migration de banco quando a decisão jurídica for tomada — os campos já existem, versionados, prontos para receber o valor correto assim que aprovado.

Ver docs/DIRECAO-MEDICA-CHECKLIST.md, item 4.
