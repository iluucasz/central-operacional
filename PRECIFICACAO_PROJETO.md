# Precificação do projeto - Central Operacional

Documento simples para ajudar a transformar o escopo técnico do projeto em módulos precificáveis.

Data da análise: 04/06/2026.

## Contexto resumido

O projeto é uma aplicação interna de gestão operacional e financeira para técnicos. A base atual usa Next.js, React, Tailwind/Radix, autenticação por JWT em cookie, banco Neon/PostgreSQL, APIs próprias e leitura de planilhas XLSX/CSV.

A dor principal do cliente é substituir controles manuais em planilhas por um sistema com login, importação, cálculo de produção, folha, banco de horas, escala, dashboards por perfil, biblioteca de documentos e controle financeiro.

## Como pensar o preço

Não precifique apenas por tela. Este projeto tem regra de negócio sensível: folha de pagamento, banco de horas, importação de OS e permissões por perfil. O preço deve considerar:

- Levantamento e validação das regras com o cliente.
- Desenvolvimento das telas e APIs.
- Banco de dados, migrações e segurança.
- Tratamento de erros, dados duplicados e planilhas fora do padrão.
- Testes com planilhas reais.
- Ajustes de homologação e implantação.

Referência de método: o Sebrae recomenda formar preço considerando custos, despesas, margem de lucro, ponto de equilíbrio e posicionamento de mercado.

Fonte: https://loja.sebrae.com.br/como-definir-preco-de-venda-1-371440103446

## Módulos do projeto

| Módulo | Descrição sucinta | Complexidade | Estimativa |
| --- | --- | --- | --- |
| 1. Base técnica e layout | Estrutura Next.js, app shell, navegação lateral, componentes visuais, formatadores, estados de loading/erro e padrão visual geral. | Média/Alta | 50h a 80h |
| 2. Autenticação e permissões | Login, logout, sessão, JWT em cookie, middleware e separação entre administrador e técnico. | Alta | 35h a 55h |
| 3. Gestão de técnicos | CRUD de técnicos, vínculo com usuário, QRA, e-mail, senha, status, comissão, salário, VA e VR. | Média | 35h a 55h |
| 4. Ordens de serviço | Cadastro, edição, exclusão, filtros, competência, quinzena, valor, tipo de serviço, técnico e histórico de OS. | Alta | 55h a 85h |
| 5. Importação de OS | Leitura XLSX/CSV, modelo de planilha, prévia, validação de linhas, rejeições, Q1/Q2, competência e envio para API. | Alta | 70h a 110h |
| 6. Agenda e escala | Montagem de escala diária, semanal, mensal ou anual, horários, folgas, revezamentos, recorrências, exceções e visão geral. | Muito alta | 120h a 180h |
| 7. Apontamento e banco de horas | Registro de horas realizadas, comparação com escala, saldo da competência, banco acumulado e visão do técnico. | Alta | 60h a 95h |
| 8. Folha de pagamento | Cálculo por competência, comissão, salário, VA/VR, descontos, adiantamentos, horas extras, prêmio extraordinário e fechamento. | Muito alta | 100h a 155h |
| 9. PDF/recibo de folha | Geração visual da folha do técnico e fluxo de impressão/salvar como PDF após fechamento. | Média | 20h a 35h |
| 10. Dashboard do técnico | Visão individual com produção, metas 80/160 OS, valores, banco de horas, escala, gráficos, filtros e tabela de OS. | Alta | 70h a 105h |
| 11. Dashboard administrativo | Visão geral da operação, competência, pendências de folha, produção por técnico, atalhos e indicadores de gestão. | Alta | 45h a 75h |
| 12. Faturamento | Indicadores de faturamento mensal/anual, custo de folha, lucro, margem, ticket médio, evolução e ranking por funcionário/tipo. | Alta | 45h a 75h |
| 13. Controle financeiro | Contas a pagar/receber, parcelas, recorrência, baixa parcial, DRE por competência, reservas, investimentos e vencimentos. | Alta | 70h a 115h |
| 14. Biblioteca de documentos | Upload de PDF, categorias, público global/individual/admin, controle de acesso e galeria para admin e técnico. | Média | 40h a 65h |
| 15. APIs, banco e migrações | Rotas REST, queries, schemas auxiliares, constraints, índices, persistência e ajustes de compatibilidade do banco. | Alta | 70h a 110h |
| 16. Validação, QA e implantação | Testes manuais com planilhas reais, revisão de permissões, conferência de folha, build, deploy e ajustes finais. | Alta | 80h a 130h |

## Estimativa consolidada

| Cenário | O que inclui | Horas | Quando usar |
| --- | --- | ---: | --- |
| MVP operacional | Login, técnicos, OS, importação principal, folha básica, dashboard técnico, escala simples e biblioteca. | 420h a 560h | Para vender uma primeira entrega funcional com escopo controlado. |
| Produto recomendado | Escopo atual com dashboards, folha revisável, escala avançada, banco de horas, faturamento, financeiro e biblioteca. | 780h a 1.180h | Para vender o sistema como produto interno robusto. |
| Produto completo | Produto recomendado com testes mais fortes, auditoria, histórico de importações, melhorias de segurança, relatórios e polimento extra. | 1.050h a 1.500h | Para contrato maior, com entrega mais madura e menor risco operacional. |

## Simulação de valores

Use a fórmula:

```text
Preço = horas estimadas x taxa/hora + reserva técnica + margem comercial
```

Sugestão prática:

- Reserva técnica: 15% a 25% sobre as horas.
- Margem comercial: 20% a 40% sobre o custo calculado.
- Evite fechar valor fixo sem limitar planilhas, regras de folha, quantidade de revisões e prazo de homologação.

### Exemplo usando o produto recomendado

| Taxa base | 780h | 1.180h |
| --- | ---: | ---: |
| R$ 100/h | R$ 78.000 | R$ 118.000 |
| R$ 140/h | R$ 109.200 | R$ 165.200 |
| R$ 180/h | R$ 140.400 | R$ 212.400 |

Esses valores ainda não incluem reserva técnica nem margem comercial. Com reserva e margem, o preço final tende a subir.

## Faixa sugerida para proposta

Para não vender barato demais, eu separaria assim:

| Pacote | Valor sugerido | Observação |
| --- | ---: | --- |
| Entrada/MVP | R$ 45.000 a R$ 70.000 | Escopo enxuto, sem todas as regras avançadas e com homologação curta. |
| Recomendado | R$ 95.000 a R$ 160.000 | Melhor faixa para o escopo observado no projeto atual. |
| Completo | R$ 160.000 a R$ 240.000+ | Inclui robustez, testes, auditoria, relatórios e margem para mudanças. |

## Pontos que aumentam o preço

- Regras de folha diferentes por técnico, período ou tipo de serviço.
- Importação de várias planilhas com layouts diferentes.
- Necessidade de bater valores exatamente com planilhas antigas.
- Histórico/auditoria de alterações sensíveis.
- Exportação de relatórios, PDFs personalizados e recibos formais.
- Controle de banco de horas com saldo negativo, compensação, faltas e feriados.
- Deploy, domínio, backup, monitoramento e suporte mensal.

## Pontos que podem ficar fora do primeiro orçamento

- Aplicativo mobile.
- Notificações automáticas.
- Integração com sistema de seguradora.
- Auditoria completa de todos os eventos.
- Relatórios avançados exportáveis.
- Assinatura eletrônica de documentos.
- Testes automatizados extensos.

## Sugestão de contrato

Divida o projeto em fases:

1. Diagnóstico e validação das regras.
2. Módulo operacional: técnicos, OS e importação.
3. Folha, banco de horas e escala.
4. Dashboards e biblioteca.
5. Financeiro, faturamento e acabamento.
6. Homologação, deploy e suporte.

Para suporte após entrega, cobre mensalidade separada. Uma faixa razoável para manutenção evolutiva é de 10% a 20% do valor do projeto por mês, dependendo do SLA, urgência e volume de ajustes.

## Recomendação final

Se o cliente quer o sistema completo visto no repositório, com importação, folha, escala, banco de horas, dashboards, biblioteca e financeiro, eu não apresentaria como projeto pequeno.

Minha recomendação comercial: vender o escopo recomendado entre R$ 95.000 e R$ 160.000, com regras bem fechadas no contrato. Se o cliente pedir mais segurança, auditoria, testes e relatórios, a proposta deve ir para a faixa completa.
