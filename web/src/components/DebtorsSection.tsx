import { type DebtorsData } from '../api'

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function DebtorsSection({ data }: { data: DebtorsData }) {
  return (
    <div className="space-y-4">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 inline-block">
        <p className="text-xs text-red-500 uppercase tracking-wide">Total em aberto</p>
        <p className="text-2xl font-bold text-red-700">{fmt(data.total)}</p>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Saldo Devedor</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Limite</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Acima do Limite</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.debtors.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-400 py-8">Nenhum devedor</td></tr>
            )}
            {data.debtors.map(d => {
              const over = d.credit_limit > 0 && d.balance > d.credit_limit
              return (
                <tr key={d.id} className={`hover:bg-gray-50 ${over ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-right text-red-600 font-semibold">{fmt(d.balance)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {d.credit_limit > 0 ? fmt(d.credit_limit) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {over
                      ? <span className="text-red-600 font-semibold">⚠ {fmt(d.balance - d.credit_limit)}</span>
                      : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
