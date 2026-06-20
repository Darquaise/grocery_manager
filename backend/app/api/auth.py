from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import User
from ..security import verify_password
from .deps import current_user

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    name: str
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    color: str


@router.post("/login", response_model=UserOut)
def login(data: LoginIn, request: Request, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.name == data.name)).first()
    if not user or not verify_password(user.password_hash, data.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    request.session["user_id"] = user.id
    return UserOut(id=user.id, name=user.name, color=user.color)


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return UserOut(id=user.id, name=user.name, color=user.color)
