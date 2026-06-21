from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import ExpiryMode, Product, StockItem, User
from ..shopping_logic import (
    STATUS_FULL,
    is_below_threshold,
    is_status,
    reconcile_auto_items,
    sort_stock,
    total_units,
)
from .deps import current_user

router = APIRouter(prefix="/products", tags=["products"], dependencies=[Depends(current_user)])


# ── Schemas ─────────────────────────────────────────────────────────────────


class ProductIn(BaseModel):
    name: str
    category_id: int | None = None
    location_id: int | None = None
    package_size: int = 1
    can_expire: ExpiryMode = ExpiryMode.none
    reorder_status_level: int | None = None
    reorder_refill_count: int | None = None
    reorder_total_units: int | None = None
    notes: str | None = None


class ProductUpdate(BaseModel):
    """All fields optional — only the provided ones are changed (PATCH)."""

    name: str | None = None
    category_id: int | None = None
    location_id: int | None = None
    package_size: int | None = None
    can_expire: ExpiryMode | None = None
    reorder_status_level: int | None = None
    reorder_refill_count: int | None = None
    reorder_total_units: int | None = None
    notes: str | None = None


class StockItemOut(BaseModel):
    id: int
    product_id: int
    expiry_date: date | None
    purchase_date: date | None
    status_level: int | None
    remaining: int | None
    size: int | None
    created_at: datetime
    updated_at: datetime


class ProductOut(BaseModel):
    id: int
    name: str
    category_id: int | None
    location_id: int | None
    package_size: int
    can_expire: ExpiryMode
    reorder_status_level: int | None
    reorder_refill_count: int | None
    reorder_total_units: int | None
    notes: str | None
    updated_at: datetime
    updated_by: int | None
    deleted_at: datetime | None
    # Derived from the stock (oldest-first):
    tracking_type: str                  # "status" | "counter"
    stock: list[StockItemOut]
    total_units: int                    # status: package count, counter: Σ remaining
    current_level: int | None           # status only: oldest package's level
    refill_count: int | None            # status only: packages behind the current
    current_expiry_date: date | None    # the current (oldest) package's expiry
    current_purchase_date: date | None  # the current (oldest) package's purchase date
    is_low: bool


class StockIn(BaseModel):
    """Add one package. Defaults fill in from the product type."""

    expiry_date: date | None = None
    purchase_date: date | None = None
    status_level: int | None = None   # status; default full
    remaining: int | None = None      # counter; default = size
    size: int | None = None           # counter; default = product.package_size


class StockAdjust(BaseModel):
    status_level: int | None = None   # status: set the current package's level
    remaining: int | None = None      # counter: set the package's remaining units
    # Optimistic concurrency: the `updated_at` the client last saw.
    expected_updated_at: datetime | None = None


# ── Helpers ─────────────────────────────────────────────────────────────────


def _touch(product: Product, user: User) -> None:
    product.updated_at = datetime.now(UTC)
    product.updated_by = user.id


def _get_active(session: Session, product_id: int) -> Product:
    product = session.get(Product, product_id)
    if not product or product.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")
    return product


def _stock_of(session: Session, product_id: int) -> list[StockItem]:
    return session.exec(select(StockItem).where(StockItem.product_id == product_id)).all()


def _product_out(product: Product, stock: list[StockItem]) -> ProductOut:
    ordered = sort_stock(product, stock)
    current = ordered[0] if ordered else None
    status_typed = is_status(product)
    return ProductOut(
        id=product.id,
        name=product.name,
        category_id=product.category_id,
        location_id=product.location_id,
        package_size=product.package_size,
        can_expire=product.can_expire,
        reorder_status_level=product.reorder_status_level,
        reorder_refill_count=product.reorder_refill_count,
        reorder_total_units=product.reorder_total_units,
        notes=product.notes,
        updated_at=product.updated_at,
        updated_by=product.updated_by,
        deleted_at=product.deleted_at,
        tracking_type="status" if status_typed else "counter",
        stock=[StockItemOut(**s.model_dump()) for s in ordered],
        total_units=total_units(product, ordered),
        current_level=((current.status_level or 0) if current else 0) if status_typed else None,
        refill_count=max(0, len(ordered) - 1) if status_typed else None,
        current_expiry_date=current.expiry_date if current else None,
        current_purchase_date=current.purchase_date if current else None,
        is_low=is_below_threshold(product, ordered),
    )


# ── Product CRUD ────────────────────────────────────────────────────────────


@router.get("", response_model=list[ProductOut])
def list_products(
    include_deleted: bool = Query(False),
    session: Session = Depends(get_session),
):
    query = select(Product).order_by(Product.name)
    if not include_deleted:
        query = query.where(Product.deleted_at.is_(None))
    products = session.exec(query).all()

    by_product: dict[int, list[StockItem]] = {}
    for item in session.exec(select(StockItem)).all():
        by_product.setdefault(item.product_id, []).append(item)
    return [_product_out(p, by_product.get(p.id, [])) for p in products]


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    data: ProductIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    product = Product(**data.model_dump(), updated_by=user.id)
    session.add(product)
    session.flush()
    reconcile_auto_items(session)  # created empty -> may land on the list at once
    session.commit()
    session.refresh(product)
    return _product_out(product, _stock_of(session, product.id))


@router.get("/{product_id}", response_model=ProductOut)
def get_product(
    product_id: int,
    session: Session = Depends(get_session),
):
    product = _get_active(session, product_id)
    return _product_out(product, _stock_of(session, product.id))


@router.patch("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    data: ProductUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    product = _get_active(session, product_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    _touch(product, user)
    session.add(product)
    session.flush()
    reconcile_auto_items(session)  # name / threshold / type changes can affect the list
    session.commit()
    session.refresh(product)
    return _product_out(product, _stock_of(session, product.id))


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Soft-delete: hidden from lists but archive/list references stay intact."""
    product = _get_active(session, product_id)
    product.deleted_at = datetime.now(UTC)
    _touch(product, user)
    session.add(product)
    session.flush()
    reconcile_auto_items(session)  # drop its open auto entry
    session.commit()


@router.post("/{product_id}/restore", response_model=ProductOut)
def restore_product(
    product_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    product = session.get(Product, product_id)
    if not product:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")
    product.deleted_at = None
    _touch(product, user)
    session.add(product)
    session.flush()
    reconcile_auto_items(session)
    session.commit()
    session.refresh(product)
    return _product_out(product, _stock_of(session, product.id))


# ── Stock (Bestand) ─────────────────────────────────────────────────────────


@router.post("/{product_id}/stock", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def add_stock(
    product_id: int,
    data: StockIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Add one package. status -> a full package; counter -> a package of `size`
    units (default the product's package size)."""
    product = _get_active(session, product_id)
    expiry, purchase = _resolve_dates(product, data.expiry_date, data.purchase_date)
    if is_status(product):
        item = StockItem(
            product_id=product.id,
            status_level=data.status_level if data.status_level is not None else STATUS_FULL,
            expiry_date=expiry,
            purchase_date=purchase,
            updated_by=user.id,
        )
    else:
        size = data.size if data.size is not None else product.package_size
        remaining = data.remaining if data.remaining is not None else size
        item = StockItem(
            product_id=product.id,
            size=size,
            remaining=remaining,
            expiry_date=expiry,
            purchase_date=purchase,
            updated_by=user.id,
        )
    session.add(item)
    session.flush()
    reconcile_auto_items(session)
    session.commit()
    return _product_out(product, _stock_of(session, product.id))


@router.patch("/{product_id}/stock/{stock_id}", response_model=ProductOut)
def adjust_stock(
    product_id: int,
    stock_id: int,
    data: StockAdjust,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Set a package's level/remaining. Hitting empty (level 0 / 0 units)
    removes the package so the next one becomes current."""
    product = _get_active(session, product_id)
    item = session.get(StockItem, stock_id)
    if not item or item.product_id != product_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "stock item not found")
    if data.expected_updated_at is not None and item.updated_at != data.expected_updated_at:
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail=jsonable_encoder(StockItemOut(**item.model_dump()))
        )

    if is_status(product):
        if data.status_level is not None:
            if data.status_level <= 0:
                session.delete(item)
            else:
                item.status_level = data.status_level
                item.updated_at = datetime.now(UTC)
                item.updated_by = user.id
                session.add(item)
    elif data.remaining is not None:
        if data.remaining <= 0:
            session.delete(item)
        else:
            item.remaining = data.remaining
            item.updated_at = datetime.now(UTC)
            item.updated_by = user.id
            session.add(item)

    _touch(product, user)
    session.add(product)
    session.flush()
    reconcile_auto_items(session)
    session.commit()
    return _product_out(product, _stock_of(session, product.id))


@router.delete("/{product_id}/stock/{stock_id}", response_model=ProductOut)
def remove_stock(
    product_id: int,
    stock_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Throw away a whole package (e.g. the refill-counter minus)."""
    product = _get_active(session, product_id)
    item = session.get(StockItem, stock_id)
    if not item or item.product_id != product_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "stock item not found")
    session.delete(item)
    _touch(product, user)
    session.add(product)
    session.flush()
    reconcile_auto_items(session)
    session.commit()
    return _product_out(product, _stock_of(session, product.id))


def _resolve_dates(
    product: Product, expiry_date: date | None, purchase_date: date | None
) -> tuple[date | None, date | None]:
    """Keep only the date that matches the product's expiry mode."""
    if product.can_expire == ExpiryMode.expiry:
        return expiry_date, None
    if product.can_expire == ExpiryMode.purchase_date:
        return None, purchase_date if purchase_date is not None else date.today()
    return None, None
