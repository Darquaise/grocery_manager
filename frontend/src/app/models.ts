export type TrackingType = 'status' | 'counter';
export type ExpiryMode = 'expiry' | 'purchaseDate' | 'none';
export type ShoppingSource = 'auto' | 'manual';
export type ShoppingState = 'open' | 'inCart';

export interface User {
  id: number;
  name: string;
  color: string;
}

export interface Category {
  id: number;
  name: string;
  sort_order: number;
  is_default: boolean;
}

export interface Location {
  id: number;
  name: string;
  sort_order: number;
  is_default: boolean;
}

/** One physical package of a product (the actual stock). */
export interface StockItem {
  id: number;
  product_id: number;
  expiry_date: string | null;
  purchase_date: string | null;
  status_level: number | null;  // status products: 0..4
  remaining: number | null;     // counter products: units left
  size: number | null;          // counter products: package's full size
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: number;
  name: string;
  category_id: number | null;
  location_id: number | null;
  package_size: number;
  can_expire: ExpiryMode;
  reorder_status_level: number | null;
  reorder_refill_count: number | null;
  reorder_total_units: number | null;
  notes: string | null;
  updated_at: string;
  updated_by: number | null;
  deleted_at: string | null;
  // Derived from the stock (oldest-first); recomputed client-side after
  // optimistic offline edits via `deriveProduct`.
  tracking_type: TrackingType;
  stock: StockItem[];
  total_units: number;
  current_level: number | null;
  refill_count: number | null;
  current_expiry_date: string | null;
  current_purchase_date: string | null;
  is_low: boolean;
}

/** Fields sent when creating/updating a product. */
export interface ProductInput {
  name: string;
  category_id: number | null;
  location_id: number | null;
  package_size: number;
  can_expire: ExpiryMode;
  reorder_status_level: number | null;
  reorder_refill_count: number | null;
  reorder_total_units: number | null;
  notes: string | null;
}

/** Fields sent when adding a stock package. */
export interface StockInput {
  expiry_date?: string | null;
  purchase_date?: string | null;
  status_level?: number | null;
  remaining?: number | null;
  size?: number | null;
}

/** One planned package recorded when checking off, materialised into stock on
 * trip completion. */
export interface PlanEntry {
  size?: number | null;
  expiry_date?: string | null;
}

export interface ShoppingItem {
  id: number;
  product_id: number | null;
  display_name: string;
  amount_text: string | null;
  source: ShoppingSource;
  added_by: number | null;
  state: ShoppingState;
  ignored_until_restock: boolean;
  purchase_plan: string | null;
}

export interface TripItem {
  display_name: string;
  amount_text: string | null;
  source: ShoppingSource;
  product_id: number | null;
  added_by: number | null;
}

export interface Trip {
  id: number;
  started_at: string;
  completed_at: string | null;
  completed_by: number | null;
  total_price: number | null;
  items: TripItem[];
}

/** Ordinal status levels (for `status`-tracked products), index = value 0..4. */
export const STATUS_LABELS = ['Leer', 'Knapp', 'Mittel', 'Fast voll', 'Voll'] as const;

/** Minimal shape shared by Category and Location (for the editable settings list). */
export interface ListItem {
  id: number;
  name: string;
  sort_order: number;
}

/** Contract the editable settings list drives — CategoriesService / LocationsService. */
export interface ListStore {
  list(): Promise<ListItem[]>;
  create(name: string, sortOrder?: number): Promise<unknown>;
  update(id: number, data: { name?: string; sort_order?: number }): Promise<unknown>;
  remove(id: number): Promise<void>;
}
