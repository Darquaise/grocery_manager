from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from .schemas import UserOut

from ..db import get_session
from ..events import bus
from ..models import KitchenMember, User
from .deps import current_user

router = APIRouter(prefix="/users", tags=["users"])


class UserUpdate(BaseModel):
    color: str | None = None
    language: str | None = None


@router.patch("/me", response_model=UserOut)
def update_me(data: UserUpdate, session: Session = Depends(get_session), user: User = Depends(current_user)):
    """Each user sets their own colour and UI language. Only provided fields
    are changed. (Other users are only visible as kitchen members.)"""
    fields = data.model_dump(exclude_unset=True)
    if "color" in fields and fields["color"] is not None:
        user.color = fields["color"]
    if "language" in fields:
        user.language = fields["language"]
    session.add(user)
    session.commit()
    session.refresh(user)
    if "color" in fields:
        # The colour shows up in member lists / shopping dots of every kitchen
        # I'm in; the URL carries no kitchen id, so bump them explicitly.
        for kitchen_id in session.exec(
            select(KitchenMember.kitchen_id).where(KitchenMember.user_id == user.id)
        ).all():
            bus.bump(kitchen_id)
    return user
