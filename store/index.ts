import { create } from "zustand";

interface AppStore {
  salesVersion: number;
  inventoryVersion: number;
  customersVersion: number;
  expensesVersion: number;
  bumpSales: () => void;
  bumpInventory: () => void;
  bumpCustomers: () => void;
  bumpExpenses: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  salesVersion: 0,
  inventoryVersion: 0,
  customersVersion: 0,
  expensesVersion: 0,
  bumpSales: () => set((s) => ({ salesVersion: s.salesVersion + 1 })),
  bumpInventory: () => set((s) => ({ inventoryVersion: s.inventoryVersion + 1 })),
  bumpCustomers: () => set((s) => ({ customersVersion: s.customersVersion + 1 })),
  bumpExpenses: () => set((s) => ({ expensesVersion: s.expensesVersion + 1 })),
}));
