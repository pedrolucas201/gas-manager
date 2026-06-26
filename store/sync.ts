import { create } from "zustand";

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

interface SyncStore {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt: string | null;
  online: boolean;
  voidConfirmNeeded: number; // >0 = N cancelamentos aguardando confirmação manual
  setStatus: (s: SyncStatus) => void;
  setPendingCount: (n: number) => void;
  setLastSyncedAt: (t: string) => void;
  setOnline: (v: boolean) => void;
  setVoidConfirmNeeded: (n: number) => void;
}

export const useSyncStore = create<SyncStore>((set) => ({
  status: "idle",
  pendingCount: 0,
  lastSyncedAt: null,
  online: true,
  voidConfirmNeeded: 0,
  setStatus: (status) => set({ status }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
  setOnline: (online) => set({ online }),
  setVoidConfirmNeeded: (voidConfirmNeeded) => set({ voidConfirmNeeded }),
}));
