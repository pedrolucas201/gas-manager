import { useEffect, useState, useCallback } from 'react'
import { type User } from 'firebase/auth'
import { logout } from '../auth'
import {
  fetchSummary, fetchSales, fetchExpenses, fetchDebtors, fetchInventory,
  type SummaryData, type SalesData, type ExpensesData, type DebtorsData, type InventoryRow,
} from '../api'
import SummaryCards from '../components/SummaryCards'
import SalesSection from '../components/SalesSection'
import ExpensesSection from '../components/ExpensesSection'
import DebtorsSection from '../components/DebtorsSection'
import InventorySection from '../components/InventorySection'

interface Props { user: User }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function Dashboard({ user }: Props) {
  const [from, setFrom] = useState(firstOfMonthStr)
  const [to, setTo] = useState(todayStr)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [sales, setSales] = useState<SalesData | null>(null)
  const [expenses, setExpenses] = useState<ExpensesData | null>(null)
  const [debtors, setDebtors] = useState<DebtorsData | null>(null)
  const [inventory, setInventory] = useState<InventoryRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, sa, ex, de, inv] = await Promise.all([
        fetchSummary(from, to),
        fetchSales(from, to),
        fetchExpenses(from, to),
        fetchDebtors(),
        fetchInventory(),
      ])
      setSummary(s)
      setSales(sa)
      setExpenses(ex)
      setDebtors(de)
      setInventory(inv)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold">⛽ Beto Gás</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm text-gray-600">De</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border rounded px-2 py-1 text-sm" />
          <label className="text-sm text-gray-600">Até</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border rounded px-2 py-1 text-sm" />
          <button onClick={load}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">
            Atualizar
          </button>
          <span className="text-xs text-gray-400 ml-2">{user.email}</span>
          <button onClick={() => logout()}
            className="text-gray-400 hover:text-gray-600 text-sm">
            Sair
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        {loading && <p className="text-center text-gray-400">Carregando…</p>}
        {error && <p className="text-center text-red-500">{error}</p>}

        {summary && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Visão Geral</h2>
            <SummaryCards data={summary} />
          </section>
        )}

        {sales && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Vendas</h2>
            <SalesSection data={sales} />
          </section>
        )}

        {expenses && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Despesas</h2>
            <ExpensesSection data={expenses} />
          </section>
        )}

        {debtors && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Fiado</h2>
            <DebtorsSection data={debtors} />
          </section>
        )}

        {inventory && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Estoque</h2>
            <InventorySection data={inventory} />
          </section>
        )}
      </main>
    </div>
  )
}
