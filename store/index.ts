import { create } from "zustand";

interface AppStore {
  salesVersion: number;
  inventoryVersion: number;
  customersVersion: number;
  bumpSales: () => void;
  bumpInventory: () => void;
  bumpCustomers: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  salesVersion: 0,
  inventoryVersion: 0,
  customersVersion: 0,
  bumpSales: () => set((s) => ({ salesVersion: s.salesVersion + 1 })),
  bumpInventory: () => set((s) => ({ inventoryVersion: s.inventoryVersion + 1 })),
  bumpCustomers: () => set((s) => ({ customersVersion: s.customersVersion + 1 })),
}));
