import type { SQLiteDatabase } from "expo-sqlite";
import {
  pushEvents,
  voidSale,
  unvoidSale,
  upsertCustomer,
  deleteCustomer,
  upsertCylinderType,
  pullPage,
  AuthError,
  NetworkError,
  type PushEvent,
} from "@/lib/api";
import {
  pendingEvents,
  markDone,
  markError,
  pendingCount as getOutboxCount,
  setEnqueueHook,
  type PendingEvent,
} from "@/lib/sync/outbox";
import { applyEvent } from "@/lib/sync/apply";
import { compensateError } from "@/lib/sync/compensate";
import { VOID_CONFIRM_THRESHOLD } from "@/lib/sync/constants";
import { signOutUser } from "@/lib/auth";
import { useSyncStore } from "@/store/sync";
import { useAppStore } from "@/store";

const FACT_KINDS = new Set([
  "sale",
  "restock",
  "stock_adjustment",
  "stock_set",
  "debt_settlement",
  "expense",
]);

// Catalog kinds must be pushed BEFORE facts: a fiado sale references a customer
// via FK on the server, so the customer must exist before the sale arrives.
const CATALOG_KINDS = new Set([
  "customer_upsert",
  "customer_delete",
  "cylinder_upsert",
]);

async function applyEventSafe(db: SQLiteDatabase, e: unknown): Promise<void> {
  try {
    await applyEvent(db, e as Parameters<typeof applyEvent>[1]);
  } catch (err) {
    console.warn("[SyncEngine] applyEvent falhou:", err);
  }
}

// Instância ativa do engine, registrada em start()/stop(). Permite que as telas
// disparem um sync manual (pull-to-refresh) sem precisar passar o engine via
// props/context — ele vive no AuthGate (_layout.tsx).
let activeEngine: SyncEngine | null = null;

/** Retorna o engine ativo (ou null se o usuário não está logado). */
export function getSyncEngine(): SyncEngine | null {
  return activeEngine;
}

/** Dispara um sync manual se houver engine ativo. Seguro de chamar sempre. */
export async function triggerManualSync(): Promise<void> {
  await activeEngine?.syncNow();
}

/** Confirma o envio do lote de cancelamentos pendentes (disjuntor). */
export async function approveVoidBatch(): Promise<void> {
  await activeEngine?.approveVoidBatch();
}

export class SyncEngine {
  private _stopped = false;
  private _syncPromise: Promise<void> | null = null;
  private _retryTimer?: ReturnType<typeof setTimeout>;
  private _pollTimer?: ReturnType<typeof setInterval>;
  private _unsubscribe?: () => void;
  private _voidBatchApproved = false;

  constructor(private db: SQLiteDatabase) {}

  async pushOnce(): Promise<void> {
    const events = await pendingEvents(this.db);
    if (events.length === 0) return;

    // Order matters: catalog (customer/cylinder) → facts (sale/restock/...) →
    // voids. The customer must exist on the server before a fiado sale (FK), and
    // a void must arrive after the sale it cancels.
    const catalog = events.filter((e) => CATALOG_KINDS.has(e.kind));
    const facts = events.filter((e) => FACT_KINDS.has(e.kind));
    const voids = events.filter((e) => e.kind === "void_sale");
    const unvoids = events.filter((e) => e.kind === "unvoid_sale");

    // 1. Catalog first.
    if (await this._pushIndividual(catalog)) return;
    // 2. Facts in a single batch.
    if (await this._pushFacts(facts)) return;

    // 3. Voids: disjuntor contra cancelamento em massa. Se há muitos voids
    // pendentes e o usuário ainda não confirmou este lote, pausa o envio de
    // voids/unvoids e sinaliza a UI. Catálogo e fatos já foram enviados.
    if (voids.length >= VOID_CONFIRM_THRESHOLD && !this._voidBatchApproved) {
      useSyncStore.getState().setVoidConfirmNeeded(voids.length);
      return;
    }
    if (await this._pushIndividual(voids)) return;
    // Lote de voids enviado (ou abaixo do limite): limpa o gate.
    this._voidBatchApproved = false;
    useSyncStore.getState().setVoidConfirmNeeded(0);

    // 4. Unvoids depois dos voids (ordem causal consistente).
    if (await this._pushIndividual(unvoids)) return;

    const count = await getOutboxCount(this.db);
    useSyncStore.getState().setPendingCount(count);
  }

  /**
   * Usuário confirmou o envio do lote de cancelamentos pendentes (disjuntor).
   * Libera o gate e dispara um novo sync que agora enviará os voids.
   */
  async approveVoidBatch(): Promise<void> {
    this._voidBatchApproved = true;
    useSyncStore.getState().setVoidConfirmNeeded(0);
    await this.syncNow();
  }

  // _pushFacts sends fact events in one batch. Returns true if the caller should
  // abort the rest of the push (auth/network failure).
  private async _pushFacts(facts: PendingEvent[]): Promise<boolean> {
    if (facts.length === 0) return false;
    try {
      const payloads = facts.map((e) => JSON.parse(e.payload) as PushEvent);
      const results = await pushEvents(payloads);
      for (const r of results) {
        if (r.status === "applied" || r.status === "duplicate") {
          await markDone(this.db, r.id);
        } else {
          await markError(this.db, r.id, r.error ?? "server_error");
          const failed = facts.find((e) => e.event_uuid === r.id);
          if (failed) {
            await compensateError(this.db, failed);
            const { bumpSales, bumpInventory, bumpCustomers, bumpExpenses } =
              useAppStore.getState();
            bumpSales(); bumpInventory(); bumpCustomers(); bumpExpenses();
          }
        }
      }
    } catch (e) {
      if (e instanceof AuthError) {
        await signOutUser();
        return true;
      }
      if (e instanceof NetworkError) {
        return true; // retry na próxima reconexão
      }
      throw e;
    }
    return false;
  }

  // _pushIndividual sends catalog/void events one by one through their own
  // endpoints. Returns true if the caller should abort (auth/network failure).
  private async _pushIndividual(list: PendingEvent[]): Promise<boolean> {
    for (const event of list) {
      try {
        await this._pushCatalogEvent(event);
        await markDone(this.db, event.event_uuid);
      } catch (e) {
        if (e instanceof AuthError) {
          await signOutUser();
          return true;
        }
        if (e instanceof NetworkError) {
          return true;
        }
        await markError(
          this.db,
          event.event_uuid,
          (e as Error).message ?? "unknown"
        );
      }
    }
    return false;
  }

  private async _pushCatalogEvent(event: PendingEvent): Promise<void> {
    const payload = JSON.parse(event.payload);
    switch (event.kind) {
      case "void_sale":
        await voidSale(payload.id);
        break;
      case "unvoid_sale":
        await unvoidSale(payload.id);
        break;
      case "customer_upsert":
        await upsertCustomer(payload);
        break;
      case "customer_delete":
        await deleteCustomer(payload.id);
        break;
      case "cylinder_upsert":
        await upsertCylinderType(payload.id, payload);
        break;
    }
  }

  async pullAll(): Promise<void> {
    const state = await this.db.getFirstAsync<{ pull_cursor: string }>(
      `SELECT pull_cursor FROM sync_state WHERE id = 1`
    );
    let cursor = state?.pull_cursor ?? "";

    let hasMore = true;
    while (hasMore) {
      const page = await pullPage(cursor, 200);

      // Duas passadas: fatos primeiro, void/catálogo depois.
      // Garante que a venda existe localmente antes de tentar anulá-la
      // no mesmo page — evita forward-reference quando void.id < sale.sequence
      // (BIGSERIALs independentes entre tabelas).
      const pageEvents = page.events ?? [];
      const facts = pageEvents.filter((e) => FACT_KINDS.has(e.kind));
      const rest = pageEvents.filter((e) => !FACT_KINDS.has(e.kind));

      await this.db.withTransactionAsync(async () => {
        for (const e of facts) await applyEventSafe(this.db, e);
        for (const e of rest) await applyEventSafe(this.db, e);
        await this.db.runAsync(
          `UPDATE sync_state SET pull_cursor = ?, last_synced_at = datetime('now') WHERE id = 1`,
          [page.next_cursor]
        );
      });

      cursor = page.next_cursor;
      hasMore = page.has_more;
    }

    useSyncStore.getState().setLastSyncedAt(new Date().toISOString());
  }

  async syncNow(): Promise<void> {
    if (this._stopped) return;
    // Se já há um sync em curso, aguarda ele terminar em vez de retornar imediatamente.
    // Isso garante que onRefresh sempre espera dados frescos antes de chamar load().
    if (this._syncPromise) return this._syncPromise;

    clearTimeout(this._retryTimer);
    useSyncStore.getState().setStatus("syncing");

    this._syncPromise = (async () => {
      try {
        await this.pullAll();
        // Notifica todas as telas para recarregar após receber eventos do servidor.
        const { bumpSales, bumpInventory, bumpCustomers, bumpExpenses } =
          useAppStore.getState();
        bumpSales();
        bumpInventory();
        bumpCustomers();
        bumpExpenses();
        await this.pushOnce();
        useSyncStore.getState().setStatus("idle");
      } catch (e) {
        if (e instanceof AuthError) {
          await signOutUser();
          return;
        }
        if (!(e instanceof NetworkError)) {
          console.warn("[SyncEngine] syncNow erro:", e);
        }
        useSyncStore.getState().setStatus("error");
        if (!this._stopped) {
          this._retryTimer = setTimeout(() => this.syncNow(), 10_000);
        }
      } finally {
        this._syncPromise = null;
      }
    })();

    return this._syncPromise;
  }

  start(): void {
    this._stopped = false;
    activeEngine = this;
    setEnqueueHook(() => this.syncNow());
    this.syncNow();
    this._subscribeToNetwork();
    this._pollTimer = setInterval(() => this.syncNow(), 10_000);
  }

  stop(): void {
    this._stopped = true;
    if (activeEngine === this) activeEngine = null;
    setEnqueueHook(null);
    clearTimeout(this._retryTimer);
    this._retryTimer = undefined;
    clearInterval(this._pollTimer);
    this._pollTimer = undefined;
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  private _subscribeToNetwork(): void {
    // Tenta usar @react-native-community/netinfo se disponível.
    // Se não estiver instalado, silencia o erro e o sync só roda no start().
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const NetInfo = require("@react-native-community/netinfo").default;
      this._unsubscribe = NetInfo.addEventListener(
        (state: { isConnected: boolean | null }) => {
          if (state.isConnected && !this._stopped) {
            useSyncStore.getState().setOnline(true);
            this.syncNow();
          } else if (!state.isConnected) {
            useSyncStore.getState().setOnline(false);
            useSyncStore.getState().setStatus("offline");
          }
        }
      );
    } catch {
      // NetInfo não instalado — sync só manual/no start.
    }
  }
}
