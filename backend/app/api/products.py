from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Product, TrackingType, User
from .deps import current_user

router = APIRouter(prefix="/products", tags=["products"])


class ProductIn(BaseModel):
    name: str
    category_id: int | None = None
    location: str | None = None
    tracking_type: TrackingType = TrackingType.status
    current_value: float = 0
    min_value: float | None = None
    step: float | None = None
    full_value: float | None = None
    unit: str | None = None
    notes: str | None = None


class AdjustIn(BaseModel):
    current_value: float


@router.get("", response_model=list[Product])
def list_products(session: Session = Depends(get_session), user: User = Depends(current_user)):
    return session.exec(
        select(Product).where(Product.deleted_at.is_(None)).order_by(Product.name)
    ).all()


@router.post("", response_model=Product, status_code=status.HTTP_201_CREATED)
def create_product(
    data: ProductIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    product = Product(**data.model_dump(), updated_by=user.id)
    session.add(product)
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
    """Consume/refill: set the current value (the per-type step logic lives in
    the frontend; the API just stores the new value)."""
    product = session.get(Product, product_id)
    if not product or product.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "product not found")
    product.current_value = data.current_value
    product.updated_at = datetime.now(UTC)
    product.updated_by = user.id
    session.add(product)
    session.commit()
    session.refresh(product)
    return product
