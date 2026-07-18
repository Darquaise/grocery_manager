from datetime import UTC, date, datetime
from enum import Enum

from sqlmodel import Field, SQLModel, UniqueConstraint


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
    auto = "auto"  # from a product falling below its reorder threshold
    manual = "manual"


class ShoppingState(str, Enum):
    open = "open"
    in_cart = "inCart"


class KitchenRole(str, Enum):
    """What a member may do in a kitchen (each level includes the previous).

    * `read`  — view inventory, shopping list and archive.
    * `write` — additionally change any domain data (stock, list, products,
                categories, locations, complete trips).
    * `admin` — additionally rename the kitchen and manage members. The owner
                (`Kitchen.owner_id`) is always treated as an admin and can also
                transfer ownership.
    """

    read = "read"
    write = "write"
    admin = "admin"


class User(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    color: str = "#3b82f6"
    # UI language (BCP-47-ish short code, e.g. "en" / "de"). None until the user
    # has logged in once and their current selection was persisted.
    language: str | None = None
    password_hash: str
    created_at: datetime = Field(default_factory=_now)


class Kitchen(SQLModel, table=True):
    """One household. All domain data (products, stock, shopping, categories,
    locations, trips) belongs to exactly one kitchen."""

    id: int | None = Field(default=None, primary_key=True)
    name: str
    owner_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=_now)


class KitchenMember(SQLModel, table=True):
    """A user's membership in a kitchen (the owner has a row too)."""

    __table_args__ = (UniqueConstraint("kitchen_id", "user_id"),)

    id: int | None = Field(default=None, primary_key=True)
    kitchen_id: int = Field(foreign_key="kitchen.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    role: KitchenRole = KitchenRole.write
    created_at: datetime = Field(default_factory=_now)


class KitchenInvite(SQLModel, table=True):
    """A pending invitation of a user into a kitchen. Membership only starts
    once the invitee accepts (via the join dialog); declining deletes it."""

    __table_args__ = (UniqueConstraint("kitchen_id", "user_id"),)

    id: int | None = Field(default=None, primary_key=True)
    kitchen_id: int = Field(foreign_key="kitchen.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    role: KitchenRole = KitchenRole.write
    invited_by: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=_now)


class AccountInvite(SQLModel, table=True):
    """Single-use registration code. Any existing user can create one; a new
    account can only be registered with an unused code. Admins may attach one
    of their kitchens — registering with such a code creates a pending
    `KitchenInvite` for the new account."""

    id: int | None = Field(default=None, primary_key=True)
    code: str = Field(index=True, unique=True)
    created_by: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=_now)
    used_by: int | None = Field(default=None, foreign_key="user.id")
    used_at: datetime | None = None
    kitchen_id: int | None = Field(default=None, foreign_key="kitchen.id")
    kitchen_role: KitchenRole | None = None


class Category(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    kitchen_id: int = Field(foreign_key="kitchen.id", index=True)
    name: str = Field(index=True)
    sort_order: int = 0
    is_default: bool = False


class Location(SQLModel, table=True):
    """A managed storage location (Kühlschrank, Vorratsschrank, …). Like
    categories: editable list with a sort order, used to group/filter products."""

    id: int | None = Field(default=None, primary_key=True)
    kitchen_id: int = Field(foreign_key="kitchen.id", index=True)
    name: str = Field(index=True)
    sort_order: int = 0
    is_default: bool = False


class Product(SQLModel, table=True):
    """The product *definition*. The actual stock lives in `StockItem` rows so a
    product can hold several packages with different expiry dates."""

    id: int | None = Field(default=None, primary_key=True)
    kitchen_id: int = Field(foreign_key="kitchen.id", index=True)
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
    """One physical package of a product.

    Exactly one package per product is the "current" one — the package in use,
    marked by `current_since`. It keeps that role until it is used up; packages
    added later queue up behind it even if they expire sooner. The refill queue
    itself is ordered most-urgent-first (by expiry, purchase date, or creation),
    so the next package to become current is the one that expires first.
    """

    id: int | None = Field(default=None, primary_key=True)
    product_id: int = Field(foreign_key="product.id", index=True)

    expiry_date: date | None = None  # can_expire == expiry
    purchase_date: date | None = None  # can_expire == purchaseDate

    # Set on the package currently in use; None on every queued refill. A
    # product whose packages are all None has not been designated yet and falls
    # back to pure most-urgent-first ordering.
    current_since: datetime | None = None

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
    kitchen_id: int = Field(foreign_key="kitchen.id", index=True)
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
    kitchen_id: int = Field(foreign_key="kitchen.id", index=True)
    started_at: datetime = Field(default_factory=_now)
    completed_at: datetime | None = None
    completed_by: int | None = Field(default=None, foreign_key="user.id")
    total_price: float | None = None
    # JSON snapshot of the purchased items (incl. name snapshots).
    items_json: str | None = None
