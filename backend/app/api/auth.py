from datetime import UTC, datetime
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlmodel import Session, select

from .deps import current_user
from .kitchens import create_pending_invite
from .schemas import UserOut

from ..db import get_session
from ..events import bus
from ..models import AccountInvite, Kitchen, KitchenRole, User
from ..security import hash_password, verify_password

router = APIRouter(tags=["auth"])


class LoginIn(BaseModel):
    name: str
    password: str


class RegisterIn(BaseModel):
    name: str
    password: str
    invite_code: str


@router.post("/login", response_model=UserOut)
def login(data: LoginIn, request: Request, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.name == data.name)).first()
    if not user or not verify_password(user.password_hash, data.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")
    request.session["user_id"] = user.id
    return user


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(data: RegisterIn, request: Request, session: Session = Depends(get_session)):
    """Create an account with a single-use invite code and log it in. New users
    start without a kitchen — they create their own or get added to one."""
    name = data.name.strip()
    if not name or not data.password:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "name and password required")
    invite = session.exec(
        select(AccountInvite).where(AccountInvite.code == data.invite_code.strip())
    ).first()
    if not invite or invite.used_by is not None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "invalid invite code")
    if session.exec(select(User).where(User.name == name)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "name already taken")

    user = User(name=name, password_hash=hash_password(data.password))
    session.add(user)
    session.flush()
    invite.used_by = user.id
    invite.used_at = datetime.now(UTC)
    session.add(invite)
    # Kitchen-linked code: the new account gets a pending invitation into the
    # attached kitchen and decides in the join dialog after logging in.
    linked_kitchen_id: int | None = None
    if invite.kitchen_id is not None and session.get(Kitchen, invite.kitchen_id):
        create_pending_invite(
            session,
            kitchen_id=invite.kitchen_id,
            user_id=user.id,
            role=invite.kitchen_role or KitchenRole.write,
            invited_by=invite.created_by,
        )
        linked_kitchen_id = invite.kitchen_id
    session.commit()
    if linked_kitchen_id is not None:
        # The admins' pending-invite list changed; URL carries no kitchen id.
        bus.bump(linked_kitchen_id)
    session.refresh(user)
    request.session["user_id"] = user.id
    return user


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user
