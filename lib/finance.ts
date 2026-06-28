// Caixa (regime de caixa) ≠ Faturamento (regime de competência).
//
// Faturamento conta a venda no MOMENTO da venda — inclui fiado, que é dinheiro
// ainda não recebido. Caixa conta só o dinheiro que de fato ENTROU no período:
// vendas à vista (dinheiro/PIX/cartão) + vales recebidos (quitação de fiado)
// − despesas. O fiado só entra no caixa quando vira um vale recebido.

export type SalePaymentRow = { payment_method: string; total_revenue: number };
export type AmountRow = { amount: number };

export interface CashFlow {
  aVista: number; // vendas em dinheiro + PIX + cartão
  vales: number; // vales recebidos (debt_settlements)
  despesas: number;
  caixa: number; // aVista + vales − despesas
}

// Formas de pagamento que entram no caixa na hora da venda. Fiado fica de fora
// (entra depois, como vale recebido).
const CASH_METHODS = new Set(["cash", "pix", "card"]);

export function computeCashFlow(
  saleRows: SalePaymentRow[],
  settlements: AmountRow[],
  expenses: AmountRow[]
): CashFlow {
  const aVista = saleRows
    .filter((r) => CASH_METHODS.has(r.payment_method))
    .reduce((acc, r) => acc + (r.total_revenue ?? 0), 0);
  const vales = settlements.reduce((acc, s) => acc + (s.amount ?? 0), 0);
  const despesas = expenses.reduce((acc, e) => acc + (e.amount ?? 0), 0);
  return { aVista, vales, despesas, caixa: aVista + vales - despesas };
}
