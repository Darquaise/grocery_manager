import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from ..db import get_session
from ..models import AccountInvite, Kitchen, KitchenMember, KitchenRole, User
from .deps import current_user, effective_role

router = APIRouter(prefix="/invites", tags=["invites"])


class InviteCreateIn(BaseModel):
    """Optionally attach one of my kitchens: the registered account then gets a
    pending invitation into it (with `kitchen_role`)."""

    kitchen_id: int | None = None
    kitchen_role: KitchenRole = KitchenRole.write


class InviteOut(BaseModel):
    id: int
    code: str
    created_at: datetime
    used_by_name: str | None = None
    used_at: datetime | None = None
    kitchen_id: int | None = None
    kitchen_name: str | None = None
    kitchen_role: KitchenRole | None = None


def _invite_out(session: Session, invite: AccountInvite) -> InviteOut:
    used_by_name = None
    if invite.used_by is not None:
        used_by = session.get(User, invite.used_by)
        used_by_name = used_by.name if used_by else None
    kitchen_name = None
    if invite.kitchen_id is not None:
        kitchen = session.get(Kitchen, invite.kitchen_id)
        kitchen_name = kitchen.name if kitchen else None
    return InviteOut(
        id=invite.id,
        code=invite.code,
        created_at=invite.created_at,
        used_by_name=used_by_name,
        used_at=invite.used_at,
        kitchen_id=invite.kitchen_id,
        kitchen_name=kitchen_name,
        kitchen_role=invite.kitchen_role,
    )


@router.get("", response_model=list[InviteOut])
def list_invites(
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """The registration codes I created, newest first (incl. who used them)."""
    invites = session.exec(
        select(AccountInvite)
        .where(AccountInvite.created_by == user.id)
        .order_by(AccountInvite.created_at.desc())
    ).all()
    return [_invite_out(session, i) for i in invites]


@router.post("", response_model=InviteOut, status_code=status.HTTP_201_CREATED)
def create_invite(
    data: InviteCreateIn | None = None,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Any existing user may invite new accounts (the app stays invite-only).
    Attaching a kitchen requires admin rights in that kitchen."""
    kitchen_id = data.kitchen_id if data else None
    kitchen_role = data.kitchen_role if data else KitchenRole.write
    if kitchen_id is not None:
        kitchen = session.get(Kitchen, kitchen_id)
        member = session.exec(
            select(KitchenMember).where(
                KitchenMember.kitchen_id == kitchen_id,
                KitchenMember.user_id == user.id,
            )
        ).first()
        if not kitchen or not member:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "kitchen not found")
        if effective_role(kitchen, member) != KitchenRole.admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")

    invite = AccountInvite(
        code=secrets.token_urlsafe(6),
        created_by=user.id,
        kitchen_id=kitchen_id,
        kitchen_role=kitchen_role if kitchen_id is not None else None,
    )
    session.add(invite)
    session.commit()
    session.refresh(invite)
    return _invite_out(session, invite)


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_invite(
    invite_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Revoke one of my own, still-unused codes."""
    invite = session.get(AccountInvite, invite_id)
    if not invite or invite.created_by != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    if invite.used_by is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "invite already used")
    session.delete(invite)
    session.commit()
