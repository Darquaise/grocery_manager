from datetime import UTC, date, datetime
from enum import Enum

from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(UTC)


class ExpiryMode(str, Enum):
    """Whether/how a product's stock ages.

    * `expiry`       — an expiry date is given per package at purchase.
    * `purchaseDate` — the purchase date is recorded and shown as a rising age.
    * `none`         — never expires; no date UI at all.
    """

    expiry = "expiry"
    purchase_date = "purchaseDate"
    none = "none"


class ShoppingSource(str, Enum):
    auto = "auto"          # from a product falling below its reorder threshold
    manual = "manual"


class ShoppingState(str, Enum):
    open = "open"
    in_cart = "inCart"


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    color: str = "#3b82f6"
    # UI language (BCP-47-ish short code, e.g. "en" / "de"). None until the user
    # has logged in once and their current selection was persisted.
    language: str | None = None
    password_hash: str
    created_at: datetime = Field(default_factory=_now)


class Category(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    sort_order: int = 0
    is_default: bool = False


class Location(SQLModel, table=True):
    """A managed storage location (Kühlschrank, Vorratsschrank, …). Like
    categories: editable list with a sort order, used to group/filter products."""

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    sort_order: int = 0
    is_default: bool = False


class Product(SQLModel, table=True):
    """The product *definition*. The actual stock lives in `StockItem` rows so a
    product can hold several packages with different expiry dates."""

    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    category_id: int | None = Field(default=None, foreign_key="category.id")
    location_id: int | None = Field(default=None, foreign_key="location.id")

    # Default units per package. Derives the type: 1 => "status", >1 => "counter".
    # The default is only a suggestion; each purchased package may override it.
    package_size: int = 1
    can_expire: ExpiryMode = ExpiryMode.none

    # Auto shopping-list threshold. Semantics depend on the derived type:
    #   status  -> on the list when the current package's level <=
    #              `reorder_status_level` AND refill-package count <=
    #              `reorder_refill_count`. None level = never auto-list.
    #   counter -> on the list when total units <= `reorder_total_units`.
    #              None = never auto-list.
    reorder_status_level: int | None = None
    reorder_refill_count: int | None = None
    reorder_total_units: int | None = None

    notes: str | None = None

    updated_at: datetime = Field(default_factory=_now)
    updated_by: int | None = Field(default=None, foreign_key="user.id")
    # Soft-delete: hidden but archive/list references stay intact.
    deleted_at: datetime | None = None


class StockItem(SQLModel, table=True):
    """One physical package of a product. Sorted oldest-first (by expiry,
    purchase date, or creation) so the most-urgent package is "current"."""

    id: int | None = Field(default=None, primary_key=True)
    product_id: int = Field(foreign_key="product.id", index=True)

    expiry_date: date | None = None       # can_expire == expiry
    purchase_date: date | None = None     # can_expire == purchaseDate

    # status products: this package's fill level 0..4 (refills are 4 = full).
    status_level: int | None = None
    # counter products: units left in this package + the package's full size.
    remaining: int | None = None
    size: int | None = None

    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
    updated_by: int | None = Field(default=None, foreign_key="user.id")


class ShoppingListItem(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    product_id: int | None = Field(default=None, foreign_key="product.id")
    display_name: str
    amount_text: str | None = None
    source: ShoppingSource = ShoppingSource.manual
    added_by: int | None = Field(default=None, foreign_key="user.id")
    state: ShoppingState = ShoppingState.open
    # Snooze: a dismissed auto-item only returns after the product is refilled
    # above its threshold and drops below again.
    ignored_until_restock: bool = False
    # JSON list of planned packages set when checking off, materialised into
    # StockItems on trip completion: [{"size": int|null, "expiry_date": str|null}].
    purchase_plan: str | None = None


class ShoppingTrip(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    started_at: datetime = Field(default_factory=_now)
    completed_at: datetime | None = None
    completed_by: int | None = Field(default=None, foreign_key="user.id")
    total_price: float | None = None
    # JSON snapshot of the purchased items (incl. name snapshots).
    items_json: str | None = None
