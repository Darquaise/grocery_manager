from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import ShoppingListItem, ShoppingSource, ShoppingState, User
from .deps import current_user

router = APIRouter(prefix="/shopping", tags=["shopping"])


class ShoppingItemIn(BaseModel):
    display_name: str
    amount_text: str | None = None
    product_id: int | None = None


@router.get("/items", response_model=list[ShoppingListItem])
def list_items(session: Session = Depends(get_session), user: User = Depends(current_user)):
    return session.exec(
        select(ShoppingListItem).where(ShoppingListItem.state == ShoppingState.open)
    ).all()


@router.post("/items", response_model=ShoppingListItem, status_code=status.HTTP_201_CREATED)
def add_item(
    data: ShoppingItemIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    item = ShoppingListItem(
        display_name=data.display_name,
        amount_text=data.amount_text,
        product_id=data.product_id,
        source=ShoppingSource.manual,
        added_by=user.id,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item
