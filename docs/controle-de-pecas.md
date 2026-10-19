# Controle de Peças

Módulo de vendas de peças em **consignação** com os técnicos. Fica **fora da folha**: não é comissão, é venda de peças ao técnico. Portado do NextRotta (`sistema-operacional`) para uma empresa só (sem `organization_id`, planos ou subdomínios).

## Modelo

- Cada peça tem **custo** (o que a empresa pagou), **preço de técnico** (o que o técnico deve por unidade vendida) e **preço sugerido** (ao cliente final). Exemplo: custo R$ 50, técnico R$ 75, sugerido R$ 100. Os preços de cada venda são copiados para os itens da venda: editar a peça depois não altera vendas passadas.
- **Estoque central** + **um estoque por técnico** (o "carro"). Estoque nunca é um número gravado: é a soma de `part_movements` (só inserção), então cada unidade tem rastro. `technician_id` nulo = estoque central.
- **Remessa** (`part_transfers`, `direction = out`): central → técnico, em consignação. **Devolução** (`return`): técnico → central. O técnico confirma cada uma no app (`acknowledged_at` + IP) e o admin imprime o termo.
- **Venda** (`part_sales`): o técnico vende do próprio estoque, pelo preço que quiser. A peça sai na hora e a **conta do técnico** (`part_account_entries`) recebe o preço de técnico. Cancelar devolve as duas coisas. O técnico só cancela venda não paga; venda paga, só o admin cancela (o estorno ao cliente é feito no Mercado Pago).
- **Inventário** (`part_inventories`): contagem por código de barras (cada leitura soma 1) ou digitada. Ao encerrar, o estoque passa a ser o que foi contado. A falta no carro de um técnico pode ser **cobrada** (vira `part_debts` parcelado na conta) ou **assumida pela empresa** (ex.: roubo com boletim de ocorrência).
- **Acerto**: o saldo do mês é tudo o que venceu até o mês menos o que foi pago. O admin registra o pagamento (Pix, dinheiro, transferência, desconto acordado). O desconto na folha é **manual**: o saldo de peças não entra no cálculo da folha.
- O técnico **nunca vê o custo** da empresa (as rotas tiram `totalCost`/`unitCost` das respostas dele).
- Nada é excluído: exclusão lógica nas peças; movimentos e lançamentos são imutáveis (correção = novo lançamento).

## Integridade (o que o código garante)

- Criar uma venda é **uma única transação**: venda + itens + movimentos de saída + lançamento na conta.
- Antes de tirar unidades, a transação **trava o estoque** (`pg_advisory_xact_lock`) e **reconfere** com a função `parts_require_units` (criada em `lib/parts-schema.ts`, erro `P0409` → 409). Dois toques em "Cobrar", ou dois aparelhos, nunca vendem a mesma unidade duas vezes. Vale também para remessas e ajustes negativos.
- Cancelar uma venda é uma transação só (status + estoque + conta). Índices únicos em `part_movements (sale_id, part_id)` e `part_account_entries (sale_id)` fazem um segundo cancelamento simultâneo falhar e desfazer tudo.
- Número sequencial de venda/remessa/inventário/débito: `MAX(number)+1` com índice único e `withNumberRetry`.
- `mp_payment_id` tem índice único parcial: um pagamento do Mercado Pago quita no máximo uma venda.

## Pagamento — Mercado Pago na conta do técnico

O sistema tem **um** aplicativo no Mercado Pago. Cada técnico conecta a **própria** conta em "Minhas peças" (OAuth com PKCE; retorno em `/api/mercadopago/oauth/callback`, com `state` de uso único em `mercadopago_oauth_states`, válido por 15 min). Os tokens ficam cifrados (AES-256-GCM, `MERCADOPAGO_TOKEN_KEY`) em `mercadopago_accounts` e são renovados 7 dias antes de vencer (duram 180 dias). O dinheiro da venda é sempre do técnico.

| Forma | Como funciona | Confirmação |
|---|---|---|
| Pix (QR Code) | `POST /v1/orders` (`type: online`, expira em 60 min). A tela mostra o QR e o copia e cola. | webhook `order` + a tela consulta a cada 4 s |
| Link de cartão | Checkout Pro (`/checkout/preferences`, sem boleto, expira em 24 h, `external_reference` = id da venda). | webhook `payment` + consulta |
| Cartão na maquininha ou no celular | Com maquininha Point escolhida pelo técnico (modo PDV): `POST /v1/orders` (`type: point`). Sem maquininha: o técnico cobra pelo app do Mercado Pago (Point Tap) e toca em **Conferir pagamento**, que procura na conta dele um pagamento aprovado de mesmo valor, feito depois da venda (janela de 6 h) e ainda não ligado a outra venda. | webhook/consulta, ou "Conferir pagamento" |
| Dinheiro / registro manual | Sem cobrança pelo Mercado Pago. | o técnico marca "Recebi" |

- **A conta do Mercado Pago conectada é obrigatória para qualquer venda**, inclusive a registrada como dinheiro: `createSale` recusa (409) o técnico sem conta conectada e a tela bloqueia "Cobrar". Para formas do Mercado Pago o total mínimo é R$ 1,00.
- Falha ao cobrar **não desfaz a venda**: grava `payment_error` e a tela oferece "tentar de novo" ou trocar o método. Cada nova cobrança incrementa `payment_attempts`, que entra na chave de idempotência (`pix-<venda>-<tentativa>`), então tentar de novo depois de um Pix expirado cria um pedido novo.
- "Recebi de outra forma" grava `payment_confirmed_by = technician` (destacado para o admin); confirmação pela API grava `mercadopago`.
- **Webhook** `POST /api/webhooks/mercadopago` (público no `middleware.ts`). Nada do corpo é confiável: ele só diz qual venda conferir, e a conferência pergunta ao Mercado Pago com o token do técnico. Se `MERCADOPAGO_WEBHOOK_SECRET` estiver definido e vier `x-signature`, assinatura errada é recusada. Todo evento fica em `mercadopago_webhook_events` (com erro/processado) e uma falha responde 500 para o Mercado Pago reenviar. É idempotente.
- Em desenvolvimento (`localhost`) o Mercado Pago não alcança o webhook; a confirmação vem das consultas da tela.

## Configurar o Mercado Pago (uma vez, pelo dono)

1. Em Mercado Pago Developers → Suas integrações, criar o aplicativo (pagamentos online e presenciais, modelo de integração marketplace/OAuth).
2. **URL de redirecionamento:** `https://<domínio do sistema>/api/mercadopago/oauth/callback` (ou o valor de `MERCADOPAGO_REDIRECT_URI`). Precisa ser idêntica, caractere por caractere.
3. **Webhooks:** URL `https://<domínio do sistema>/api/webhooks/mercadopago`, eventos **Order** e **Pagamentos**. Copiar a assinatura secreta para `MERCADOPAGO_WEBHOOK_SECRET`.
4. Variáveis no ambiente (Vercel):

| Variável | Para quê |
|---|---|
| `MERCADOPAGO_CLIENT_ID` | ID do aplicativo |
| `MERCADOPAGO_CLIENT_SECRET` | Client secret do aplicativo |
| `MERCADOPAGO_TOKEN_KEY` | Chave de cifra dos tokens: `openssl rand -base64 32`. **Não troque depois de conectado**: os tokens gravados deixam de abrir. |
| `MERCADOPAGO_WEBHOOK_SECRET` | Assinatura secreta do webhook |
| `APP_URL` | Endereço público do sistema (sem `/` no fim). Base do redirect e do webhook. |
| `MERCADOPAGO_REDIRECT_URI`, `MERCADOPAGO_WEBHOOK_URL` | Opcionais: sobrescrevem os endereços montados a partir de `APP_URL` |
| `MERCADOPAGO_FALLBACK_PAYER_EMAIL` | Opcional: e-mail do pagador no Pix quando a venda não tem (padrão: `pagador@<domínio>`). Não pode ser o e-mail do técnico. |

5. Em Controle de Peças → Configurações: nome da empresa (aparece para o cliente), formas de pagamento, rodapé do recibo e dia do acerto.

Cada técnico precisa de conta no Mercado Pago com Pix habilitado (chave cadastrada) e, para maquininha, um Point vinculado.

## Mensagens ao cliente

Link de pagamento (Pix: link + copia e cola numa mensagem só dele) e **recibo**, depois de pago, saem pelo WhatsApp da empresa (Evolution API, `lib/parts/notify.ts`), com histórico (tipo `parts_sale`, aparece no histórico de `/admin/whatsapp`) e deduplicação. Respeita o número de teste das Configurações do WhatsApp. **Não depende** do interruptor geral de notificações: o link de pagamento precisa chegar ao cliente. Sem a instância conectada, a tela oferece **Enviar pelo meu WhatsApp** (link `wa.me` com o texto pronto).

## Leitura de código de barras

`components/parts/shared.tsx` → `BarcodeScanner`: câmera pelo `BarcodeDetector` nativo do navegador e, onde ele não existe (Chrome no Windows, Safari/iPhone, Firefox), pelo pacote `barcode-detector` (ZXing em WebAssembly, carregado só quando preciso; o `.wasm` vem do jsDelivr). A câmera exige HTTPS ou `localhost`. Leitores USB/Bluetooth funcionam como teclado, e sempre dá para digitar.

## Código

- Schema: `lib/parts-schema.ts` (`ensurePartsSchema()`, criado em runtime numa única transação; chamado por `partsContext`, pelo webhook e pelo callback do OAuth).
- Regras: `lib/parts/` — `types.ts` (rótulos, sem dependências), `common.ts` (erros, travas de estoque), `catalog.ts` (peças, imagens, importação, configurações), `stock.ts` (estoque, remessas, inventário), `sales.ts` (vendas, cobrança, recibo, webhook), `account.ts` (conta do técnico, débitos), `overview.ts`, `detail.ts`, `notify.ts`, `audit.ts` (tabela `parts_audit_log`), `route-helpers.ts`.
- Mercado Pago: `lib/mercadopago/` — `config.ts` (env, cifra dos tokens), `client.ts` (REST, OAuth, assinatura do webhook), `accounts.ts` (contas dos técnicos, maquininhas).
- API: `app/api/parts/**`, `app/api/mercadopago/**`, `app/api/webhooks/mercadopago`. Tela do técnico: uma chamada (`/api/parts/me`) traz tudo.
- Telas: `/admin/pecas` (`components/parts/admin/*`) e `/dashboard/pecas` (`components/parts/technician-parts.tsx` + `payment-panel.tsx`). No modo preview (admin vendo como técnico) tudo é somente leitura, pelo middleware.
- Imagens: Vercel Blob **público** (o store do projeto é público, como o da Biblioteca), com nome aleatório em `parts/`, servidas por `/api/parts/[id]/image`, que exige login. A tela reduz a foto para 800 px em JPEG antes de enviar.

## Pendências conhecidas

- O Mercado Pago real **nunca foi testado** (nem aqui nem no NextRotta). Validar Pix, link, Point, "Conferir pagamento" e webhook em sandbox/produção antes de liberar para todos os técnicos.
- Os técnicos veem "Minhas peças" no menu sempre; a página não é ocultável pelas regras de visibilidade do técnico.
