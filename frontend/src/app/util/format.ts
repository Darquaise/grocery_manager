import { Product, STATUS_LABELS } from '../models';

/** A product is "low" once it reaches/falls below its min (the auto-list rule). */
export function isLow(p: Pick<Product, 'min_value' | 'current_value'>): boolean {
  return p.min_value != null && p.current_value <= p.min_value;
}

export function statusLabel(value: number): string {
  return STATUS_LABELS[Math.max(0, Math.min(2, Math.round(value)))];
}

/** Human-readable current stock, per tracking type. */
export function formatValue(p: Pick<Product, 'tracking_type' | 'current_value' | 'unit'>): string {
  switch (p.tracking_type) {
    case 'status':
      return statusLabel(p.current_value);
    case 'counter':
      return String(Math.round(p.current_value));
    case 'amount':
      return p.unit ? `${p.current_value} ${p.unit}` : String(p.current_value);
  }
}
