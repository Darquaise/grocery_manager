from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import User
from .deps import current_user

router = APIRouter(prefix="/users", tags=["users"])


class UserOut(BaseModel):
    id: int
    name: str
    color: str


class UserUpdate(BaseModel):
    color: str


@router.get("", response_model=list[UserOut])
def list_users(session: Session = Depends(get_session), user: User = Depends(current_user)):
    """Both seeded accounts — used for colour markers across the UI."""
    return session.exec(select(User).order_by(User.id)).all()


@router.patch("/me", response_model=UserOut)
def update_me(
    data: UserUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Each user picks their own colour in the settings (names stay as seeded)."""
    user.color = data.color
    session.add(user)
    session.commit()
    session.refresh(user)
    return user
