import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { addExpense, getExpenses } from "@/db/queries/expenses";

async function freshDb() {
  const db = createTestDb();
  await initDatabase(db);
  return db;
}

describe("addExpense", () => {
  it("insere na tabela expenses e enfileira evento no outbox", async () => {
    const db = await freshDb();
    await addExpense(db, { category: "Gasolina", amount: 150 });

    const expense = await db.getFirstAsync<{ uuid: string; category: string; amount: number }>(
      `SELECT uuid, category, amount FROM expenses LIMIT 1`
    );
    expect(expense?.category).toBe("Gasolina");
    expect(expense?.amount).toBeCloseTo(150, 5);
    expect(expense?.uuid).toHaveLength(36);

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("expense");
    const p = JSON.parse(outbox!.payload);
    expect(p.expense.amount).toBe("150.00");
    expect(p.expense.category).toBe("Gasolina");
  });

  it("getExpenses retorna despesas do periodo", async () => {
    const db = await freshDb();
    await addExpense(db, { category: "Pneu", amount: 80 });

    // Range largo para cobrir qualquer timezone do ambiente de teste
    const rows = await getExpenses(db, "2020-01-01", "2099-12-31");
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("Pneu");
  });
});
