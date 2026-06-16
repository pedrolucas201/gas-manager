export type PaymentMethod = "cash" | "pix" | "card" | "fiado";

export interface CylinderType {
  id: number;
  name: string;
  weight_kg: number;
  sale_price: number;
  cost_price: number;
  active: number;
}

export interface Inventory {
  id: number;
  cylinder_type_id: number;
  full_qty: number;
  empty_qty: number;
  cylinder_name?: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  balance: number;
  created_at: string;
}

export interface Sale {
  id: number;
  customer_id: number | null;
  cylinder_type_id: number;
  quantity: number;
  unit_price: number;
  cost_price: number;
  total: number;
  payment_method: PaymentMethod;
  is_exchange: number;
  created_at: string;
  customer_name?: string;
  cylinder_name?: string;
}

export interface Restock {
  id: number;
  cylinder_type_id: number;
  quantity: number;
  cost_per_unit: number;
  total_cost: number;
  notes: string | null;
  created_at: string;
  cylinder_name?: string;
}

export interface DashboardStats {
  today_revenue: number;
  today_sales: number;
  week_revenue: number;
  week_sales: number;
  month_revenue: number;
  month_sales: number;
}
