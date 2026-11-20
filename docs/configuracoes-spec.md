# Unit-On: ecossistema de gestão inteligente

Decisões tomadas com o usuário em 20/11/2026. Domínio: **unit-on.com.br** (registro em andamento).

## Visão geral
A Unit-On reúne vários apps de gestão no mesmo domínio:

- **Um login só** para todos os apps.
- **Um cadastro de empresa só.**
- **Um plano** que diz quais apps a empresa contratou.

O app de escala (EscalaSmart/FolgaSmart) é o primeiro deles.

| Endereço | Para quê |
|---|---|
| `unit-on.com.br` / `www` | Site da marca: apresentação dos apps, preços, botão "Teste grátis" |
| `conta.unit-on.com.br` | **Núcleo**: login único, cadastro de teste por CNPJ, empresa, lojas, usuários, perfis e plano |
| `suporte.unit-on.com.br` | Painel do Desenvolvedor/Suporte |
| `escala.unit-on.com.br` | App de escala (frontend no Cloudflare Pages) |
| `api.unit-on.com.br` | Servidor do app de escala (Worker com D1) |
| `<app>.unit-on.com.br` | Próximos apps do ecossistema |

- Até o domínio ser ativado, o app de escala segue em `folgasmart.pages.dev`.
- Esse endereço continua funcionando durante a transição.

## Arquitetura
- **Núcleo (`conta`)**: um serviço próprio, com banco próprio, que guarda:
  - empresas, lojas, usuários, perfis;
  - planos e apps contratados;
  - períodos de teste e contratos;
  - registro do acesso de suporte.
- **Cada app** guarda só os próprios dados. No app de escala, são funcionários, escalas, jornadas, feriados e movimento, sempre separados por empresa e loja.
- **Sessão compartilhada** entre os subdomínios de `unit-on.com.br`:
  - a pessoa entra uma vez em `conta` e é levada de volta ao app;
  - cada app consulta o núcleo para saber quem é a pessoa, qual a empresa, qual o perfil e quais apps estão liberados.
- **E-mail do domínio**:
  - os códigos de verificação saem de `nao-responda@unit-on.com.br`;
  - `contato@` e `suporte@` são encaminhados pelo Cloudflare Email Routing.

## Empresas, lojas e teste grátis (núcleo)
- Vários clientes no mesmo sistema; cada empresa vê só os próprios dados.
- Cada empresa cadastra suas **lojas**. Em cada app, as lojas têm dados separados. No app de escala, cada loja tem seus funcionários e escalas.
- **Cadastro de teste:** o cliente informa CNPJ, telefone e e-mail.
  - O CNPJ é consultado na base pública, que preenche a razão social e confere se está ativo.
  - Um código é enviado ao e-mail antes de liberar o acesso.
  - Cada CNPJ tem direito a **um único** período de teste.
- O teste dura **14 dias**. Se vencer sem contrato, o acesso fica **só leitura**.
- **Plano e limites** (apps, lojas, gestores, operadores) entram quando o suporte confirma o contrato assinado.
- O BigBom é o primeiro cliente, com contrato ativo. Os dados atuais são migrados para a empresa e a loja dele.

## Usuários e perfis (núcleo)
- O login é por **e-mail e senha**. O admin cadastra uma senha inicial e a pessoa troca no primeiro acesso.
- Isso substitui a senha única atual.

| Perfil | Pode |
|---|---|
| Desenvolvedor/Suporte | Ver e atender todas as empresas (veja a seção abaixo). Não pertence a nenhuma empresa |
| Admin (da empresa) | Tudo na empresa: configurações, usuários, lojas, liberar dias passados |
| Gerente | Editar a escala das lojas e setores dele. No cadastro do gerente, o admin escolhe as lojas e os setores. Uma loja pode ter mais de um gerente |
| Consulta | Visualizar e marcar falta ou atestado |

**Prazo para marcar falta ou atestado:**
- Consulta: só no próprio dia.
- Gerente: até 1 dia depois.
- Admin: a qualquer momento, ou liberando o gerente para lançar mais tarde.

## Desenvolvedor/Suporte (`suporte.unit-on.com.br`)
- **Painel de clientes:** cadastros de teste, dias restantes, contratos, planos e apps de cada empresa.
- **Confirmar contrato:** ativar o plano e os limites; o teste vira acesso definitivo.
- **Bloquear ou reativar** um cliente, por exemplo por inadimplência ou teste vencido.
- **Entrar na conta do cliente** para atender:
  - aparece a faixa vermelha "Login feito por usuário de suporte (nome)";
  - tudo o que for alterado fica registrado com o nome de quem fez.
- **Segurança:**
  - a conta de desenvolvedor não é criada pela tela; os e-mails autorizados ficam numa configuração do Cloudflare;
  - o login pede um código de verificação.
- **Equipe de suporte:** cada pessoa tem o próprio login, para saber quem entrou em qual cliente.

## App de escala: Configurações (só Admin)
- **Setores:** lista mantida pelo admin. No cadastro do funcionário, basta escolher o setor.
- **Escalas:** modelos de escala (6x1, 5x2, 5x2 · 42h e os que o admin cadastrar) e a escala de cada setor **com data de início**. As semanas anteriores não mudam.
- **Jornadas** e **Feriados**: vieram das abas antigas.

### Troca de 14/12/2026
- Todos os setores passam automaticamente para **5x2 com 42h semanais** a partir de **14/12/2026**. O horário do dia é ajustado para 8h24, mantendo a entrada e o intervalo da jornada.
- O admin pode ajustar um setor depois, programando outra troca.
- De 07/12 a 13/12, aparece um aviso a cada acesso.

## Etapas
1. **Concluída. Escala com vigência, no app de escala atual:**
   - aba Configurações com Setores, Escalas, Jornadas e Feriados;
   - troca de 14/12 e aviso.
   - Enquanto não existem usuários, as Configurações pedem a senha do administrador.
2. **Domínio:**
   - ativar `unit-on.com.br` no Cloudflare;
   - ligar `escala` e `api`;
   - e-mail do domínio;
   - site simples em `www`.
3. **Núcleo `conta`:**
   - empresas e lojas, usuários e login por e-mail, perfis;
   - sessão compartilhada entre os subdomínios.
   - Inclui separar os dados do app de escala por empresa e loja e migrar o BigBom.
4. **Regras de perfil no app de escala:**
   - Gerente limitado às próprias lojas e setores;
   - Consulta só visualiza e marca falta ou atestado;
   - prazos de falta e atestado.
5. **Comercial e suporte:**
   - cadastro de teste por CNPJ, com código no e-mail e 14 dias;
   - modo só leitura;
   - painel `suporte` com contratos, planos e limites, bloqueio e entrada na conta do cliente.
