import { SQLiteDatabase } from "expo-sqlite";
import { Sale, DashboardStats } from "@/types";

export async function registerSale(
  db: SQLiteDatabase,
  data: {
    customer_id: number | null;
    cylinder_type_id: number;
    quantity: number;
    unit_price: number;
    payment_method: string;
    is_exchange: boolean;
  }
) {
  const total = data.quantity * data.unit_price;

  await db.runAsync(
    `INSERT INTO sales (customer_id, cylinder_type_id, quantity, unit_price, total, payment_method, is_exchange)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.customer_id,
      data.cylinder_type_id,
      data.quantity,
      data.unit_price,
      total,
      data.payment_method,
      data.is_exchange ? 1 : 0,
    ]
  );

  // Decrease full stock
  await db.runAsync(
    `UPDATE inventory SET full_qty = MAX(0, full_qty - ?), empty_qty = empty_qty + ?
     WHERE cylinder_type_id = ?`,
    [data.quantity, data.is_exchange ? data.quantity : 0, data.cylinder_type_id]
  );

  // If fiado, update customer balance
  if (data.payment_method === "fiado" && data.customer_id) {
    await db.runAsync(
      `UPDATE customers SET balance = balance - ? WHERE id = ?`,
      [total, data.customer_id]
    );
  }
}

export async function getSales(db: SQLiteDatabase, limit = 50): Promise<Sale[]> {
  return await db.getAllAsync<Sale>(
    `SELECT s.*, c.name as customer_name, ct.name as cylinder_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     ORDER BY s.created_at DESC
     LIMIT ?`,
    [limit]
  );
}

export async function getTodaySales(db: SQLiteDatabase): Promise<Sale[]> {
  return await db.getAllAsync<Sale>(
    `SELECT s.*, c.name as customer_name, ct.name as cylinder_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE date(s.created_at) = date('now', 'localtime')
     ORDER BY s.created_at DESC`
  );
}

export async function getDashboardStats(db: SQLiteDatabase): Promise<DashboardStats> {
  const result = await db.getFirstAsync<DashboardStats>(`
    SELECT
      COALESCE(SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN total ELSE 0 END), 0) as today_revenue,
      COALESCE(SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN quantity ELSE 0 END), 0) as today_sales,
      COALESCE(SUM(CASE WHEN created_at >= date('now', 'localtime', '-6 days') THEN total ELSE 0 END), 0) as week_revenue,
      COALESCE(SUM(CASE WHEN created_at >= date('now', 'localtime', '-6 days') THEN quantity ELSE 0 END), 0) as week_sales,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') THEN total ELSE 0 END), 0) as month_revenue,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') THEN quantity ELSE 0 END), 0) as month_sales
    FROM sales
  `);

  return result ?? {
    today_revenue: 0, today_sales: 0,
    week_revenue: 0, week_sales: 0,
    month_revenue: 0, month_sales: 0,
  };
}

export async function getReportByPeriod(
  db: SQLiteDatabase,
  from: string,
  to: string
) {
  return await db.getAllAsync(
    `SELECT
       ct.name as cylinder_name,
       SUM(s.quantity) as total_qty,
       SUM(s.total) as total_revenue,
       SUM(s.quantity * ct.cost_price) as total_cost,
       SUM(s.total) - SUM(s.quantity * ct.cost_price) as total_profit,
       s.payment_method,
       COUNT(*) as num_sales
     FROM sales s
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE date(s.created_at) BETWEEN ? AND ?
     GROUP BY ct.id, s.payment_method
     ORDER BY total_revenue DESC`,
    [from, to]
  );
}

export async function deleteSale(db: SQLiteDatabase, id: number) {
  const sale = await db.getFirstAsync<Sale>(`SELECT * FROM sales WHERE id = ?`, [id]);
  if (!sale) return;

  await db.runAsync(
    `UPDATE inventory SET full_qty = full_qty + ?, empty_qty = MAX(0, empty_qty - ?)
     WHERE cylinder_type_id = ?`,
    [sale.quantity, sale.is_exchange ? sale.quantity : 0, sale.cylinder_type_id]
  );

  if (sale.payment_method === "fiado" && sale.customer_id) {
    await db.runAsync(
      `UPDATE customers SET balance = balance + ? WHERE id = ?`,
      [sale.total, sale.customer_id]
    );
  }

  await db.runAsync(`DELETE FROM sales WHERE id = ?`, [id]);
}
