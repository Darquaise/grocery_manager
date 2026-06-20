from datetime import UTC, date, datetime
from enum import Enum

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(UTC)


class TrackingType(str, Enum):
    status = "status"      # ordinal: empty=0, low=1, full=2
    counter = "counter"    # whole number
    amount = "amount"      # value + unit (g/ml/Stück)


class ShoppingSource(str, Enum):
    auto = "auto"          # from a product falling below its min
    manual = "manual"


class ShoppingState(str, Enum):
    open = "open"
    in_cart = "inCart"


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    color: str = "#3b82f6"
    password_hash: str
    created_at: datetime = Field(default_factory=_now)


class Category(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    sort_order: int = 0
    is_default: bool = False


class Product(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    category_id: int | None = Field(default=None, foreign_key="category.id")
    location: str | None = None

    tracking_type: TrackingType = TrackingType.status
    # Meaning depends on tracking_type:
    #   status  -> ordinal (0/1/2),  counter -> whole number,  amount -> value
    current_value: float = 0
    # Threshold for the auto shopping list. For `status` it's the ordinal level
    # (default 1 = "low").
    min_value: float | None = None
    # Step size for the +/- quick buttons (counter/amount).
    step: float | None = None
    # Optional "full" value for quick refill after a purchase.
    full_value: float | None = None
    unit: str | None = None            # only for `amount`
    notes: str | None = None
    expiry_date: date | None = None    # field reserved; feature comes later

    updated_at: datetime = Field(default_factory=_now)
    updated_by: int | None = Field(default=None, foreign_key="user.id")
    # Soft-delete: hidden but archive/list references stay intact.
    deleted_at: datetime | None = None


class ShoppingListItem(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    product_id: int | None = Field(default=None, foreign_key="product.id")
    display_name: str
    amount_text: str | None = None
    source: ShoppingSource = ShoppingSource.manual
    added_by: int | None = Field(default=None, foreign_key="user.id")
    state: ShoppingState = ShoppingState.open
    # Snooze: a dismissed auto-item only returns after the product is refilled
    # above its min and drops below again.
    ignored_until_restock: bool = False


class ShoppingTrip(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=_now)
    completed_at: datetime | None = None
    completed_by: int | None = Field(default=None, foreign_key="user.id")
    total_price: float | None = None
    # JSON snapshot of the purchased items (incl. name snapshots).
    items_json: str | None = None
