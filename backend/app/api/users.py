from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import User
from .deps import current_user

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(current_user)])


class UserOut(BaseModel):
    id: int
    name: str
    color: str
    language: str | None = None


class UserUpdate(BaseModel):
    color: str | None = None
    language: str | None = None


@router.get("", response_model=list[UserOut])
def list_users(session: Session = Depends(get_session)):
    """Both seeded accounts — used for colour markers across the UI."""
    return session.exec(select(User).order_by(User.id)).all()


@router.patch("/me", response_model=UserOut)
def update_me(
    data: UserUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Each user sets their own colour and UI language (names stay as seeded).
    Only provided fields are changed."""
    fields = data.model_dump(exclude_unset=True)
    if "color" in fields and fields["color"] is not None:
        user.color = fields["color"]
    if "language" in fields:
        user.language = fields["language"]
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
