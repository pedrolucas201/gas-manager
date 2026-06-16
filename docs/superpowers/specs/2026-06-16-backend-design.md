# Spec — Backend na nuvem (gas-manager)

**Data:** 2026-06-16
**Status:** design aprovado, pronto pra virar plano de implementação (`writing-plans`)
**Sub-projeto:** #2 de 4 (ver seção "Escopo")

---

## 1. Contexto e escopo

O gas-manager é hoje um app 100% local (Expo/React Native + SQLite no celular, sem servidor). O dono da distribuidora quer multi-dispositivo (3 funcionários hoje, pode crescer), proteção contra perda de dados e acesso via web/PC. O esforço foi decomposto em **4 sub-projetos** dependentes:

1. Página de download de APKs (Firebase Hosting) — *não iniciado*.
2. **Backend (API Go + Postgres no Cloud Run)** — **esta spec**.
3. Camada de sync offline-first no app mobile — depende do #2.
4. Painel web completo com export/download de relatórios (Firebase Hosting) — depende do #2.

**GCP:** projeto `gas-manager-499616` (número `750551393506`). Região `southamerica-east1`.

### Requisitos fixos (decididos com o usuário)
- **Offline-first com sync:** o app precisa funcionar sem internet e sincronizar quando a rede voltar (não é aceitável "sempre online").
- **Política de conflito:** vendas são SEMPRE aceitas, nunca perdidas. Estoque pode ficar negativo (gera alerta de correção manual, não bloqueia a venda). O mesmo vale pra saldo de cliente acima do limite de crédito (alerta, não bloqueio).
- **Auth:** Firebase Authentication; token validado no backend Go. Sem auth própria.
- **Stack:** API em Go + Postgres (Cloud SQL), Cloud Run.

---

## 2. Arquitetura geral — Ledger pattern

Não é event-sourcing completo. É um **ledger**: tabelas de fato append-only + agregados mutáveis atualizados na mesma transação.

- **Tabelas de fato (append-only):** `sales`, `restocks`, `stock_adjustments`, `debt_settlements`. Nunca sofrem UPDATE de valor nem DELETE físico.
- **Agregados mutáveis:** `inventory.full_qty` / `inventory.empty_qty` e `customers.balance`. Atualizados por **incremento atômico** (`SET x = x + ?`) na **mesma transação** que grava o evento de fato — não recalculados do zero a cada leitura. Mantém auditoria completa e nunca perde venda, com muito menos complexidade que event-sourcing puro.

### Invariantes de arquitetura
- **IDs gerados no cliente (UUID).** Não autoincrement. Resolve idempotência de retry de sync de graça.
- **`sequence BIGSERIAL` por tabela de evento é a fonte de verdade pra ordenação e paginação** (tiebreaker estritamente monotônico, à prova de múltiplas instâncias Cloud Run gravando fora de ordem de wall-clock). `server_received_at TIMESTAMPTZ` existe como metadado de auditoria/exibição. O timestamp do celular é só metadado informativo (celular com hora errada não pode corromper histórico nem ordenação).
- **Cancelamento de venda = evento novo** (`voided_at` / `voided_by` na própria linha de `sales`, mais um `stock_adjustments`/reversão de saldo correspondente conforme o caso), **nunca DELETE físico.** (Diferente do app local hoje, que deleta — ver seção Migração.)
- **`stock_adjustments` é separado de `restocks`:** correção manual de contagem é um tipo de evento diferente de reposição real (compra de fornecedor), pra não poluir o relatório de custo.

---

## 3. Modelo de dados

> Notação: PK = chave primária; campos de evento append-only não recebem UPDATE de valor (só `voided_*`).

### `users`
| coluna | tipo | nota |
|---|---|---|
| `id` | TEXT PK | = Firebase UID |
| `name` | TEXT | |
| `role` | TEXT | `admin` \| `employee` |
| `active` | BOOLEAN | default true |
| `deactivated_at` | TIMESTAMPTZ NULL | marca início da carência de 14 dias |
| `created_at` | TIMESTAMPTZ | |

### `cylinder_types` (catálogo — mutável, last-write-wins)
| coluna | tipo | nota |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT | ex: `P13` |
| `weight_kg` | INT | |
| `sale_price` | NUMERIC | editável |
| `cost_price` | NUMERIC | editável |
| `active` | BOOLEAN | |
| `updated_at` | TIMESTAMPTZ | tiebreaker do last-write-wins |

### `customers` (catálogo + agregado `balance`)
| coluna | tipo | nota |
|---|---|---|
| `id` | UUID PK | |
| `name`, `phone`, `address` | TEXT | catálogo, last-write-wins |
| `credit_limit` | NUMERIC NULL | usado pelo alerta de saldo |
| `balance` | NUMERIC | **agregado mutável** — incremento atômico |
| `updated_at` | TIMESTAMPTZ | tiebreaker do last-write-wins (campos de catálogo) |
| `created_at` | TIMESTAMPTZ | |

> `balance` é atualizado SÓ por eventos de fato (sales fiado, debt_settlements), nunca por edição direta de catálogo. Os campos de catálogo (nome/telefone/endereço/limite) seguem last-write-wins; `balance` segue o ledger. São caminhos distintos na mesma linha.

### `inventory` (agregado mutável)
| coluna | tipo | nota |
|---|---|---|
| `id` | UUID PK | |
| `cylinder_type_id` | UUID FK, UNIQUE | |
| `full_qty` | INT | **agregado** — pode ficar negativo |
| `empty_qty` | INT | **agregado** — vasilhame vazio (troca) |

### Tabelas de fato (append-only)

**`sales`**
| coluna | tipo |
|---|---|
| `id` | UUID PK (cliente) |
| `customer_id` | UUID FK NULL (NULL = venda avulsa / cliente excluído) |
| `cylinder_type_id` | UUID FK |
| `quantity` | INT |
| `unit_price`, `cost_price`, `total` | NUMERIC |
| `payment_method` | TEXT (`cash`/`pix`/`card`/`fiado`) |
| `is_exchange` | BOOLEAN (troca de vasilhame) |
| `created_by` | TEXT FK users |
| `client_created_at` | TIMESTAMPTZ (metadado do celular) |
| `server_received_at` | TIMESTAMPTZ |
| `sequence` | BIGSERIAL |
| `voided_at`, `voided_by` | NULL até cancelamento |

**`restocks`** — `id`, `cylinder_type_id`, `quantity`, `cost_per_unit`, `total_cost`, `notes`, `created_by`, `client_created_at`, `server_received_at`, `sequence`.

**`stock_adjustments`** — correção manual de contagem. `id`, `cylinder_type_id`, `field` (`full`/`empty`), `delta` INT (pode ser negativo), `reason`, `created_by`, `client_created_at`, `server_received_at`, `sequence`.

**`debt_settlements`** — quitação de fiado. `id`, `customer_id`, `amount`, `payment_method`, `created_by`, `client_created_at`, `server_received_at`, `sequence`.

---

## 4. API + Autenticação

### Autenticação
- Toda request leva `Authorization: Bearer <firebase_id_token>`.
- Middleware Go valida o token via Firebase Admin SDK (assinatura + expiração contra o projeto Firebase). Mapeia `firebase_uid` → `users.id`.
- Se `users.active = false`:
  - **Dentro de 14 dias** de `deactivated_at`: aceita **apenas `POST /sync/push`** de eventos cujo `client_created_at` seja anterior a `deactivated_at` (não perde venda já feita). Bloqueia o resto.
  - **Após 14 dias:** 401 em tudo.
- `401`/`403` no app dispara re-autenticação, não backoff de rede (ver seção 5).

### Sync — mobile

**`POST /sync/push`**
- Body: array de eventos pendentes (`sales`, `restocks`, `stock_adjustments`, `debt_settlements`), cada um com `id` (UUID do cliente) e `client_created_at`.
- Processamento **por evento, em transação independente**:
  - `id` não existe → grava evento append-only + incrementa o agregado correspondente atomicamente; define `server_received_at = now()` e `sequence`.
  - `id` já existe **e payload idêntico** (hash de campos materiais bate) → idempotente, `status: "duplicate"`, sem reaplicar. Cobre retry de rede.
  - `id` já existe **e payload diverge** (colisão real de UUID) → `status: "error"` com `error: "id_conflict"`, **não** sobrescreve nem descarta silenciosamente.
  - Falha de validação (FK inexistente, etc.) → `status: "error"` com motivo.
- Resposta por evento: `{ id, status: "applied" | "duplicate" | "error", server_received_at?, sequence?, error? }`. **Uma falha nunca derruba o batch inteiro.**

**`GET /sync/pull?since=<cursor>&limit=<n>`**
- Stream **único e unificado** (mistura todos os tipos de evento), ordenado por `sequence`, paginado por cursor opaco.
- Retorna eventos com `sequence > cursor` até `limit`. Resposta: `{ events: [...], next_cursor, has_more }`. Cliente repete até `has_more = false`.
- `sequence` (não `server_received_at`) garante que nenhum evento "fique atrás" do cursor por gravação fora de ordem entre instâncias.

### Catálogo — CRUD (last-write-wins)
- `POST/PUT /customers`, `DELETE /customers/:id` (regra de negócio: desvincula vendas em vez de apagar — `customer_id = NULL`; bloqueia se `balance` pendente, espelhando o app local atual).
- `PUT /cylinder-types/:id` (preço/custo/ativo).
- Conflito resolvido por **last-write-wins** comparando `updated_at`. Não passa pelo ledger.

### Alertas
- `GET /alerts/negative-stock` — itens de `inventory` com `full_qty < 0` ou `empty_qty < 0`.
- `GET /alerts/over-limit-balance` — clientes com `balance > credit_limit` (quando `credit_limit` definido). Cobre o caso de duas vendas fiado offline pro mesmo cliente que, somadas após sync, estouram o limite.

### Erros operacionais
- `GET /sync/errors` — lista eventos que retornaram `status: "error"` no push, pro admin investigar/corrigir. Esperado ser raro (quase só bug), não um fluxo de uso normal.

---

## 5. Tratamento de erros (app mobile)

- **Fila local persistida** (SQLite): qualquer evento sem confirmação `applied`/`duplicate` persistida é tratado como pendente — **mesmo após restart/kill do app ou queda de bateria** no meio de um retry. Reenvio é seguro porque o push é idempotente por UUID.
- **Retry diferenciado por tipo de falha:**
  - Timeout / falha de transporte → backoff exponencial (1s, 2s, 4s… teto ~5min), baseado em **contador de tentativas**, não no relógio (wall-clock) do celular.
  - `401`/`403` → re-autentica via Firebase e tenta de novo (não é caso de backoff).
  - `5xx` → backoff como rede, mas alerta/log se persistir.
  - Erro de validação por evento (`status: "error"`) → **não bloqueia o resto da fila** (UUIDs independentes seguem); evento problemático fica visível pro admin via `GET /sync/errors`.
- **Pull:** cursor só avança **depois** da página inteira ser persistida com sucesso no SQLite local (commit local). Falha no meio retoma do último cursor confirmado. Reprocessar uma página é idempotente.
- **Visibilidade pro funcionário:** a UI mostra não só "sincronizado / não sincronizado", mas **"N eventos pendentes há mais de X tempo"** — evita que o funcionário venda fiado confiando num saldo local desatualizado há horas/dias por rede ruim.
- App funciona 100% offline; só tenta sync quando detecta rede.

---

## 6. Migração dos dados reais (app já em produção)

O app já está em uso na distribuidora e faz DELETE físico em cancelamentos (há buracos no histórico). Não se tenta reconstruir o passado perfeito.

1. **Snapshot inicial:** script lê o SQLite de cada celular e gera eventos baseline — `initial_balance_migrated` por cliente (saldo atual) e `initial_stock_migrated` por item de inventário (`full_qty`/`empty_qty` atuais). Vira o ponto zero do ledger no Postgres.
2. **Corte em 2 fases** (a loja não para de vender):
   - **Fase A (preparação):** sobe o backend, roda a migração do snapshot; o app ainda grava só local (flag de sync desligada).
   - **Fase B (corte):** publica a versão do app com sync ligada. Cada celular, ao abrir pela primeira vez na nova versão, faz a **captura do delta** — eventos criados localmente entre o snapshot e a atualização daquele celular específico — e envia como push inicial antes de sincronizar normalmente.
3. **Reconciliação:** script de conferência pós-migração compara, por celular, soma de vendas locais (SQLite) vs soma dos eventos recebidos no servidor para o período. Critério de aceite: **100% match** (não "aproximado"); divergência bloqueia considerar aquele celular migrado.
4. **Dry-run obrigatório** contra snapshot real (anonimizado se necessário) antes do corte definitivo.

---

## 7. Infra

- **Cloud SQL Postgres** via **Auth Proxy** (unix socket no container Cloud Run; sem IP público exposto).
- **Pool de conexões pequeno por instância** (~5). Teto explícito de `max_instances` no Cloud Run pra não estourar `max_connections` do Postgres. `min_instances` baixo (custo).
- **Backup automático diário** desde o dia 1 (Cloud SQL nativo), retenção ≥ 7 dias.
- **Região `southamerica-east1`** para Cloud Run e Cloud SQL (latência + custo de tráfego interno).
- **Secrets** (credenciais do banco, service account do Firebase Admin) no **Secret Manager**, nunca env var em texto puro.
- **Deploy:** imagem Go via Cloud Build → Cloud Run. Reaproveitar o padrão já validado no projeto `maps-route-495614`.

---

## 8. Testes (backend)

- **Unitários:**
  - Incremento atômico do agregado na mesma transação do evento.
  - Idempotência de push repetido — incluindo duplicata chegando **depois** de eventos posteriores do mesmo cliente já aplicados (checagem de duplicidade antes do incremento, na mesma transação).
  - Detecção de colisão de UUID com payload divergente → `error`, não `duplicate`.
  - Geração de `negative-stock` e `over-limit-balance`.
  - Cálculo de `balance` após `debt_settlement`.
- **Integração** (banco de teste — testcontainers/emulador):
  - Duas vendas concorrentes pro mesmo `customer_id` → `balance` final é a soma correta (sem lost update); ambos eventos aparecem no pull.
  - Batch com eventos interdependentes (ex: venda + cancelamento no mesmo batch) com falha simulada em um → estado não fica inconsistente.
  - Paginação do pull com inserções concorrentes intercaladas → nenhum evento "se perde" atrás do cursor (valida o tiebreaker `sequence`).
- **Migração:**
  - Fixtures dos buracos conhecidos (cancelamentos com DELETE físico passado) → script lida e passa.
  - Caso de divergência **não mapeada** proposital → script **aborta/alerta**, nunca mascara.

---

## 9. Backlog (fora do escopo desta primeira versão)

- Limite de tamanho da fila local / payload de `push` após período longo offline (irrelevante na escala de 3 usuários hoje, registrar pra quando crescer).
- Endurecimento do alerta `over-limit-balance` em fluxo de notificação push (esta versão só expõe o endpoint).

---

## 10. Próximo passo

Spec aprovada → invocar `writing-plans` para gerar o plano de implementação. **Não codar o backend antes da aprovação desta spec.**
