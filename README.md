# Central Operacional

Um sistema completo e moderno para gerenciar técnicos, suas atividades, horas trabalhadas e pagamentos com cálculos automáticos.

## Características Principais

### 👥 Gestão de Técnicos
- Cadastro de técnicos com dados pessoais e profissionais
- Rastreamento de QRA (Qualificação Profissional)
- Configuração de salário base, comissões e benefícios
- Controle de status (ativo/inativo)

### 🔧 Gestão de Serviços
- Registro de ordens de serviço com código único
- Rastreamento de tipo, valor e data do serviço
- Associação com competência mensal
- Histórico completo de serviços por técnico

### ⏰ Controle de Horas
- Registro diário de horas trabalhadas
- Rastreamento de hora de entrada e saída
- Cálculo automático de horas trabalhadas
- Controle por semana e mês

### 📅 Agenda/Escala
- Planejamento da escala de técnicos
- Configuração de horários
- Status de agendamentos (programado, concluído, cancelado)

### 💰 Folha de Pagamento
- **Cálculos Automáticos:**
  - Comissão sobre serviços realizados
  - Horas extras com multiplicador 1.5x
  - Deduções de vale alimentação e refeição
  - Descontos e adiantamentos

- **Banco de Horas:**
  - Rastreamento de horas extras acumuladas
  - Saldo mensal atualizado automaticamente
  - Compensação em folhas futuras

### 📊 Painéis Administrativos
- **Dashboard Admin:** Visão geral de todos os técnicos, serviços e pagamentos
- **Dashboard Técnico:** Visualização pessoal de desempenho e pagamento
- **Relatórios:** Histórico de serviços, horas e pagamentos

## Requisitos de Sistema

- Node.js 18+
- PostgreSQL (via Neon)
- pnpm (gerenciador de pacotes)

## Instalação

1. Clone o repositório
```bash
git clone <seu-repositório>
cd central-operacional
```

2. Instale as dependências
```bash
pnpm install
```

3. Configure as variáveis de ambiente
```bash
cp .env.example .env.local
```

4. Adicione sua `DATABASE_URL` do Neon em `.env.local`

5. Execute as migrações do banco de dados
```bash
pnpm db:migrate
```

6. Inicie o servidor de desenvolvimento
```bash
pnpm dev
```

A aplicação estará disponível em `http://localhost:3000`

## Estrutura de Banco de Dados

### Tabelas Principais

#### `technicians`
Armazena informações dos técnicos
- `id` (UUID): Identificador único
- `user_id` (UUID): Referência ao usuário de autenticação
- `qra` (TEXT): Número de qualificação
- `name` (TEXT): Nome completo
- `email` (TEXT): Email
- `commission_percentage` (NUMERIC): Percentual de comissão
- `base_salary` (NUMERIC): Salário base
- `va_allowance` (NUMERIC): Vale alimentação
- `vr_allowance` (NUMERIC): Vale refeição
- `status` (ENUM): 'active' ou 'inactive'

#### `services`
Registro de ordens de serviço
- `id` (UUID): Identificador único
- `order_code` (TEXT): Código da ordem (único)
- `technician_id` (UUID): Técnico responsável
- `service_type` (TEXT): Tipo de serviço
- `value` (NUMERIC): Valor do serviço
- `date_performed` (DATE): Data de realização
- `competence_month` (TEXT): Mês de competência (YYYY-MM)

#### `work_hours`
Registro de horas trabalhadas
- `id` (UUID): Identificador único
- `technician_id` (UUID): Técnico
- `date` (DATE): Data
- `start_time` (TIME): Hora de entrada
- `end_time` (TIME): Hora de saída
- `hours_worked` (NUMERIC): Total de horas
- `week_number` (INTEGER): Número da semana

#### `schedule`
Agenda/Escala dos técnicos
- `id` (UUID): Identificador único
- `technician_id` (UUID): Técnico
- `date` (DATE): Data da escala
- `start_time` (TIME): Hora de entrada
- `end_time` (TIME): Hora de saída
- `status` (ENUM): 'scheduled', 'completed', 'cancelled'

#### `discounts`
Descontos e adiantamentos
- `id` (UUID): Identificador único
- `technician_id` (UUID): Técnico
- `type` (ENUM): 'discount', 'advance', 'other'
- `amount` (NUMERIC): Valor
- `reason` (TEXT): Motivo
- `competence_month` (TEXT): Mês de competência

#### `payroll`
Folha de pagamento calculada
- `id` (UUID): Identificador único
- `technician_id` (UUID): Técnico
- `competence_month` (TEXT): Mês
- `total_services_value` (NUMERIC): Total de serviços
- `commission_value` (NUMERIC): Comissão calculada
- `base_salary` (NUMERIC): Salário base
- `va_deduction` (NUMERIC): Desconto VA
- `vr_deduction` (NUMERIC): Desconto VR
- `discounts_total` (NUMERIC): Total de descontos
- `advances_total` (NUMERIC): Total de adiantamentos
- `extra_hours_value` (NUMERIC): Valor de horas extras
- `extraordinary_award_value` (NUMERIC): Premiacao extraordinaria por meta de OS
- `hour_bank_balance` (NUMERIC): Saldo de banco de horas
- `net_total` (NUMERIC): Total líquido

## API Endpoints

### Autenticação
- `POST /api/auth/login` - Fazer login
- `POST /api/auth/logout` - Fazer logout

Criação de usuários: realizada apenas pelo administrador dentro da plataforma.

### Técnicos (Admin)
- `GET /api/technicians` - Listar todos os técnicos
- `POST /api/technicians` - Criar novo técnico

### Serviços
- `GET /api/services` - Listar serviços
- `POST /api/services` - Criar novo serviço

### Horas Trabalhadas
- `GET /api/work-hours` - Listar horas
- `POST /api/work-hours` - Registrar horas

### Agenda
- `GET /api/schedule` - Listar escala
- `POST /api/schedule` - Criar escala

### Descontos
- `GET /api/discounts` - Listar descontos
- `POST /api/discounts` - Criar desconto (Admin)

### Folha de Pagamento
- `GET /api/payroll` - Listar pagamentos
- `POST /api/payroll/calculate` - Calcular pagamento mensal (Admin)

## Fluxo de Trabalho

### Para Administradores

1. **Cadastrar Técnicos**
   - Vá para Admin > Técnicos
   - Clique em "Adicionar Técnico"
   - Preencha nome, email, comissão, salário, benefícios

2. **Registrar Serviços**
   - Vá para Admin > Serviços
   - Clique em "Adicionar Serviço"
   - Selecione técnico, tipo, valor, data e competência

3. **Registrar Horas**
   - Acesse Admin > Serviços ou Horas
   - Registre as horas trabalhadas diárias

4. **Calcular Folha de Pagamento**
   - Vá para Admin > Folha Pagamento
   - Selecione o mês desejado
   - Clique em "Calcular" para processar automaticamente

### Para Técnicos

1. **Visualizar Dashboard**
   - Faça login com suas credenciais
   - Visualize KPIs: serviços, valor total, horas trabalhadas

2. **Consultar Serviços**
   - Acesse Dashboard > Serviços
   - Veja histórico completo de serviços realizados

3. **Verificar Horas Trabalhadas**
   - Acesse Dashboard > Horas
   - Acompanhe registro diário de horas

4. **Consultar Pagamento**
   - Acesse Dashboard > Pagamento
   - Visualize detalhamento de folha mensal
   - Acompanhe saldo de banco de horas

## Cálculos Automáticos

### Comissão
```
Comissão = Valor Total de Serviços × Percentual de Comissão
```

### Horas Extras
```
Horas Padrão por Mês = 8 horas/dia × 22 dias = 176 horas
Horas Extras = Total de Horas - Horas Padrão (se positivo)
Valor Horas Extras = Horas Extras × Taxa Horária × 1.5
```

### Banco de Horas
```
Saldo Atual = Saldo Anterior + Horas Extras do Mês
```

### Pagamento Líquido
```
Bruto = Salário Base + VA + VR + Comissão + Horas Extras
Líquido = Bruto - Descontos - Adiantamentos
```

## Roles e Permissões

### Admin
- ✓ Gerenciar técnicos
- ✓ Registrar serviços
- ✓ Registrar horas
- ✓ Gerenciar agenda
- ✓ Calcular folha de pagamento
- ✓ Visualizar relatórios

### Técnico
- ✗ Criar técnicos
- ✗ Gerenciar outros técnicos
- ✓ Visualizar próprios dados
- ✓ Consultar serviços realizados
- ✓ Acompanhar horas trabalhadas
- ✓ Visualizar própria folha de pagamento

## Segurança

- **Autenticação:** JWT com HTTP-only cookies
- **Senhas:** Hashed com bcrypt (10 rounds)
- **Autorização:** Middleware de validação de roles
- **Queries:** Prepared statements (parameterized queries)
- **CORS:** Restrito a domínios autorizados

## Variáveis de Ambiente

```
DATABASE_URL=postgresql://user:password@host:port/dbname
JWT_SECRET=sua-chave-secreta-aqui
NODE_ENV=production
```

## Troubleshooting

### Erro: DATABASE_URL não definido
- Verifique se a variável está em `.env.local`
- Reinicie o servidor: `pnpm dev`

### Erro: Conexão recusada com banco
- Confirme que Neon está acessível
- Teste a connection string: `psql <DATABASE_URL>`

### Erro: Usuário não autorizado
- Verifique o role do usuário no banco
- Confirme que o token JWT é válido

## Próximos Passos

- [ ] Implementar importação de planilhas (CSV/XLSX)
- [ ] Adicionar gráficos e relatórios avançados
- [ ] Sistema de notificações
- [ ] Integração com folha de pagamento
- [ ] APP mobile
- [ ] Backup automático

## Licença

Proprietário - Central Operacional

## Suporte

Para dúvidas ou problemas, entre em contato com o time de desenvolvimento.
