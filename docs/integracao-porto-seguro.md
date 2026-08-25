# Integração com Portal do Prestador (Porto Seguro)

Status: **implementado (v1)**. Plano completo em `C:\Users\iluuc\.claude\plans\swirling-shimmying-plum.md`.
Automação nasce **desligada** — precisa ser configurada e ligada manualmente em Config. Porto.

**Antes de ligar a automação em produção, leia a seção "O que ainda é heurística" no final deste documento.** Login, navegação, lista de socorristas, escala e busca/detalhe de serviço já foram validados ao vivo contra o Porto (duas rodadas de teste). Só restam duas heurísticas de cálculo (vínculo serviço→técnico por nome, e horário de início aproximado pela escala) que ainda não têm forma validada de confirmar 100%.

## Objetivo

Aproveitar a escala e as horas trabalhadas que já existem no Portal do Prestador da
Porto Seguro (onde o time de socorristas já é gerenciado) para alimentar
automaticamente a Montagem da Escala e o Apontamento de Horas deste sistema, evitando
digitação duplicada.

Ideia original do produto:
- Aba **Config. Porto** na sidebar, visível só para admin.
- Admin cadastra login/senha do Porto (fica salvo no banco).
- Toggle para ligar/desligar a automação.
- **Apontamento de horas**: roda 1x por dia, no fim do dia.
- **Escala**: gerada 1x por mês, mas com checagem diária se a escala do período já existe.

## O que foi validado (testes reais, ambiente de teste isolado)

Todos os testes abaixo foram feitos com login real (credenciais do próprio usuário,
autorizado por ele) contra `prestador.portoseguro.com.br` /
`wwws.portoseguro.com.br`. Nenhum dado de teste (HARs com CPF/senha, cookies)
permanece no repositório — foi tudo apagado após a análise.

### 1. CORS não é um problema

A integração roda no backend (Node/cron), não no navegador do usuário. CORS só existe
como restrição de browser, então nunca vai bloquear uma chamada servidor-a-servidor.
O risco real era outro (ver abaixo).

### 2. Login funciona via HTTP puro, em 3 passos

O endpoint que aparece mais óbvio no DevTools (`/pdp-service/api/public/login/users/qras/`)
**não** autentica sozinho — ele só valida CPF/senha e devolve os códigos QRA
associados à conta. O login de verdade precisa de 3 chamadas em sequência, na mesma
sessão (cookie jar):

1. `GET https://prestador.portoseguro.com.br/portal/site/pdp/template.LOGIN/`
   → extrair o nonce anti-CSRF do HTML: campo hidden `vgn_realm1_nonce`.
2. `POST https://prestador.portoseguro.com.br/pdp-service/api/public/login/users/qras/`
   Body: `cpf=<cpf>&password=<senha>`
   → resposta: `{"status":"success","data":{"qras":[{"codQRA":"..."}]}}`
3. `POST https://prestador.portoseguro.com.br/portal/site/pdp/template.LOGIN/action.process/`
   Body: `vgn_realm1_nonce=<nonce do passo 1>&logon=<cpf>&password=<senha>&qra=<codQRA do passo 2>&remember=manterConectado`
   → `302` para `/pdp/Homepage` e seta os cookies de sessão reais:
   `SECURITY_TOKEN`, `CPFPrestador`, `IDPrestador` (domínio `.portoseguro.com.br`),
   `REMEMBERTOKEN` (domínio `prestador.portoseguro.com.br`).

Confirmar autenticação chamando (POST, mesma sessão):
`.../template.SINGLEPORTLET/menuitem.3f12931f95bf6da799d174c40812f1ca/resource.process/?...rid=getNotificacoesCount`
com body `origemId=655` → deve responder `{"count":"0"}` (ou outro número). Se voltar
o HTML da tela de login, a sessão não autenticou.

Esse fluxo funcionou de forma 100% confiável via HTTP puro (axios/fetch), sem
executar nenhum JS do site.

### 3. A parte que NÃO funciona via HTTP puro: acessar `wwws.portoseguro.com.br`

Escala e horas ficam num app **completamente separado**
(`wwws.portoseguro.com.br`, legado, JSF 1.2 / IBM WebSphere / RichFaces), com seu
próprio cluster de sessão. Mesmo autenticado de verdade no `prestador` (cookies
`SECURITY_TOKEN` etc. válidos e presentes), uma chamada HTTP pura direta para
esse domínio retorna **500 Internal Server Error**.

A página de erro (bug de exposição de informação do lado da Porto) vazou o stack
trace Java, que mostra a causa exata:

```
com.porto.seguranca.business.PortoSessionManager.authenticate
Sessão (<valor do cookie SECURITY_TOKEN>) inexistente!
```

Ou seja: o `wwws` valida sessão lendo o cookie `SECURITY_TOKEN` (que chega
corretamente, pois o domínio do cookie é `.portoseguro.com.br`) contra um cache de
sessão próprio — e esse cache nunca reconhece um token emitido por uma requisição
HTTP pura, mesmo sendo um login real e válido.

**Não é bloqueio do Imperva** (WAF/anti-bot que protege o site) nem CORS — a
requisição chega no backend normalmente (prova disso é o próprio erro 500 vindo do
Java). É a ponte de sessão entre os dois apps que exige algo que só um motor de
navegador real fornece (provavelmente fingerprint TLS/HTTP idêntico ao Chrome de
verdade — não foi isolado exatamente qual sinal falta, e não compensa continuar
investigando isso).

### 4. Solução validada: navegador headless (Playwright)

Repeti o mesmo fluxo de login com Playwright controlando um Chromium real
(headless) em vez de `fetch`/`axios`. Resultado:

- Login pela UI (preencher CPF/senha, clicar "entrar") funcionou normalmente.
- Navegar direto para `https://wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConSocor.xhtml?portal=2`
  **funcionou sem erro**, carregando a lista real de socorristas (nome, CPF, QRA,
  celular, status).

Ou seja: **a integração é viável, mas precisa rodar via navegador headless
(Playwright), não via chamadas HTTP puras.** O login em si até funcionaria com
HTTP puro, mas como a parte que interessa (escala/horas) está no `wwws`, mais
simples manter o fluxo inteiro em Playwright.

## Endpoints mapeados (via engenharia reversa do portal, para uso dentro do Playwright)

Todos abaixo pressupõem sessão autenticada (cookies válidos) e devem ser navegados
com uma página real do Playwright (`page.goto(...)`), não com `fetch` cru.

| Tela | URL | Método | Observação |
|---|---|---|---|
| Lista de socorristas | `wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConSocor.xhtml?portal=2` | GET | Retorna até 12 socorristas com `numeroQRA` embutido no HTML. Paginação além disso não foi confirmada (ver Lacunas). |
| Detalhe do socorrista + escala do mês atual | `.../click/ConDetSocor.xhtml?numeroQRA=<QRA>&flagMegaRecurso=false` | GET | HTML já traz a escala do **mês corrente** embutida (ex: `08:00 - 18:00`) e ícones de indisponibilidade (`/visual/img/indisponibilidade.png`) nos dias com exceção (férias, doença, folga, etc). |
| Busca de serviços por período | `.../click/ConServCons.xhtml` | POST | Body: `formConsultaServico=formConsultaServico&dadosFiltro=,,,,,,,,,,&tipoData=1&dataInicialInputDate=<dd/MM/yyyy>&dataInicialInputCurrentDate=<MM/yyyy>&numeroServicoAtendimento=&dataFinalInputDate=<dd/MM/yyyy>&dataFinalInputCurrentDate=<MM/yyyy>&anoServicoAtendimento=&pesquisar=Pesquisar&javax.faces.ViewState=<token>`. Resposta traz tabela HTML com nome do técnico (truncado) e data por linha. |
| Detalhe do serviço (horário de conclusão) | `.../click/ConDetServAW.xhtml?anoServico=<AA>&numeroServico=<num>&dadosFiltro=,,,,,,,,,,&origem=1&ret=false` | GET | HTML traz "Situação Atual" e os horários do trajeto (Em Deslocamento, Concluído etc). Testado e confirmado: horário de conclusão bate exatamente com o esperado. |

Formato de nomes truncado nas listagens (ex: "DAVID APOLINARIO FRA") — o match para
o sistema interno deve ser feito preferencialmente por **QRA** (identificador
estável) e não por nome.

## Lacunas conhecidas (não testadas, precisam de nova investigação quando formos implementar)

- **Troca de mês na tela de escala**: o calendário usa RichFaces AJAX
  (`A4J.AJAX.Submit('formDetalheServico', ...)`), ou seja, POST disparado por JS, não
  GET com data na URL. Não foi capturada a chamada real — vamos precisar disso para
  buscar meses diferentes do atual.
- **Paginação da lista de socorristas** além dos primeiros 12 (`LazyScrollTableSocorristas.jsp`,
  mencionado em pesquisa anterior) — não foi confirmada nesta rodada de testes.
- **`obterStatusSocorrista.do`** (consulta de status por QRA) — mencionado em
  pesquisa anterior, não confirmado nesta rodada.

## Riscos / cuidados para quando formos implementar

- **Sistema em produção**: a Montagem de Escala e o Apontamento de Horas já existem
  e já são usados. Qualquer automação de escrita precisa de: backup antes de
  sobrescrever, modo dry-run, e não mexer em dias/meses já concluídos (o sistema já
  tem essa regra para edição manual — reaproveitar).
- **Sessão do Porto expira**: vamos precisar decidir onde/como persistir a sessão
  autenticada (cookies) entre execuções do cron, e reautenticar quando expirar, sem
  gerar login repetido demais (risco de parecer comportamento anômalo pro Imperva).
- **Credenciais do Porto**: ficarão salvas no banco (pedido do usuário) — precisam
  ser criptografadas em repouso, não só em texto plano numa coluna.
- **Custo operacional do Playwright**: precisa manter um binário de Chromium
  disponível no ambiente onde o cron roda (mais pesado que uma function HTTP simples).
- **ToS do portal**: é um portal de terceiro (Porto Seguro); a automação usa
  credenciais legítimas do próprio usuário/prestador, mas vale ter em mente que é
  scraping de um sistema de terceiro sem API oficial documentada.

## Próximo passo

Com a viabilidade técnica confirmada, a próxima etapa é desenhar como isso entra no
sistema: aba "Config. Porto" (admin), modelo de dados para credenciais + toggle,
desenho do job/cron (apontamento diário + checagem/criação mensal de escala), e
estratégia de conciliação com dados já existentes no sistema.

## Implementação (v1)

Plano completo aprovado e implementado — arquivos principais:

- `lib/porto-crypto.ts`, `lib/porto-config-schema.ts`, `app/api/porto-config/*`,
  `app/admin/config-porto/page.tsx` — credenciais (AES-256-GCM), toggle, teste de
  login, histórico de execuções.
- `lib/work-hours-service.ts`, `lib/schedule-write-service.ts` — lógica de escrita seguras extraída
  das rotas existentes (`app/api/work-hours/route.ts`, `app/api/schedule/route.ts`),
  reaproveitada tanto pelo fluxo manual quanto pelos jobs do Porto. **Job de escala**
  (`porto-schedule`) grava `schedule.notes` com o prefixo `Importado do Porto: ...`.
  **Job de horas** (`porto-hours`) é diferente de propósito: o `schedule.notes`
  espelhado continua no formato `Apontamento manual: ...` (para herdar a mesma
  proteção contra sobrescrita que um lançamento manual já tem — ver seção 4 do
  plano), e a proveniência real fica só em `work_hours.source='porto'`. A nota
  ainda inclui `obs=Importado automaticamente do Porto Seguro.` pra não confundir
  quem olhar o calendário.
- `lib/porto-integration/*` — módulo de scraping (login, lista de socorristas,
  escala, busca de serviço/horário de conclusão), usando Playwright real (não HTTP puro).
- `app/api/cron/porto-hours`, `app/api/cron/porto-schedule` — os dois jobs, protegidos
  por `CRON_SECRET`, agendados em `vercel.json` (1x/dia cada).

### Variáveis de ambiente novas (configurar na Vercel antes de usar)

- `PORTO_CREDENTIALS_KEY` — chave AES de 32 bytes em base64. Gerar com `openssl rand -base64 32`.
- `CRON_SECRET` — string aleatória qualquer, usada para autenticar as chamadas de cron.

### Passos manuais de deploy

- Habilitar **Fluid Compute** no projeto Vercel (Settings → Functions) — necessário
  pro `maxDuration` de 280s funcionar no plano Hobby.
- Rodar `npx playwright install chromium` localmente antes de testar `test-login`
  ou os crons em ambiente de desenvolvimento (em produção/Vercel o `@sparticuz/chromium`
  cuida disso sozinho).

## Validação ao vivo (rodada 2) — navegação corrigida

Uma segunda rodada de testes ao vivo (login real, sem gravar nada) achou e corrigiu
três problemas de navegação que teriam quebrado a automação em produção:

1. **Páginas de detalhe rejeitam URL direta.** Navegar direto pra
   `ConDetSocor.xhtml?numeroQRA=...` (sem passar pela lista antes) retorna
   **"Acesso proibido"**. Só funciona clicando no link de dentro da lista já
   carregada — o Porto parece checar que a navegação veio do fluxo normal, não de
   um link direto. Corrigido: `lib/porto-integration/navigation.ts` (novo) abre
   cada página pelo wrapper de portal correto (`/pdp/iframe?menuid=...`) e as
   páginas de detalhe são sempre alcançadas clicando no link real, nunca por
   `page.goto` direto. Isso afeta `socorristas.ts`, `escala.ts` e `servicos.ts`.
2. **Escala: o seletor estava certo, o técnico de teste é que estava errado.**
   Testando com o QRA da própria conta logada (que não é um técnico de campo), as
   células do calendário vinham vazias — parecia confirmar a suspeita de que
   `.organizerDayCell` não bastava. Testando de novo com um técnico de campo real
   (QRA 611072), cada célula tem sim o texto "08:00 - 18:00" e a
   `<img src=".../indisponibilidade.png">` aparece exatamente nos dias com
   exceção (9 de 42 células, agosto/2026) — a implementação original de
   `escala.ts` estava certa, só a navegação (item 1) precisava do ajuste.
3. **Busca de serviço: o campo de data fica escondido até escolher "TIPO DE
   BUSCA".** O campo `dataInicialInputDate` existe mas está dentro de uma
   `<div style="display:none">` até o dropdown `#tipoData` ser setado pra "1"
   (Combinada com Cliente) — sem isso, preencher o campo (mesmo com `force`) é
   ignorado silenciosamente, e o POST direto (sem passar pela UI) retorna 500.
   Corrigido: `servicos.ts` agora seleciona o dropdown antes de preencher as datas.
4. **O mistério do "click/0" do `numeroServico` (aberto desde a pesquisa
   original) está resolvido**: o link do resultado é
   `<a href="0" onclick="changeUrlAW(this, 26, 5167437, '1', false)">5167437/26</a>`
   — `anoServico` e `numeroServico` vêm como argumentos literais da função JS no
   próprio HTML. Confirmado clicando de verdade: abriu `ConDetServAW.xhtml` com
   os timestamps `17/08/2026 06:13, 09:17, 10:25, 10:58` — batendo exatamente com
   a pesquisa original (`5167437/26 → Concluído 10:58`).

Com isso, **login, lista de socorristas, leitura de escala e busca+detalhe de
serviço estão validados ponta a ponta contra produção**, não só inferidos de HAR.

## Heurísticas aceitas (decisão de produto, confirmada em 2026-08-20)

- **Vincular serviço da busca a um técnico** é feito comparando prefixo do nome
  (o Porto não filtra a busca por QRA) — pode errar com nomes muito parecidos.
  **Aceito**: ok pro tamanho do time atual.
- **Horário de início real do técnico**: não existe forma validada de ler isso no
  Porto — o job usa o horário *previsto* da escala do dia como aproximação, e o
  horário do último serviço concluído como fim. **Aceito**: aproximação é
  suficiente.

Essas eram as duas únicas heurísticas em aberto — o resto da integração foi
validado ao vivo nesta sessão e está com alta confiança. Continua recomendado
rodar alguns dias com o modo de teste (`dry_run_only`) ligado antes de desligar,
já que essa parte alimenta dado que afeta folha de pagamento.

## Cobertura do job de horas: mês inteiro, não só "hoje" (2026-08-25)

Ajustado após teste em produção: o job de apontamento de horas varre todo dia
do dia 1 do mês corrente até hoje, em vez de checar só a data de hoje. Isso
evita perder dias (ex: automação ligada no meio do mês, cron falhou um dia,
serviço só aparece "Concluído" no dia seguinte).

- A busca de serviço do Porto aceita **período** (`dataInicialInputDate` /
  `dataFinalInputDate`), não só um dia — usado pra buscar o mês inteiro numa
  chamada só, agrupando os resultados por técnico e data.
- **Limite real do próprio site**: o JS deles limita o período a 15 dias (ajusta
  a data final sozinho se você passar mais que isso) — `lib/porto-integration/servicos.ts`
  quebra o intervalo em blocos de até 15 dias quando o mês já passou desse
  tamanho.
- **Fica barato mesmo cobrindo o mês todo**: antes de buscar o detalhe (caro —
  1 busca+clique por serviço) de cada dia, o job confere no banco se aquele
  `(técnico, data)` já tem uma linha `work_hours.source='porto'` — se já tem,
  pula. Ou seja, a primeira execução depois de ligar a automação faz o trabalho
  pesado do mês todo; os próximos dias, só o dia novo é processado.
- A escala de cada técnico (pro horário previsto de início) é buscada uma vez
  por técnico por execução, não uma vez por dia — reaproveitada pra todos os
  dias novos daquele técnico na mesma rodada.
