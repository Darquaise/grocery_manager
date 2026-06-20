export type TrackingType = 'status' | 'counter' | 'amount';
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

export interface Product {
  id: number;
  name: string;
  category_id: number | null;
  location: string | null;
  tracking_type: TrackingType;
  current_value: number;
  min_value: number | null;
  step: number | null;
  full_value: number | null;
  unit: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: number | null;
  deleted_at: string | null;
}

/** Fields sent when creating/updating a product. */
export interface ProductInput {
  name: string;
  category_id: number | null;
  location: string | null;
  tracking_type: TrackingType;
  current_value: number;
  min_value: number | null;
  step: number | null;
  full_value: number | null;
  unit: string | null;
  notes: string | null;
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
