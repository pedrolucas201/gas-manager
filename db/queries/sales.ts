import { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { enqueue } from "@/lib/sync/outbox";
import { SERVER_P13_UUID } from "@/lib/sync/constants";
import { Sale, DashboardStats } from "@/types";

export async function registerSale(
  db: SQLiteDatabase,
  data: {
    customer_id: number | null;
    cylinder_type_id: number;
    quantity: number;
    unit_price: number;
    cost_price: number;
    payment_method: string;
    is_exchange: boolean;
  }
) {
  const total = data.quantity * data.unit_price;
  const uuid = randomUUID();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sales (uuid, customer_id, cylinder_type_id, quantity, unit_price, cost_price, total, payment_method, is_exchange, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid,
        data.customer_id,
        data.cylinder_type_id,
        data.quantity,
        data.unit_price,
        data.cost_price,
        total,
        data.payment_method,
        data.is_exchange ? 1 : 0,
        now,
      ]
    );

    // Sem clamp: o estoque acompanha o backend (que também não clampa). Negativo
    // = vendeu mais do que estava cadastrado — sinal real, não erro a esconder.
    // Clamp quebraria a convergência (MAX não é comutativo/associativo).
    await db.runAsync(
      `UPDATE inventory SET full_qty = full_qty - ?, empty_qty = empty_qty + ?
       WHERE cylinder_type_id = ?`,
      [data.quantity, data.is_exchange ? data.quantity : 0, data.cylinder_type_id]
    );

    if (data.payment_method === "fiado" && data.customer_id) {
      await db.runAsync(
        `UPDATE customers SET balance = balance - ? WHERE id = ?`,
        [total, data.customer_id]
      );
    }

    let customerUuid: string | null = null;
    if (data.customer_id) {
      const cr = await db.getFirstAsync<{ uuid: string }>(
        `SELECT uuid FROM customers WHERE id = ?`,
        [data.customer_id]
      );
      customerUuid = cr?.uuid ?? null;
    }

    await enqueue(db, {
      event_uuid: uuid,
      kind: "sale",
      payload: JSON.stringify({
        kind: "sale",
        id: uuid,
        client_created_at: now,
        sale: {
          cylinder_type_id: SERVER_P13_UUID,
          customer_id: customerUuid,
          quantity: data.quantity,
          unit_price: data.unit_price.toFixed(2),
          cost_price: data.cost_price.toFixed(2),
          total: total.toFixed(2),
          payment_method: data.payment_method,
          is_exchange: data.is_exchange,
        },
      }),
      client_created_at: now,
    });
  });
}

// voidSale substitui deleteSale: seta voided_at, reverte aggregados locais,
// enfileira void_sale no outbox. Sem DELETE físico (histórico preservado).
export async function voidSale(db: SQLiteDatabase, id: number) {
  const sale = await db.getFirstAsync<
    Sale & { uuid: string; voided_at: string | null }
  >(`SELECT * FROM sales WHERE id = ? AND voided_at IS NULL`, [id]);
  if (!sale) return; // já anulada ou não existe

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE sales SET voided_at = datetime('now') WHERE id = ?`,
      [id]
    );

    // Reverso simétrico ao registerSale (sem clamp, para paridade com o backend).
    await db.runAsync(
      `UPDATE inventory SET full_qty = full_qty + ?, empty_qty = empty_qty - ?
       WHERE cylinder_type_id = ?`,
      [sale.quantity, sale.is_exchange ? sale.quantity : 0, sale.cylinder_type_id]
    );

    if (sale.payment_method === "fiado" && sale.customer_id) {
      await db.runAsync(
        `UPDATE customers SET balance = balance + ? WHERE id = ?`,
        [sale.total, sale.customer_id]
      );
    }

    await enqueue(db, {
      event_uuid: randomUUID(),
      kind: "void_sale",
      payload: JSON.stringify({ id: sale.uuid }),
      client_created_at: new Date().toISOString(),
    });
  });
}

export async function getSaleById(
  db: SQLiteDatabase,
  id: number
): Promise<Sale | null> {
  return db.getFirstAsync<Sale>(
    `SELECT s.*, c.name as customer_name, ct.name as cylinder_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.id = ?`,
    [id]
  );
}

export async function getSales(db: SQLiteDatabase, limit = 50): Promise<Sale[]> {
  return db.getAllAsync<Sale>(
    `SELECT s.*, c.name as customer_name, ct.name as cylinder_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.voided_at IS NULL
     ORDER BY s.created_at DESC
     LIMIT ?`,
    [limit]
  );
}

export async function getTodaySales(db: SQLiteDatabase): Promise<Sale[]> {
  return db.getAllAsync<Sale>(
    `SELECT s.*, c.name as customer_name, ct.name as cylinder_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE date(s.created_at) = date('now', 'localtime') AND s.voided_at IS NULL
     ORDER BY s.created_at DESC`
  );
}

export async function getDashboardStats(
  db: SQLiteDatabase
): Promise<DashboardStats> {
  const result = await db.getFirstAsync<DashboardStats>(`
    SELECT
      COALESCE(SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN total ELSE 0 END), 0) as today_revenue,
      COALESCE(SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN quantity ELSE 0 END), 0) as today_sales,
      COALESCE(SUM(CASE WHEN created_at >= date('now', 'localtime', '-6 days') THEN total ELSE 0 END), 0) as week_revenue,
      COALESCE(SUM(CASE WHEN created_at >= date('now', 'localtime', '-6 days') THEN quantity ELSE 0 END), 0) as week_sales,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') THEN total ELSE 0 END), 0) as month_revenue,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') THEN quantity ELSE 0 END), 0) as month_sales
    FROM sales WHERE voided_at IS NULL
  `);

  return (
    result ?? {
      today_revenue: 0,
      today_sales: 0,
      week_revenue: 0,
      week_sales: 0,
      month_revenue: 0,
      month_sales: 0,
    }
  );
}

export async function getReportByPeriod(
  db: SQLiteDatabase,
  from: string,
  to: string
) {
  return db.getAllAsync(
    `SELECT
       ct.name as cylinder_name,
       SUM(s.quantity) as total_qty,
       SUM(s.total) as total_revenue,
       SUM(s.quantity * s.cost_price) as total_cost,
       SUM(s.total) - SUM(s.quantity * s.cost_price) as total_profit,
       s.payment_method,
       COUNT(*) as num_sales
     FROM sales s
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE date(s.created_at) BETWEEN ? AND ? AND s.voided_at IS NULL
     GROUP BY ct.id, s.payment_method
     ORDER BY total_revenue DESC`,
    [from, to]
  );
}

export async function getCustomerSales(db: SQLiteDatabase, customer_id: number) {
  return db.getAllAsync(
    `SELECT s.*, ct.name as cylinder_name
     FROM sales s
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.customer_id = ? AND s.voided_at IS NULL
     ORDER BY s.created_at DESC`,
    [customer_id]
  );
}
