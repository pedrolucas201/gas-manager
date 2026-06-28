import { computeCashFlow } from "@/lib/finance";

describe("computeCashFlow", () => {
  it("soma vendas à vista + vales − despesas, ignorando fiado", () => {
    const rows = [
      { payment_method: "cash", total_revenue: 100 },
      { payment_method: "pix", total_revenue: 50 },
      { payment_method: "card", total_revenue: 30 },
      { payment_method: "fiado", total_revenue: 200 }, // não entra no caixa
    ];
    const settlements = [{ amount: 40 }, { amount: 60 }];
    const expenses = [{ amount: 25 }];

    const cf = computeCashFlow(rows, settlements, expenses);

    expect(cf.aVista).toBeCloseTo(180, 5);
    expect(cf.vales).toBeCloseTo(100, 5);
    expect(cf.despesas).toBeCloseTo(25, 5);
    expect(cf.caixa).toBeCloseTo(255, 5);
  });

  it("caixa negativo quando despesas superam as entradas", () => {
    const cf = computeCashFlow(
      [{ payment_method: "cash", total_revenue: 10 }],
      [],
      [{ amount: 50 }]
    );
    expect(cf.caixa).toBeCloseTo(-40, 5);
  });

  it("período só com fiado → caixa vem só dos vales recebidos", () => {
    const cf = computeCashFlow(
      [{ payment_method: "fiado", total_revenue: 300 }],
      [{ amount: 120 }],
      []
    );
    expect(cf.aVista).toBe(0);
    expect(cf.caixa).toBeCloseTo(120, 5);
  });

  it("soma múltiplas linhas da mesma forma de pagamento (agrupado por botijão)", () => {
    const cf = computeCashFlow(
      [
        { payment_method: "cash", total_revenue: 100 },
        { payment_method: "cash", total_revenue: 70 },
      ],
      [],
      []
    );
    expect(cf.aVista).toBeCloseTo(170, 5);
  });

  it("entradas vazias → tudo zero", () => {
    expect(computeCashFlow([], [], [])).toEqual({
      aVista: 0,
      vales: 0,
      despesas: 0,
      caixa: 0,
    });
  });
});
