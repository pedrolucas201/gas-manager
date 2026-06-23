import { type InventoryRow } from '../api'

export default function InventorySection({ data }: { data: InventoryRow[] }) {
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Cheios</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Vazios</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.length === 0 && (
            <tr><td colSpan={4} className="text-center text-gray-400 py-8">Sem dados de estoque</td></tr>
          )}
          {data.map(r => (
            <tr key={r.name} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium">{r.name}</td>
              <td className={`px-4 py-3 text-right font-semibold ${r.full_qty < 0 ? 'text-red-600' : 'text-green-700'}`}>
                {r.full_qty}
              </td>
              <td className="px-4 py-3 text-right">{r.empty_qty}</td>
              <td className="px-4 py-3 text-right text-gray-500">{r.full_qty + r.empty_qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
