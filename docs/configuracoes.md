# Configurações (`/admin/configuracoes`)

Regras de negócio editáveis pelo admin. Antes ficavam fixas no código; agora todos os pontos abaixo
leem as configurações. Os valores padrão são exatamente os que estavam no código, então nada mudou
no dia em que a tela entrou no ar.

## Onde fica

- `lib/organization-settings.ts`: tipos, padrões (`DEFAULT_ORGANIZATION_SETTINGS`), validação
  (`parseOrganizationSettingsInput`), leitura tolerante (`normalizeOrganizationSettings`) e helpers
  (`calculateServiceAward`, `valueOrDefault`, `netOfDailyBreak`, `fortnightForDay`,
  `buildPortoWarningNote`). Sem dependências, é usado pela tela, pela API e pelo worker.
- `lib/organization-settings-store.ts`: tabela `organization_settings` (uma linha, `id = 1`, campos num
  JSONB `data`). É criada em tempo de execução, como o resto do projeto. Tem um cache de 30s por
  processo, e salvar limpa o cache do próprio processo.
- `app/api/organization-settings/route.ts`:
  - `GET` do admin: tudo, mais `updatedAt`/`updatedBy`.
  - `GET` do técnico (ou do admin em modo preview): só `monthlyHours`, `dailyBreakMinutes`,
    `serviceAwardTiers`, `monthlyHoursWarningFloor` e `fortnightSplitDay`.
  - `PUT`: só admin fora do preview. Responde 400 com a mensagem de validação. O antes/depois vai
    para o log do servidor.
- `hooks/use-organization-settings.ts`: busca uma vez por carregamento de página e começa com os
  padrões. `resetOrganizationSettingsCache()` é chamado ao salvar e no logout.

## Campos e quem usa

| Campo | Padrão | Onde é usado |
|---|---|---|
| Comissão, salário base, VA, VR | 25%, R$ 2.664,53, R$ 249, R$ 783 | Folha (servidor e tela), Faturamento, cadastro de técnico (valor inicial e campo vazio). Vale o do técnico quando > 0 (`valueOrDefault`). |
| Jornada mensal | 220 h | Hora extra da folha, banco de horas, painel do técnico, `{meta_mes}` do WhatsApp. |
| Adicional de hora extra | 50% (×1,5) | Folha: `max(0, horas − jornada) × (salário ÷ jornada) × multiplicador`. |
| Intervalo diário | 60 min | Horas da escala/apontamento, robô do Porto, dashboard gerencial, modal de almoço da planilha. |
| Turno padrão | 08:00–18:00 | Escalas novas e apontamento (antes era 08:00–17:00 só nessa tela), previsto do robô quando o Porto não informa o turno. |
| Alerta de horas | 200 h | Cor do card de horas do técnico (vermelho abaixo, amarelo até a jornada). |
| Último dia da Q1 | 15 | Painel do técnico, para serviço sem quinzena informada. |
| Serviço cancelado cobra o previsto | não | Saldo no apontamento e no dashboard gerencial. |
| Faixas de prêmio | 80 OS → R$ 250; 160 OS → R$ 600 | Prêmio da folha (maior faixa atingida) e metas/medidores do painel do técnico. Sem faixas, não há prêmio nem metas. |
| Horários do robô | horas 23:00, escala 03:00 | Worker: verificação a cada minuto, com tolerância de 60 min para horário perdido; ao reiniciar, não repete uma execução que já aconteceu hoje (consulta `porto_sync_log`). |
| Dias reprocessados | 1 (ontem e hoje) | Job de horas. Dia com advertência ou manual nunca é recalculado. |
| Máximo de horas por dia | 16 h | Job de horas (`invalid_hours`). |
| Escala do mês seguinte | 7 dias | Job de escala (0 = nunca). |
| Folga integral a partir de | 90% | Job de escala (indisponibilidade que cobre o turno). |
| Usar conclusão do laudo | sim | Fim do dia sem assinatura: conclusão do laudo antes do Concluído. |
| Advertência + texto | ligada | Nota `ADVERTÊNCIA: <texto>`. O marcador `ADVERTÊNCIA:` é fixo, porque é por ele que o robô reconhece um dia advertido. `{servico}` = número do serviço. |
| Registrar serviço cancelado | sim | Job de horas (situação "Serviço cancelado"). |
| WhatsApp para alertas do robô | vazio | Worker: aviso quando uma execução automática falha, termina com avisos de saúde ou fica travada (>2h). Vazio = sem alertas. |
| Aviso de vencimento | 7 dias | Controle de despesas ("A vencer"). |
| Categorias de despesa | lista anterior | Sugestões do campo Categoria no controle de despesas. |
| Assistente de IA ligado | sim | `/admin/assistente` e o chat flutuante. Desligado, o assistente não responde. |
| Limite de gasto por mês | R$ 50 | Assistente: ao atingir, para de responder até o mês seguinte (0 = sem limite). |
| Preço da entrada / saída | R$ 1,55 / R$ 2,30 por milhão de tokens | Custo de cada resposta (aba Consumo e limite mensal). Preço do `deepseek-chat` (US$ 0,28 / 0,42) a ~R$ 5,50 — conferir em platform.deepseek.com. |

Folhas já salvas guardam os valores calculados e não são recalculadas quando as configurações mudam.
