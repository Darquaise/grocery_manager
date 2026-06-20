"""Auto shopping-list logic.

The active shopping list mixes three kinds of entries:
  * `auto`   — derived from a product dropping to/below its `min_value`.
  * `manual` — added by a user (may carry an amount/note + a colour).
  * free     — a `manual` item with no `product_id` (one-off, e.g. charcoal).

Auto entries are not created by hand; they are *reconciled* from product stock
levels after every change that can affect them. The snooze lifecycle
(`ignored_until_restock`) lets a user wipe an auto entry so it stays away until
the product is refilled above its min and drops below again.
"""

from sqlmodel import Session, select

from .models import Product, ShoppingListItem, ShoppingSource, ShoppingState


def is_below_threshold(product: Product) -> bool:
    """Whether the product is at/below its auto-list threshold.

    `min_value is None` means "never auto-list". The comparison is `<=` for all
    tracking types: for `status` the default threshold 1 ("knapp") therefore
    triggers as soon as the product *is* knapp, matching the product spec
    ("Schwelle = Knapp").
    """
    if product.min_value is None:
        return False
    return product.current_value <= product.min_value


def reconcile_auto_items(session: Session) -> None:
    """Sync the `auto` shopping entries with current product stock levels.

    For each non-deleted product at/below its min: ensure one *open* auto entry
    exists (unless one already does — which keeps a snooze intact while the
    product stays low). For each product above its min (or soft-deleted): drop
    its open auto entry, which also clears any snooze, so the next time it drops
    below it reappears fresh. `inCart` auto entries are left untouched (they are
    mid-purchase and handled at trip completion).

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

    for product in session.exec(select(Product)).all():
        existing = open_auto.get(product.id)
        if product.deleted_at is None and is_below_threshold(product):
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
