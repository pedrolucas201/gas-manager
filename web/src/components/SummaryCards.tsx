import { type SummaryData } from '../api'

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function SummaryCards({ data }: { data: SummaryData }) {
  const cards = [
    { label: 'Receita', value: fmt(data.revenue), color: 'bg-blue-50 border-blue-200' },
    { label: 'Lucro Bruto', value: fmt(data.profit), color: 'bg-green-50 border-green-200' },
    { label: 'Despesas', value: fmt(data.expenses), color: 'bg-red-50 border-red-200' },
    {
      label: 'Fluxo Líquido',
      value: fmt(data.net_flow),
      color: data.net_flow >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200',
    },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className={`border rounded-xl p-4 ${c.color}`}>
          <p className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</p>
          <p className="text-xl font-bold mt-1">{c.value}</p>
        </div>
      ))}
    </div>
  )
}
