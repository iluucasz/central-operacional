# Assistente de IA

Trazido do NextRotta (o clone SaaS) em 06/10/2026 e adaptado para a produção: sem créditos nem
planos; no lugar, custo real em R$ e um limite mensal em Configurações.

## O que é

Um chat para o admin perguntar sobre a operação ("qual técnico mais produziu?", "quem tomou
advertência este mês?", "o robô do Porto rodou bem ontem?"). O modelo (DeepSeek, `deepseek-chat`)
**só lê**: escolhe uma das consultas fixas de `lib/ai/tools.ts` e seus parâmetros, nunca escreve
SQL e nunca altera dados.

- Tela: `/admin/assistente` (menu "Assistente IA") e o chat flutuante no canto da tela
  (`components/assistant/widget.tsx`), só para admin e fora do modo preview.
- API: `GET/POST /api/assistant` (status, consumo do mês, conversas / perguntar) e
  `GET/DELETE /api/assistant/[id]` (abrir / arquivar conversa). Só admin (`lib/ai/route.ts`).
- Conversas são por admin (`ai_conversations.user_id`). Arquivar só esconde (`archived_at`).
- Até 6 rodadas de consultas por pergunta; as últimas 12 mensagens da conversa vão como contexto.

## Sugestões

- **Iniciais** (`lib/ai/suggestions.ts`): montadas a partir dos dados, com cache de 5 min. O que pede
  atenção vem primeiro (advertências de laudo no mês, folhas do mês anterior em rascunho, última
  execução do robô com erro/avisos); o resto é sorteado a cada abertura. Sempre de 4 a 6 (o chat
  flutuante mostra 4, a tela mostra 6). Clicar já envia a pergunta.
- **Depois de cada resposta:** o modelo termina com `[[SUGESTOES]] ["...", "...", "..."]`;
  `splitFollowUps` tira isso do texto e guarda em `ai_messages.suggestions`. Elas aparecem como botões
  embaixo da última resposta e também enviam ao clicar. Lista ausente ou malformada = resposta sem
  sugestões (nunca quebra a resposta).

## Consultas (`lib/ai/tools.ts`)

| Consulta | O que traz |
|---|---|
| `resumo_da_empresa` | Configurações (sem o telefone de alerta), técnicos ativos/inativos, competências com OS |
| `listar_tecnicos` | Nome, QRA, situação, comissão/salário/VA/VR próprios |
| `producao_por_tecnico` | OS e valor por técnico e por tipo, numa competência (opcional Q1/Q2) |
| `listar_os` | Até 150 OS de uma competência, opcionalmente de um técnico |
| `folha_da_competencia` | Folha por técnico (rascunho/fechada) |
| `horas_trabalhadas` | Horas, dias, média, diferença para a jornada, dias importados do Porto, situações (folga/falta/justificado/serviço cancelado) e **advertências com as datas** — lidas da observação da escala (`schedule.notes`) |
| `escala` | Turnos de até 62 dias |
| `descontos_e_adiantamentos` | Lançamentos da folha de uma competência |
| `financeiro_do_mes` | Contas a pagar/receber do mês |
| `robo_do_porto` | Automação ligada/modo teste e as 12 últimas execuções (resultado, avisos, suspeita de mudança de tela) |

Resultado acima de 24 mil caracteres é cortado e o modelo é orientado a filtrar.

## Custo e limite

- Cada resposta grava os tokens e o custo em R$ (`ai_messages.cost`), pelos preços por milhão de
  tokens das Configurações. A aba **Consumo** mostra o gasto do mês, o limite e os últimos 6 meses.
- **Limite mensal** (Configurações, padrão R$ 50; 0 = sem limite): ao atingir, o assistente para de
  responder até o mês seguinte. É uma estimativa — a cobrança real é a do painel da DeepSeek.
- Uma pergunta típica consulta 1–3 tabelas e custa frações de centavo a poucos centavos.

## Configuração

- `DEEPSEEK_API_KEY` na Vercel (obrigatória; sem ela a tela diz que falta a chave).
- `DEEPSEEK_MODEL` opcional (padrão `deepseek-chat`).
- Tabelas `ai_conversations` e `ai_messages` criadas em runtime (`ensureAiSchema`, `lib/ai/schema.ts`).
