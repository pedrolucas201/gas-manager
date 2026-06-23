import type { SQLiteDatabase } from "expo-sqlite";
import {
  pushEvents,
  voidSale,
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
  type PendingEvent,
} from "@/lib/sync/outbox";
import { applyEvent } from "@/lib/sync/apply";
import { signOutUser } from "@/lib/auth";
import { useSyncStore } from "@/store/sync";

const FACT_KINDS = new Set([
  "sale",
  "restock",
  "stock_adjustment",
  "debt_settlement",
]);

async function applyEventSafe(db: SQLiteDatabase, e: unknown): Promise<void> {
  try {
    await applyEvent(db, e as Parameters<typeof applyEvent>[1]);
  } catch (err) {
    console.warn("[SyncEngine] applyEvent falhou:", err);
  }
}

export class SyncEngine {
  private _stopped = false;
  private _syncing = false;
  private _retryTimer?: ReturnType<typeof setTimeout>;
  private _pollTimer?: ReturnType<typeof setInterval>;
  private _unsubscribe?: () => void;

  constructor(private db: SQLiteDatabase) {}

  async pushOnce(): Promise<void> {
    const events = await pendingEvents(this.db);
    if (events.length === 0) return;

    const facts = events.filter((e) => FACT_KINDS.has(e.kind));
    const others = events.filter((e) => !FACT_KINDS.has(e.kind));

    if (facts.length > 0) {
      try {
        const payloads = facts.map((e) => JSON.parse(e.payload) as PushEvent);
        const results = await pushEvents(payloads);
        for (const r of results) {
          if (r.status === "applied" || r.status === "duplicate") {
            await markDone(this.db, r.id);
          } else {
            await markError(this.db, r.id, r.error ?? "server_error");
          }
        }
      } catch (e) {
        if (e instanceof AuthError) {
          await signOutUser();
          return;
        }
        if (e instanceof NetworkError) {
          return; // retry na próxima reconexão
        }
        throw e;
      }
    }

    for (const event of others) {
      try {
        await this._pushCatalogEvent(event);
        await markDone(this.db, event.event_uuid);
      } catch (e) {
        if (e instanceof AuthError) {
          await signOutUser();
          return;
        }
        if (e instanceof NetworkError) {
          return;
        }
        await markError(
          this.db,
          event.event_uuid,
          (e as Error).message ?? "unknown"
        );
      }
    }

    const count = await getOutboxCount(this.db);
    useSyncStore.getState().setPendingCount(count);
  }

  private async _pushCatalogEvent(event: PendingEvent): Promise<void> {
    const payload = JSON.parse(event.payload);
    switch (event.kind) {
      case "void_sale":
        await voidSale(payload.id);
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
    if (this._stopped || this._syncing) return;
    this._syncing = true;
    clearTimeout(this._retryTimer);
    useSyncStore.getState().setStatus("syncing");
    try {
      await this.pullAll();
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
        this._retryTimer = setTimeout(() => this.syncNow(), 30_000);
      }
    } finally {
      this._syncing = false;
    }
  }

  start(): void {
    this._stopped = false;
    this.syncNow();
    this._subscribeToNetwork();
    this._pollTimer = setInterval(() => this.syncNow(), 60_000);
  }

  stop(): void {
    this._stopped = true;
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
