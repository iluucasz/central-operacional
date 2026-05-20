# Contexto e plano de reestruturacao do sistema

Data do registro: 2026-05-20

## Objetivo deste documento

Este arquivo consolida o contexto repassado pelo cliente e define o plano de modificacao do projeto. Nesta etapa, o objetivo e documentar o caminho de reestruturacao. Nenhuma tela, regra de negocio ou arquitetura foi alterada ainda.

## Resumo executivo

O projeto deve deixar de ser apenas um conjunto de telas de dashboard e passar a ser um sistema interno de gestao operacional e financeira de tecnicos.

Hoje o cliente controla producao, pagamento, horas, banco de horas, escala e documentos usando planilhas separadas. A necessidade real e centralizar essas informacoes em um site com login, banco de dados, importacao de planilhas, calculos automaticos e dashboards separados para administradores e tecnicos.

O sistema precisa atender dois grupos principais:

- Administrador/gestor: importa planilhas, cadastra tecnicos, acompanha producao, calcula pagamentos, gerencia escala, banco de horas e biblioteca de documentos.
- Tecnico/colaborador: acessa com login e senha para visualizar sua propria producao, valores, horas, banco de horas, escala e documentos permitidos.

## Transcricao resumida da necessidade do cliente

A empresa presta servicos para seguradoras e possui tecnicos registrados que trabalham por porcentagem sobre o faturamento. A regra citada no audio e de 25% sobre o que cada tecnico fatura, com possibilidade de excecoes.

O cliente informou que hoje sofre com varias planilhas manuais. A seguradora envia uma planilha com valores brutos, a empresa aplica formulas para transformar esses valores em valores dos colaboradores e deseja apresentar isso no site.

Tambem deseja:

- Login e senha para cada colaborador.
- Dashboard individual para cada tecnico.
- Upload de planilhas no site.
- Agenda/escala para marcar folgas e visualizar quem esta trabalhando.
- Upload da planilha de horas para montar banco de horas.
- Exibicao do banco de horas na aba do tecnico.
- Biblioteca interna com PDFs, coberturas, documentacoes e informacoes da companhia.

## Arquivos de contexto recebidos

Os arquivos analisados estao na pasta `contexto/`.

### `QUINZENAS (1).xlsx`

Funcao aparente: tratar dados brutos das ordens de servico por tecnico, quinzena, mes e total.

Planilhas encontradas:

- `GERAL`
- `LUCAS`

Campos identificados:

- Codigo da ordem de servico.
- Valor total do servico.
- Tipo/especialidade do servico.
- Veiculo.
- Tecnico.
- QRA do tecnico.
- Data do atendimento.
- Competencia.
- Dados operacionais.
- Q1, Q2, M1, M2, Mes 1, Mes 2 e Total.

Leitura de negocio: esta planilha serve para apurar producao por tecnico e por quinzena. Ela tambem parece consolidar totais por competencia e tecnico.

### `MODELO TESTE.xlsx`

Funcao aparente: planilha mae de calculo financeiro.

Planilhas encontradas:

- `SERVICOS MG_VERISSIMO`
- Abas por tecnico, como `MARCELO V`, `LEONILSON`, `ALEX FERREIRA`, `FABIO`, `FELIPE`, `LEONARDO`, `LUCAS`, `DAVID`, `JEFFERSON`, `CICERO`, `ALEX ROBSON`, `LEANDRO`.
- `CONFIG`

Campos e regras observadas:

- A aba `CONFIG` lista QRA, taxa e tecnico.
- Taxas observadas: a maioria em 25%, com excecoes como 26% e 30%.
- A aba base `SERVICOS MG_VERISSIMO` contem codigos de OS, valor, tipo de servico, tecnico, QRA, data, competencia, mes, ano, premio, semana e horas extras.
- As abas de tecnico filtram os servicos por nome do tecnico usando formulas tipo `QUERY`.
- As abas de tecnico exibem colunas como codigo, premio, tipo de servico, tecnico, competencia, salario, adiantamento, VA, VR, desconto, hora extra, premiacao por competencia, comissao, outros e receber.

Leitura de negocio: esta planilha e o coracao atual do calculo de pagamento. O sistema novo precisa transformar essas formulas em regras explicitas, testaveis e armazenadas no banco.

### `HORAS GERAIS PARA GOOGLE.xlsx`

Funcao aparente: controle manual de horas trabalhadas.

Planilhas encontradas:

- `Banco de Dados`
- `Resumo`

Campos identificados:

- Data.
- Funcionario.
- Hora de inicio.
- Hora final.
- Horas trabalhadas.
- Semana do ano.
- Mes.
- Ano.
- Dia da semana.

Leitura de negocio: esta planilha deve alimentar o modulo de banco de horas. O sistema precisa comparar horas planejadas versus horas realizadas e calcular saldo diario, semanal, mensal e acumulado.

### `dashboard-leonilson (1).html`

Funcao aparente: prototipo da aba individual do tecnico. O cliente informou que este arquivo supriu uma das necessidades, mas que o design ficou feio e simples. Portanto, ele deve ser usado como referencia funcional e de contexto, nao como referencia visual final.

Recursos identificados no prototipo:

- Dashboard individual para o tecnico Leonilson.
- Botao de importacao local de CSV/XLSX.
- Filtros por ano e competencia.
- Card de total a receber.
- KPIs de ordens de servico, tipos atendidos, competencias e tipo mais frequente.
- Velocimetros de meta por competencia com Meta 1 de 80 OS e Meta 2 de 160 OS.
- Breakdown salarial com salario base, comissao, hora extra, VA, VR, adiantamento e descontos.
- Graficos de servicos por tipo usando barras e rosca.
- Busca por codigo de OS.
- Tabela de ordens de servico com codigo, tipo e competencia.

Valores fixos encontrados no prototipo:

- Salario: R$ 2.664,53.
- Adiantamento: R$ 1.100,00.
- VA: R$ 249,00.
- VR: R$ 783,00.
- Descontos: R$ 250,00.
- Hora extra: R$ 0,00.
- Comissao: R$ 1.070,75.
- Receber conforme planilha: R$ 2.385,28.

Leitura de negocio: este HTML valida a estrutura desejada para a aba do tecnico. Ele mostra quais informacoes o cliente espera enxergar em uma tela individual e confirma que a experiencia deve permitir leitura rapida de producao, metas, composicao do pagamento e lista de OS. A implementacao final deve transformar esse prototipo em uma tela real do sistema, conectada ao banco e com design profissional, removendo dados fixos, duplicidade de HTML, scripts inline e dependencia de importacao somente no navegador.

## Dor real do cliente

A dor nao e apenas visual. O problema central e operacional:

> A empresa depende de varias planilhas manuais para saber quanto cada tecnico produziu, quanto deve receber, quantas horas trabalhou, qual e o saldo do banco de horas e qual e a escala. O cliente quer centralizar esse fluxo em um sistema com importacao, banco de dados, calculos automaticos e dashboards por perfil.

## Estado atual do projeto

O projeto atual e uma aplicacao Next.js com React, Tailwind, Radix/shadcn, Neon/PostgreSQL, autenticacao por JWT em cookie e dependencias para ler CSV/XLSX (`papaparse` e `xlsx`).

Estrutura funcional existente:

- Login e cadastro.
- Middleware/autenticacao.
- Rotas de admin e tecnico.
- Cadastros basicos de tecnicos.
- Cadastro/listagem basica de servicos.
- Cadastro/listagem basica de horas.
- API basica de escala.
- API de descontos.
- Calculo basico de folha.
- Tipos para tecnicos, servicos, horas, escala, descontos, folha e dashboard.

Problemas observados no estado atual:

- O modulo de importacao ainda e apenas uma tela visual; nao ha pipeline real de upload, validacao, preview, mapeamento e persistencia.
- A agenda/escala de admin ainda esta como placeholder visual.
- O dashboard do tecnico e generico e nao reproduz a riqueza do prototipo citado, como metas por competencia, breakdown salarial, graficos por tipo e tabela detalhada de OS.
- O arquivo `dashboard-leonilson (1).html` prova que parte da necessidade funcional ja foi descoberta, mas ainda esta fora da arquitetura do sistema, com visual simples, dados fixos e logica isolada em HTML/JS.
- A regra de folha atual e simplificada. Ela assume padroes como 176 horas/mes e hora extra 1.5x, mas isso precisa ser validado com o cliente.
- O banco de horas atual soma apenas horas extras positivas; ainda nao contempla saldo negativo, compensacao, faltas, atrasos, escala prevista versus realizado.
- A regra de permissao tecnico/admin precisa ser revisada para garantir que tecnico veja apenas seus proprios dados.
- A documentacao atual descreve scripts e recursos que nao parecem estar totalmente implementados, como migracoes.
- O design atual e funcional, mas ainda parece uma base administrativa simples, nao uma ferramenta operacional robusta para rotina diaria.

## Principios da reestruturacao

1. O sistema sera modelado pelo dominio do cliente, nao pelas telas atuais.
2. Importacao sera tratada como processo critico: upload, preview, validacao, deduplicacao, confirmacao e historico.
3. Formula de planilha devera virar regra de negocio nomeada, documentada e testavel.
4. Escala planejada e horas realizadas serao entidades separadas.
5. Pagamento sera calculado a partir de servicos, regras do tecnico, beneficios, descontos, adiantamentos, premios e banco de horas.
6. Cada tecnico tera dashboard proprio, com visao clara de producao, metas, valores, horas, escala e documentos.
7. A interface sera redesenhada para uso administrativo real: densa, clara, rapida para filtrar, conferir e comparar dados.
8. O sistema deve manter rastreabilidade: origem da importacao, data, usuario, linhas aceitas, linhas rejeitadas e erros.

## Arquitetura alvo

### Camadas propostas

- `app/`: rotas e telas Next.js.
- `components/`: componentes visuais reutilizaveis e componentes especificos de dominio.
- `features/`: modulos por dominio, como importacao, tecnicos, servicos, folha, horas, escala e biblioteca.
- `lib/db`: acesso ao banco e helpers compartilhados.
- `lib/domain`: regras puras de negocio, calculos e validacoes.
- `lib/importers`: leitores de planilhas, mapeadores e validadores por tipo de arquivo.
- `lib/auth`: autenticacao, sessao e autorizacao.
- `lib/formatters`: moeda, datas, competencia, horas e percentuais.

### Modulos principais

1. Importacao de dados.
2. Cadastro de tecnicos.
3. Servicos/ordens de servico.
4. Dashboard individual do tecnico.
5. Folha, comissao, premios e descontos.
6. Banco de horas.
7. Agenda/escala.
8. Biblioteca de documentos.
9. Administracao e auditoria.

## Modelo de dados alvo

As tabelas atuais devem ser revisadas e complementadas. Proposta inicial:

- `users`: usuarios de acesso.
- `technicians`: dados cadastrais e regras padrao do tecnico.
- `technician_compensation_rules`: historico de percentual, salario, VA, VR e regras por vigencia.
- `service_orders`: ordens de servico importadas ou cadastradas.
- `service_types`: catalogo de tipos de servico e regras especificas.
- `service_import_batches`: lotes de importacao de servicos.
- `work_time_entries`: registros de horas realizadas.
- `work_time_import_batches`: lotes de importacao de horas.
- `schedule_entries`: escala planejada, folgas e disponibilidade.
- `hour_bank_movements`: movimentos do banco de horas.
- `discounts`: descontos, adiantamentos e ajustes.
- `payroll_runs`: fechamento por competencia.
- `payroll_items`: detalhes do calculo do pagamento.
- `documents`: biblioteca de PDFs e materiais internos.
- `audit_logs`: historico de acoes sensiveis.

## Plano de modificacao

### Fase 1 - Diagnostico tecnico e desenho definitivo

- Auditar telas, APIs, tipos e fluxo de autenticacao existentes.
- Comparar o schema atual com a necessidade real das planilhas.
- Documentar regras de calculo encontradas no `MODELO TESTE.xlsx`.
- Documentar os comportamentos validos do prototipo `dashboard-leonilson (1).html` para reutilizar como requisitos da aba do tecnico.
- Listar campos obrigatorios por planilha.
- Definir contrato de dados para cada importacao.
- Identificar dados sensiveis que tecnico pode ou nao visualizar.

Entrega esperada: especificacao tecnica curta com entidades, regras, permissoes e fluxo de importacao.

### Fase 2 - Reestruturacao de arquitetura

- Criar organizacao por dominio (`features/import`, `features/payroll`, `features/hours`, `features/schedule`, etc.).
- Separar UI, chamadas de API, validacao e regras de negocio.
- Centralizar formatacao de moeda, horas, competencia e datas.
- Criar camada de autorizacao para admin e tecnico.
- Revisar inconsistencias entre `user_id`, `technician_id` e acesso do tecnico logado.

Entrega esperada: base tecnica limpa para evoluir sem espalhar regra de negocio em telas.

### Fase 3 - Banco de dados e migracoes

- Criar ou revisar migracoes do banco.
- Ajustar tabelas atuais para suportar importacoes, historico e rastreabilidade.
- Criar indices e constraints, principalmente para evitar OS duplicada.
- Criar historico de regras de pagamento por competencia.
- Modelar banco de horas por movimentos, nao apenas saldo final.

Entrega esperada: schema pronto para suportar operacao real.

### Fase 4 - Importacao de planilhas

- Implementar upload XLSX/CSV.
- Criar selecao do tipo de importacao: servicos, modelo de pagamento, horas, escala ou documentos.
- Ler arquivo no servidor com `xlsx`.
- Exibir preview antes de gravar.
- Validar campos obrigatorios, datas, valores, tecnico, QRA e competencia.
- Detectar duplicidade de OS.
- Mostrar linhas aceitas, rejeitadas e motivos de erro.
- Salvar lote de importacao e vincular registros importados ao lote.

Entrega esperada: importacao confiavel, com conferencias antes de persistir.

### Fase 5 - Regras de pagamento

- Transformar as formulas do `MODELO TESTE.xlsx` em funcoes de dominio.
- Calcular premio/comissao por servico.
- Considerar percentual por tecnico, com possibilidade de excecao por vigencia.
- Considerar salario, VA, VR, adiantamento, desconto, hora extra, outros e premiacao por competencia.
- Gerar fechamento por competencia.
- Permitir recalcular folha e preservar historico.
- Criar detalhamento por tecnico e por item de calculo.

Entrega esperada: calculo financeiro auditavel e proximo da planilha original.

### Fase 6 - Banco de horas

- Importar horas realizadas a partir da planilha `HORAS GERAIS PARA GOOGLE.xlsx`.
- Modelar jornada prevista por tecnico ou por escala.
- Calcular saldo diario: horas realizadas menos horas previstas.
- Consolidar saldo semanal, mensal e acumulado.
- Registrar horas positivas, negativas, compensacoes, folgas e ajustes manuais.
- Exibir banco de horas na aba do tecnico e no painel admin.

Entrega esperada: banco de horas real, separado da folha e conectado a escala.

### Fase 7 - Agenda e escala

- Criar calendario de escala para admin.
- Permitir marcar turno, folga, ausencia, plantao e observacoes.
- Filtrar por tecnico, dia, semana e mes.
- Exibir disponibilidade e conflitos.
- Criar visualizacao do tecnico com sua propria agenda.
- Preparar importacao futura de escala, se o cliente mantiver fonte externa.

Entrega esperada: escala planejada visivel e operacional.

### Fase 8 - Dashboard do tecnico

- Redesenhar a home do tecnico como dashboard individual, usando `dashboard-leonilson (1).html` como referencia funcional.
- Incluir filtros por ano, competencia e quinzena.
- Exibir total a receber, total de OS, valor produzido, comissao/premio, banco de horas e proximas escalas.
- Criar indicadores de meta por competencia, incluindo as metas de 80 OS e 160 OS vistas no prototipo, se confirmadas pelo cliente.
- Criar grafico de servicos por tipo com interacao para filtrar a tabela.
- Criar busca por codigo de OS.
- Criar tabela detalhada de ordens de servico com codigo, tipo, competencia, data, valor bruto, premio/comissao e origem da importacao.
- Exibir breakdown salarial com salario, VA, VR, descontos, adiantamentos, horas extras, comissao e liquido.
- Remover dados fixos do prototipo e buscar tudo por API/banco de dados.
- Evoluir o visual do prototipo para uma interface mais profissional, integrada ao design system do projeto.

Entrega esperada: aba do tecnico proxima ao prototipo desejado, mas conectada a dados reais.

### Fase 9 - Redesign do admin

- Redesenhar navegacao lateral e topo.
- Criar painel de operacao com cards compactos, filtros e tabelas fortes.
- Criar telas de tecnicos, servicos, horas, escala, folha, importacao e biblioteca com padrao visual unico.
- Trocar placeholders e textos quebrados por interface polida.
- Usar icones consistentes e componentes reutilizaveis.
- Evitar pagina com cara de landing page; o primeiro foco e operacao diaria.

Entrega esperada: sistema com aparencia profissional, densa e pratica para uso interno.

### Fase 10 - Biblioteca de documentos

- Criar modulo para upload e listagem de PDFs.
- Permitir categorizar documentos, como cobertura, procedimentos, seguradora e documentos internos.
- Controlar acesso por perfil.
- Permitir busca por titulo, categoria e tags.

Entrega esperada: biblioteca interna simples e util para tecnicos e admin.

### Fase 11 - Validacao, testes e acabamento

- Testar importacao com os arquivos reais da pasta `contexto`.
- Criar testes para calculos financeiros e banco de horas.
- Validar permissoes de tecnico versus admin.
- Conferir responsividade em desktop e mobile.
- Conferir estados vazios, loading, erro e sucesso.
- Validar fechamento de uma competencia comparando sistema versus planilha.

Entrega esperada: fluxo principal pronto para demonstracao ao cliente.

## Redesign visual planejado

Direcao visual recomendada:

- Interface de sistema operacional, nao pagina de marketing.
- Navegacao lateral clara.
- Tabelas densas e bem filtraveis.
- Cards apenas para KPIs e itens repetidos.
- Cores sobrias com bom contraste, evitando visual monocromatico.
- Tipografia menor e objetiva em areas administrativas.
- Indicadores visuais para status de importacao, escala, horas e pagamento.
- Graficos apenas onde ajudam a decidir ou conferir.
- O prototipo `dashboard-leonilson (1).html` deve orientar a hierarquia de informacao do dashboard do tecnico, mas o visual final deve ser redesenhado do zero dentro da aplicacao.

Telas prioritarias:

1. Admin - Visao geral.
2. Admin - Importacao.
3. Admin - Tecnicos.
4. Admin - Servicos.
5. Admin - Horas e banco de horas.
6. Admin - Agenda/escala.
7. Admin - Folha/fechamento.
8. Tecnico - Dashboard individual.
9. Tecnico - Servicos.
10. Tecnico - Banco de horas.
11. Tecnico - Agenda.
12. Tecnico - Pagamento.
13. Biblioteca.

## Perguntas pendentes para o cliente

Estas perguntas precisam ser confirmadas antes de fechar as regras definitivas:

- A comissao e sempre 25% ou depende do tecnico/tipo de servico?
- Existem tecnicos com 26%, 30% ou outra taxa fixa?
- A taxa pode mudar por periodo?
- O premio e sempre calculado sobre o valor bruto da OS?
- Existem tipos de servico com regra diferente, como fechadura, sofa ou visita frustrada?
- Como funciona a premiacao por competencia?
- As metas de 80 OS e 160 OS sao fixas ou variam por tecnico/mes?
- Qual e a carga horaria diaria padrao?
- Sabado, domingo e feriado entram como regra especial?
- O que conta como hora extra?
- Horas negativas descontam pagamento ou apenas entram no banco?
- Como as compensacoes devem ser lancadas?
- A escala sera cadastrada manualmente, importada de planilha ou integrada com sistema da seguradora?
- O tecnico pode ver valores financeiros completos ou somente producao?
- O tecnico pode baixar documentos/PDFs?
- A planilha deve ser substituida totalmente ou o sistema vai conviver com ela por um periodo?
- Quais documentos internos podem aparecer para todos e quais sao restritos?

## Riscos principais

- Subestimar as formulas da planilha e entregar um calculo diferente do que o cliente usa.
- Misturar escala planejada com horas realizadas.
- Importar dados sem preview e gerar duplicidades ou pagamentos errados.
- Permitir que tecnico acesse dados financeiros de outros tecnicos.
- Construir apenas telas bonitas sem resolver o fluxo operacional.
- Nao preservar historico de regras quando uma taxa, salario ou beneficio mudar.

## Criterios de sucesso

O projeto sera considerado bem direcionado quando:

- O admin conseguir importar planilhas reais e validar erros antes de gravar.
- Cada OS ficar vinculada ao tecnico correto.
- O calculo de pagamento bater com a planilha do cliente em uma competencia de teste.
- O tecnico conseguir ver sua propria producao, pagamento, escala e banco de horas.
- A aba do tecnico entregar, no sistema real, os mesmos blocos funcionais aprovados no `dashboard-leonilson (1).html`, com design superior e dados vindos do banco.
- O admin conseguir ver quem esta escalado, quem esta de folga e quem possui saldo positivo/negativo de horas.
- O sistema tiver rastreabilidade por lote de importacao.
- O design parecer uma ferramenta de gestao pronta para operacao diaria.

## Proxima acao recomendada

A proxima etapa deve ser iniciar a Fase 1: auditoria tecnica e desenho definitivo das entidades/regras. Depois disso, a implementacao deve comecar pela arquitetura, banco e importacao, antes do redesign completo das telas, porque o design final precisa refletir dados e regras reais.

## Atualizacao de regras recebida em 20/05/2026

- Biblioteca: todos os usuarios logados terao acesso e qualquer pessoa podera subir PDF.
- Pagamento: a aba individual esta no caminho correto, mas precisa incluir premiacao extraordinaria no fechamento.
- Premiacao extraordinaria: 80 OS gera R$ 250,00; 160 OS gera R$ 600,00.
- Regra de pagamento: o tecnico recebe 25% do valor bruto produzido, diluido entre salario fixo, VA, VR e comissao complementar.
- Parametros atuais informados: salario fixo em torno de R$ 2.664,00, VA de R$ 249,00 e VR de R$ 31,80 por dia.
- Banco de horas precisa entrar no fechamento indicando se o colaborador deve horas ou se a empresa deve horas ao colaborador.
- Agenda: a visao individual esta adequada; o administrador precisa de uma visao geral de todos os prestadores por dia.
- Dashboard do tecnico: na composicao salarial resumida, o valor da premiacao extraordinaria nao deve ser detalhado, embora faca parte do liquido quando houver fechamento.
