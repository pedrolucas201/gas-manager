import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { type ExpensesData } from '../api'

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6']

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function ExpensesSection({ data }: { data: ExpensesData }) {
  const pieData = data.by_category.map(r => ({ name: r.category, value: r.total }))

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold text-gray-600 mb-3">Por categoria</p>
        {pieData.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">Sem despesas no período</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={(props: { name?: string; percent?: number }) =>
                  `${props.name ?? ''} ${((props.percent ?? 0) * 100).toFixed(0)}%`
                }
              >
                {pieData.map((_entry, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Categoria</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Descrição</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Valor</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.list.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-400 py-8">Sem despesas</td></tr>
            )}
            {data.list.map(e => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">{e.category}</td>
                <td className="px-4 py-3 text-gray-500">{e.description || '—'}</td>
                <td className="px-4 py-3 text-right font-medium text-red-600">{fmt(e.amount)}</td>
                <td className="px-4 py-3 text-right text-gray-500">
                  {new Date(e.client_created_at).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
