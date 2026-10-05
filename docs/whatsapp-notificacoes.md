# Notificações por WhatsApp

Tela: **Admin → WhatsApp** (`/admin/whatsapp`). Envio via Evolution API (a mesma VPS do projeto EssencialCentro), sem SDK: `POST {url}/message/sendText/{instância}` com o header `apikey`.

## Configuração

1. O servidor e a instância vêm das mesmas variáveis do projeto EssencialCentro:

   ```env
   EVOLUTION_API_URL=https://evolution-whatsapp.duckdns.org
   EVOLUTION_API_KEY=...
   EVOLUTION_INSTANCE=...
   ```

   Configure-as no `.env.local`, na Vercel **e** no container do worker na VPS. A URL e a key nunca saem do backend.
2. Na aba **Conexão**, o cartão **WhatsApp da empresa** mostra o estado da instância `EVOLUTION_INSTANCE`, lido ao vivo da Evolution (nada fica no banco):
   - **Conectado**: número e nome do perfil, com **Verificar conexão** e **Trocar número** (desconecta o número atual, com confirmação; a instância continua e fica pronta para um novo QR Code).
   - **Aguardando leitura / Desconectado**: **Gerar QR Code**. O código é renovado a cada 30 s e a tela verifica a cada 4 s se foi lido; quando a Evolution devolve um código de pareamento, ele aparece junto.
   - **Não conectado** (instância inexistente no servidor): **Conectar WhatsApp** cria a instância com o nome de `EVOLUTION_INSTANCE` e mostra o primeiro QR Code. Uma instância que já existe nunca é recriada.
   - Criar e desconectar ficam registrados no log do servidor (`[whatsapp] Instance ...`).
3. Ainda na aba Conexão, o **Link do sistema** alimenta a variável `{link}` das mensagens (ex.: folha fechada).
4. Cadastre o WhatsApp de cada técnico em **Técnicos → Editar**. Técnicos sem número aparecem listados na aba Conexão.
5. **Área de teste**: o switch **Modo teste** ligado faz todas as notificações irem para o **Número de teste**, e nenhum técnico recebe. Esses envios não contam como entregues, então ao desligar o modo cada técnico ainda recebe a mensagem dele. O número digitado continua lá com o modo desligado e serve para a **Mensagem de teste**, que só pode ser enviada com o WhatsApp conectado.
6. Ligue a **automação** pela chave no cabeçalho da página. Ao ligar, um diálogo pergunta quais notificações ativar (**Ativar todas** ou **Ativar selecionadas**), para a automação nunca ficar ligada com todas as notificações desligadas. Horários e textos ficam na aba **Notificações**.

> **Trocar número desconecta o WhatsApp em uso.** Para testar a tela, aponte `EVOLUTION_INSTANCE` no `.env.local` para uma instância de teste (ex.: `central-teste`) e conecte um celular de teste. Nunca teste contra a instância de produção.

Recomendação: usar uma instância própria para este sistema, não a do WhatsApp da clínica.

## Notificações

| Notificação | Quando | Quem recebe |
|---|---|---|
| Folha fechada | Ao salvar a folha como fechada (`POST /api/payroll`) | O técnico da folha, uma vez por competência |
| Escala do mês | Dia e hora configurados | Técnicos com escala no mês |
| Horário do dia seguinte | Diariamente, na hora configurada | Quem tem escala `scheduled` com horário amanhã |
| Fim do expediente | Logo após o job de horas da Porto (23h); a hora configurada é a segunda chance | Quem tem horas lançadas hoje |
| Folga | Diariamente, na hora configurada | Quem tem folga hoje (só "folga": férias e outras indisponibilidades não) |
| Ausência justificada | Ao salvar um dia como "Justificou" (`POST /api/work-hours`) | O técnico, uma vez por dia justificado |

Os horários são sempre de Brasília. Os envios agendados rodam no **worker da VPS** (`worker/index.ts`), que verifica a cada 5 minutos o que está no horário. Cada notificação agendada roda uma vez por dia (ou por mês). Se o worker estiver fora do ar, ela ainda sai até 3h depois do horário; passado isso, fica para o próximo ciclo.

Nenhuma mensagem é enviada duas vezes com sucesso: cada uma tem uma chave única (ex.: `day_off:{técnico}:{data}`). Mensagens desviadas para o número de teste não usam essa chave, porque não chegaram ao técnico. Falhas e envios pulados (sem telefone, sem configuração) liberam a chave, então **Rodar agora** ou **Reenviar** tentam de novo.

## Histórico

A aba **Histórico** lista todos os envios com filtro por período (diário, mensal, anual, personalizado ou tudo), técnicos, notificação e status. Exporta para Excel ou CSV com os mesmos filtros (até 20.000 linhas por arquivo). Permite reenviar qualquer mensagem.

## Deploy

- **Vercel**: nada novo além do código. As tabelas `whatsapp_config` e `whatsapp_messages` e a coluna `technicians.phone` são criadas sozinhas no primeiro uso.
- **VPS**: é preciso **rebuildar e reiniciar o container do worker** para as notificações agendadas começarem a sair. Sem isso, só funcionam os eventos (folha e justificativa), os testes e o "Rodar agora".
