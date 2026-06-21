"""Stock aggregation + auto shopping-list logic.

The active shopping list mixes three kinds of entries:
  * `auto`   — derived from a product dropping to/below its reorder threshold.
  * `manual` — added by a user (may carry an amount/note + a colour).
  * free     — a `manual` item with no `product_id` (one-off, e.g. charcoal).

Auto entries are not created by hand; they are *reconciled* from product stock
levels after every change that can affect them. The snooze lifecycle
(`ignored_until_restock`) lets a user wipe an auto entry so it stays away until
the product is refilled above its threshold and drops below again.
"""

from collections import defaultdict
from datetime import UTC, date

from sqlmodel import Session, select

from .models import (
    ExpiryMode,
    Product,
    ShoppingListItem,
    ShoppingSource,
    ShoppingState,
    StockItem,
)

# "Full" ordinal for status-tracked packages (0=empty … 4=full).
STATUS_FULL = 4


def is_status(product: Product) -> bool:
    """status-typed (single-package) vs counter-typed (multi-unit packages)."""
    return product.package_size <= 1


def _created_ts(item: StockItem) -> float:
    """Creation time as a POSIX timestamp; treats naive (SQLite-loaded) datetimes
    as UTC so freshly-added (tz-aware) and persisted rows sort together."""
    dt = item.created_at
    return (dt if dt.tzinfo else dt.replace(tzinfo=UTC)).timestamp()


def sort_stock(product: Product, stock: list[StockItem]) -> list[StockItem]:
    """Oldest/most-urgent package first — the "current" one. Sorted by expiry
    (expiry mode), purchase date (purchaseDate mode) or creation order."""
    if product.can_expire == ExpiryMode.expiry:
        return sorted(
            stock, key=lambda s: (s.expiry_date is None, s.expiry_date or date.max, _created_ts(s))
        )
    if product.can_expire == ExpiryMode.purchase_date:
        return sorted(
            stock,
            key=lambda s: (s.purchase_date is None, s.purchase_date or date.max, _created_ts(s)),
        )
    return sorted(stock, key=_created_ts)


def total_units(product: Product, stock: list[StockItem]) -> int:
    """status -> number of packages; counter -> sum of remaining units."""
    if is_status(product):
        return len(stock)
    return sum((s.remaining or 0) for s in stock)


def is_below_threshold(product: Product, stock: list[StockItem]) -> bool:
    """Whether the product is at/below its auto-list reorder threshold.

    A `None` threshold (for the relevant type) means "never auto-list".
    """
    ordered = sort_stock(product, stock)
    if is_status(product):
        if product.reorder_status_level is None:
            return False
        current_level = (ordered[0].status_level or 0) if ordered else 0
        refill_count = max(0, len(ordered) - 1)
        # The refill count is the primary criterion (too few spare packages →
        # reorder regardless of how full the open one is); the current level
        # only breaks ties at the same refill count.
        return (refill_count, current_level) <= (
            product.reorder_refill_count or 0,
            product.reorder_status_level,
        )
    if product.reorder_total_units is None:
        return False
    return total_units(product, ordered) <= product.reorder_total_units


def reconcile_auto_items(session: Session) -> None:
    """Sync the `auto` shopping entries with current product stock levels.

    For each non-deleted product at/below its threshold: ensure one *open* auto
    entry exists (unless one already does — which keeps a snooze intact while the
    product stays low). For each product above its threshold (or soft-deleted):
    drop its open auto entry, which also clears any snooze. `inCart` auto entries
    are left untouched (mid-purchase, handled at trip completion).

    The caller is responsible for committing.
    """
    open_auto: dict[int, ShoppingListItem] = {
        item.product_id: item
        for item in session.exec(
            select(ShoppingListItem).where(
                ShoppingListItem.source == ShoppingSource.auto,
                ShoppingListItem.state == ShoppingState.open,
            )
        ).all()
        if item.product_id is not None
    }

    stock_by_product: dict[int, list[StockItem]] = defaultdict(list)
    for item in session.exec(select(StockItem)).all():
        stock_by_product[item.product_id].append(item)

    for product in session.exec(select(Product)).all():
        existing = open_auto.get(product.id)
        stock = stock_by_product.get(product.id, [])
        if product.deleted_at is None and is_below_threshold(product, stock):
            if existing is None:
                session.add(
                    ShoppingListItem(
                        product_id=product.id,
                        display_name=product.name,
                        source=ShoppingSource.auto,
                        state=ShoppingState.open,
                    )
                )
            elif not existing.ignored_until_restock:
                # Keep the visible entry's name in sync with the product.
                existing.display_name = product.name
        elif existing is not None:
            session.delete(existing)

    session.flush()
