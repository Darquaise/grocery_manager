import { Product, STATUS_LABELS, StockItem } from '../models';

export function statusLabel(value: number): string {
  return STATUS_LABELS[Math.max(0, Math.min(STATUS_LABELS.length - 1, Math.round(value)))];
}

// ── dates / age ───────────────────────────────────────────────────────────────

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysBetween(fromIso: string, to = new Date()): number {
  const from = new Date(fromIso);
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Days until an expiry date as a short German label, e.g. "in 3 Tagen", "heute",
 * "abgelaufen". */
export function expiryAgo(iso: string): string {
  const days = daysBetween(new Date().toISOString(), new Date(iso)); // positive = future
  if (days > 1) return `in ${days} Tagen`;
  if (days === 1) return 'morgen';
  if (days === 0) return 'heute';
  if (days === -1) return 'gestern abgelaufen';
  return `seit ${-days} Tagen abgelaufen`;
}

/** Age since a purchase date, e.g. "neu", "vor 3 Tagen". */
export function ageSince(iso: string): string {
  const days = daysBetween(iso);
  if (days <= 0) return 'neu';
  if (days === 1) return 'seit gestern';
  return `vor ${days} Tagen`;
}

/** The small expiry/age caption shown under a name (null = nothing to show). */
export function stockCaption(p: Pick<Product, 'can_expire' | 'current_expiry_date' | 'current_purchase_date'>): string | null {
  if (p.can_expire === 'expiry') return p.current_expiry_date ? expiryAgo(p.current_expiry_date) : null;
  if (p.can_expire === 'purchaseDate') return p.current_purchase_date ? ageSince(p.current_purchase_date) : null;
  return null;
}

/** Urgency of the current package's expiry, for colouring the caption. */
export function captionTone(
  p: Pick<Product, 'can_expire' | 'current_expiry_date'>,
): 'normal' | 'warn' | 'danger' {
  if (p.can_expire === 'expiry' && p.current_expiry_date) {
    const days = daysBetween(new Date().toISOString(), new Date(p.current_expiry_date));
    if (days < 0) return 'danger';
    if (days <= 2) return 'warn';
  }
  return 'normal';
}

export function stockItemCaption(
  p: Pick<Product, 'can_expire'>,
  s: Pick<StockItem, 'expiry_date' | 'purchase_date'>,
): string | null {
  if (p.can_expire === 'expiry') return s.expiry_date ? expiryAgo(s.expiry_date) : null;
  if (p.can_expire === 'purchaseDate') return s.purchase_date ? ageSince(s.purchase_date) : null;
  return null;
}

// ── client-side aggregation (mirrors the backend; for offline optimistic edits) ──

function dateCmp(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

/** Oldest/most-urgent package first — the "current" one. */
export function sortStock(p: Pick<Product, 'can_expire'>, stock: StockItem[]): StockItem[] {
  const copy = [...stock];
  if (p.can_expire === 'expiry') {
    return copy.sort((a, b) => dateCmp(a.expiry_date, b.expiry_date) || dateCmp(a.created_at, b.created_at));
  }
  if (p.can_expire === 'purchaseDate') {
    return copy.sort(
      (a, b) => dateCmp(a.purchase_date, b.purchase_date) || dateCmp(a.created_at, b.created_at),
    );
  }
  return copy.sort((a, b) => dateCmp(a.created_at, b.created_at));
}

/** Recompute the derived fields from `stock` (e.g. after an optimistic edit). */
export function deriveProduct(p: Product): Product {
  const stock = sortStock(p, p.stock ?? []);
  const isStatus = p.package_size <= 1;
  const current = stock[0] ?? null;
  const total_units = isStatus ? stock.length : stock.reduce((sum, s) => sum + (s.remaining ?? 0), 0);
  const current_level = isStatus ? (current?.status_level ?? 0) : null;
  const refill_count = isStatus ? Math.max(0, stock.length - 1) : null;

  let is_low: boolean;
  if (isStatus) {
    if (p.reorder_status_level == null) {
      is_low = false;
    } else {
      // Refill count dominates; the current level only breaks ties.
      const r = refill_count ?? 0;
      const threshold = p.reorder_refill_count ?? 0;
      is_low = r < threshold || (r === threshold && (current_level ?? 0) <= p.reorder_status_level);
    }
  } else {
    is_low = p.reorder_total_units != null && total_units <= p.reorder_total_units;
  }

  return {
    ...p,
    stock,
    tracking_type: isStatus ? 'status' : 'counter',
    total_units,
    current_level,
    refill_count,
    current_expiry_date: current?.expiry_date ?? null,
    current_purchase_date: current?.purchase_date ?? null,
    is_low,
  };
}
