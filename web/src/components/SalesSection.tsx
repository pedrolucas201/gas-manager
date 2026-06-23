import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { type SalesData } from '../api'

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const METHOD_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro', cash: 'Dinheiro', pix: 'PIX', fiado: 'Fiado', cartao: 'Cartão', card: 'Cartão',
}

export default function SalesSection({ data }: { data: SalesData }) {
  const chartData = data.by_day.map(r => ({ day: fmtDate(r.day), total: r.total }))

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold text-gray-600 mb-3">Receita por dia</p>
        {chartData.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">Sem vendas no período</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `R$${v}`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmt(Number(v))} />
              <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Pagamento</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.list.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-400 py-8">Sem vendas</td></tr>
            )}
            {data.list.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">{s.customer_name}</td>
                <td className="px-4 py-3">{METHOD_LABELS[s.payment_method] ?? s.payment_method}</td>
                <td className="px-4 py-3 text-right font-medium">{fmt(s.total)}</td>
                <td className="px-4 py-3 text-right text-gray-500">
                  {new Date(s.client_created_at).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
