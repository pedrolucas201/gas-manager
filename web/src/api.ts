import { auth } from './auth'

const BASE = import.meta.env.VITE_BACKEND_URL as string

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  const url = new URL(BASE + path)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

export interface SummaryData {
  revenue: number
  profit: number
  expenses: number
  net_flow: number
}

export interface SalesDayRow {
  day: string
  total: number
  count: number
}

export interface SaleRow {
  id: string
  customer_name: string
  payment_method: string
  total: number
  client_created_at: string
}

export interface SalesData {
  by_day: SalesDayRow[]
  list: SaleRow[]
}

export interface ExpenseCategoryRow {
  category: string
  total: number
}

export interface ExpenseRow {
  id: string
  category: string
  description: string
  amount: number
  client_created_at: string
}

export interface ExpensesData {
  by_category: ExpenseCategoryRow[]
  list: ExpenseRow[]
}

export interface DebtorRow {
  id: string
  name: string
  balance: number
  credit_limit: number
}

export interface DebtorsData {
  total: number
  debtors: DebtorRow[]
}

export interface InventoryRow {
  name: string
  full_qty: number
  empty_qty: number
}

export function fetchSummary(from: string, to: string) {
  return get<SummaryData>('/reports/summary', { from, to })
}

export function fetchSales(from: string, to: string) {
  return get<SalesData>('/reports/sales', { from, to })
}

export function fetchExpenses(from: string, to: string) {
  return get<ExpensesData>('/reports/expenses', { from, to })
}

export function fetchDebtors() {
  return get<DebtorsData>('/reports/debtors')
}

export function fetchInventory() {
  return get<InventoryRow[]>('/inventory')
}
