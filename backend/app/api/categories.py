from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import Category, User
from .deps import current_user

router = APIRouter(prefix="/categories", tags=["categories"])


class CategoryIn(BaseModel):
    name: str
    sort_order: int = 0


@router.get("", response_model=list[Category])
def list_categories(session: Session = Depends(get_session), user: User = Depends(current_user)):
    return session.exec(select(Category).order_by(Category.sort_order, Category.name)).all()


@router.post("", response_model=Category, status_code=status.HTTP_201_CREATED)
def create_category(
    data: CategoryIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    category = Category(name=data.name, sort_order=data.sort_order, is_default=False)
    session.add(category)
    session.commit()
    session.refresh(category)
    return category
