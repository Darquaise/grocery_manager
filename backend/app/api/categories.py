from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Category, Product
from .deps import current_user

router = APIRouter(prefix="/categories", tags=["categories"], dependencies=[Depends(current_user)])


class CategoryIn(BaseModel):
    name: str
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None


@router.get("", response_model=list[Category])
def list_categories(session: Session = Depends(get_session)):
    return session.exec(select(Category).order_by(Category.sort_order, Category.name)).all()


@router.post("", response_model=Category, status_code=status.HTTP_201_CREATED)
def create_category(
    data: CategoryIn,
    session: Session = Depends(get_session),
):
    category = Category(name=data.name, sort_order=data.sort_order, is_default=False)
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


@router.patch("/{category_id}", response_model=Category)
def update_category(
    category_id: int,
    data: CategoryUpdate,
    session: Session = Depends(get_session),
):
    category = session.get(Category, category_id)
    if not category:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "category not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    session.add(category)
    session.commit()
    session.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int,
    session: Session = Depends(get_session),
):
    """Delete a category; products in it fall back to "no category" (null)."""
    category = session.get(Category, category_id)
    if not category:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "category not found")
    for product in session.exec(
        select(Product).where(Product.category_id == category_id)
    ).all():
        product.category_id = None
        session.add(product)
    session.delete(category)
    session.commit()
