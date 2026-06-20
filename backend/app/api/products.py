from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Product, TrackingType, User
from ..shopping_logic import reconcile_auto_items
from .deps import current_user

router = APIRouter(prefix="/products", tags=["products"])


class ProductIn(BaseModel):
    name: str
    category_id: int | None = None
    location_id: int | None = None
    tracking_type: TrackingType = TrackingType.status
    current_value: float = 0
    min_value: float | None = None
    step: float | None = None
    full_value: float | None = None
    unit: str | None = None
    notes: str | None = None


class ProductUpdate(BaseModel):
    """All fields optional — only the provided ones are changed (PATCH)."""

    name: str | None = None
    category_id: int | None = None
    location_id: int | None = None
    tracking_type: TrackingType | None = None
    current_value: float | None = None
    min_value: float | None = None
    step: float | None = None
    full_value: float | None = None
    unit: str | None = None
    notes: str | None = None


class AdjustIn(BaseModel):
    current_value: float
    # Optimistic concurrency: the `updated_at` the client last saw. If the
    # server moved on since (a concurrent change), we reject with 409 instead of
    # silently overwriting. Omitted/None = no check (last-write-wins).
    expected_updated_at: datetime | None = None


def _touch(product: Product, user: User) -> None:
    product.updated_at = datetime.now(UTC)
    product.updated_by = user.id


def _get_active(session: Session, product_id: int) -> Product:
    product = session.get(Product, product_id)
    if not product or product.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")
    return product


@router.get("", response_model=list[Product])
def list_products(
    include_deleted: bool = Query(False),
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    query = select(Product).order_by(Product.name)
    if not include_deleted:
        query = query.where(Product.deleted_at.is_(None))
    return session.exec(query).all()


@router.post("", response_model=Product, status_code=status.HTTP_201_CREATED)
def create_product(
    data: ProductIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    product = Product(**data.model_dump(), updated_by=user.id)
    session.add(product)
    session.flush()
    reconcile_auto_items(session)  # may immediately land on the list (e.g. created empty)
    session.commit()
    session.refresh(product)
    return product


@router.get("/{product_id}", response_model=Product)
def get_product(
    product_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    return _get_active(session, product_id)


@router.patch("/{product_id}", response_model=Product)
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
    reconcile_auto_items(session)  # name / min / value changes can affect the list
    session.commit()
    session.refresh(product)
    return product


@router.post("/{product_id}/adjust", response_model=Product)
def adjust_product(
    product_id: int,
    data: AdjustIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Consume/refill: set the new current value. Crossing the min threshold
    adds or clears the product's auto shopping-list entry."""
    product = _get_active(session, product_id)
    if data.expected_updated_at is not None and product.updated_at != data.expected_updated_at:
        # Concurrent change since the client last read it → let the client decide.
        raise HTTPException(status.HTTP_409_CONFLICT, detail=jsonable_encoder(product))
    product.current_value = data.current_value
    _touch(product, user)
    session.add(product)
    session.flush()
    reconcile_auto_items(session)
    session.commit()
    session.refresh(product)
    return product


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


@router.post("/{product_id}/restore", response_model=Product)
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
    return product
