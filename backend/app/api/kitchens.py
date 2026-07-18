import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, col, delete, select, update

from .. import db
from ..db import get_session
from ..events import bus
from ..models import (
    AccountInvite,
    Category,
    Kitchen,
    KitchenInvite,
    KitchenMember,
    KitchenRole,
    Location,
    Product,
    ShoppingListItem,
    ShoppingTrip,
    StockItem,
    User,
)
from .deps import KitchenContext, admin_of, current_user, effective_role, member_of

router = APIRouter(prefix="/kitchens", tags=["kitchens"])
# The invitee's side: pending invitations addressed to *me* (not kitchen-scoped).
my_invites_router = APIRouter(prefix="/kitchen-invites", tags=["kitchens"])


class KitchenIn(BaseModel):
    name: str


class KitchenUpdate(BaseModel):
    name: str


class KitchenOut(BaseModel):
    id: int
    name: str
    owner_id: int
    # The requesting user's effective role (owner → admin) — drives UI gating.
    my_role: KitchenRole
    is_owner: bool


class InviteIn(BaseModel):
    """Invite a user by account name (accounts know each other by name)."""

    name: str
    role: KitchenRole = KitchenRole.write


class PendingInviteOut(BaseModel):
    """An open invitation, as shown in the kitchen's member management."""

    id: int
    user_id: int
    name: str
    role: KitchenRole


class MyInviteOut(BaseModel):
    """An open invitation, as shown to the invited user (join dialog)."""

    id: int
    kitchen_id: int
    kitchen_name: str
    role: KitchenRole
    invited_by_name: str
    created_at: datetime


class MemberRoleUpdate(BaseModel):
    role: KitchenRole


class MemberOut(BaseModel):
    user_id: int
    name: str
    color: str
    role: KitchenRole
    is_owner: bool


class TransferIn(BaseModel):
    user_id: int


def _kitchen_out(kitchen: Kitchen, user: User, member: KitchenMember) -> KitchenOut:
    return KitchenOut(
        id=kitchen.id,
        name=kitchen.name,
        owner_id=kitchen.owner_id,
        my_role=effective_role(kitchen, member),
        is_owner=kitchen.owner_id == user.id,
    )


def _members_out(session: Session, kitchen: Kitchen) -> list[MemberOut]:
    rows = session.exec(
        select(KitchenMember, User)
        .where(KitchenMember.kitchen_id == kitchen.id)
        .join(User, User.id == KitchenMember.user_id)
        .order_by(KitchenMember.created_at)
    ).all()
    return [
        MemberOut(
            user_id=user.id,
            name=user.name,
            color=user.color,
            role=effective_role(kitchen, member),
            is_owner=kitchen.owner_id == user.id,
        )
        for member, user in rows
    ]


def _pending_out(session: Session, kitchen_id: int) -> list[PendingInviteOut]:
    rows = session.exec(
        select(KitchenInvite, User)
        .where(KitchenInvite.kitchen_id == kitchen_id)
        .join(User, User.id == KitchenInvite.user_id)
        .order_by(KitchenInvite.created_at)
    ).all()
    return [
        PendingInviteOut(id=invite.id, user_id=user.id, name=user.name, role=invite.role)
        for invite, user in rows
    ]


def _get_member(session: Session, kitchen_id: int, user_id: int) -> KitchenMember | None:
    return session.exec(
        select(KitchenMember).where(
            KitchenMember.kitchen_id == kitchen_id,
            KitchenMember.user_id == user_id,
        )
    ).first()


def create_pending_invite(
    session: Session, kitchen_id: int, user_id: int, role: KitchenRole, invited_by: int
) -> KitchenInvite:
    """Shared with registration (kitchen-linked account codes). The caller is
    responsible for committing; raises on already-member/already-invited."""
    if _get_member(session, kitchen_id, user_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "already a member")
    existing = session.exec(
        select(KitchenInvite).where(
            KitchenInvite.kitchen_id == kitchen_id, KitchenInvite.user_id == user_id
        )
    ).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "already invited")
    invite = KitchenInvite(
        kitchen_id=kitchen_id, user_id=user_id, role=role, invited_by=invited_by
    )
    session.add(invite)
    return invite


# ── My kitchens ─────────────────────────────────────────────────────────────


@router.get("", response_model=list[KitchenOut])
def list_my_kitchens(
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    rows = session.exec(
        select(Kitchen, KitchenMember)
        .join(KitchenMember, KitchenMember.kitchen_id == Kitchen.id)
        .where(KitchenMember.user_id == user.id)
        .order_by(Kitchen.id)
    ).all()
    return [_kitchen_out(kitchen, user, member) for kitchen, member in rows]


@router.post("", response_model=KitchenOut, status_code=status.HTTP_201_CREATED)
def create_kitchen(
    data: KitchenIn,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    """Every account may found kitchens; the creator becomes the owner."""
    name = data.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "name required")
    kitchen = Kitchen(name=name, owner_id=user.id)
    session.add(kitchen)
    session.flush()
    member = KitchenMember(kitchen_id=kitchen.id, user_id=user.id, role=KitchenRole.admin)
    session.add(member)
    session.commit()
    session.refresh(kitchen)
    return _kitchen_out(kitchen, user, member)


@router.patch("/{kitchen_id}", response_model=KitchenOut)
def rename_kitchen(
    data: KitchenUpdate,
    ctx: KitchenContext = Depends(admin_of),
    session: Session = Depends(get_session),
):
    name = data.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "name required")
    ctx.kitchen.name = name
    session.add(ctx.kitchen)
    session.commit()
    session.refresh(ctx.kitchen)
    member = _get_member(session, ctx.kitchen.id, ctx.user.id)
    return _kitchen_out(ctx.kitchen, ctx.user, member)


@router.delete("/{kitchen_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_kitchen(
    ctx: KitchenContext = Depends(member_of),
    session: Session = Depends(get_session),
):
    """Delete the kitchen with everything in it (owner only). Unused
    registration codes pointing at it become plain codes."""
    if not ctx.is_owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the owner can delete the kitchen")
    kid = ctx.kitchen.id
    product_ids = session.exec(select(Product.id).where(Product.kitchen_id == kid)).all()
    if product_ids:
        session.exec(delete(StockItem).where(col(StockItem.product_id).in_(product_ids)))
    session.exec(delete(ShoppingListItem).where(col(ShoppingListItem.kitchen_id) == kid))
    session.exec(delete(ShoppingTrip).where(col(ShoppingTrip.kitchen_id) == kid))
    session.exec(delete(Product).where(col(Product.kitchen_id) == kid))
    session.exec(delete(Category).where(col(Category.kitchen_id) == kid))
    session.exec(delete(Location).where(col(Location.kitchen_id) == kid))
    session.exec(delete(KitchenInvite).where(col(KitchenInvite.kitchen_id) == kid))
    session.exec(delete(KitchenMember).where(col(KitchenMember.kitchen_id) == kid))
    session.exec(
        update(AccountInvite)
        .where(col(AccountInvite.kitchen_id) == kid)
        .values(kitchen_id=None, kitchen_role=None)
    )
    session.delete(ctx.kitchen)
    session.commit()


# ── Live updates (SSE) ──────────────────────────────────────────────────────


@router.get("/{kitchen_id}/events")
async def kitchen_events(kitchen_id: int, request: Request):
    """Server-sent-events stream: pushes the kitchen's revision whenever its
    data changed (see `events.bus`). Content-free by design — clients react by
    re-fetching what they display."""

    # Auth via a short-lived session in the threadpool: the stream lives for
    # minutes and must not pin a DB connection (or block the event loop).
    # `db.engine` (module attribute, not a direct import) so the test harness'
    # engine swap is honoured.
    def check_membership() -> None:
        with Session(db.engine) as session:
            user_id = request.session.get("user_id")
            user = session.get(User, user_id) if user_id else None
            if not user:
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
            if not _get_member(session, kitchen_id, user.id):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "kitchen not found")

    await run_in_threadpool(check_membership)

    queue = bus.subscribe(kitchen_id)

    def sse(rev: int) -> str:
        return f"id: {rev}\nevent: change\ndata: {rev}\n\n"

    async def stream():
        try:
            rev = bus.revision(kitchen_id)
            # Browser reconnect: if anything happened while away, say so now.
            last = request.headers.get("last-event-id")
            if last is not None and last != str(rev):
                yield sse(rev)
            while True:
                try:
                    rev = await asyncio.wait_for(queue.get(), timeout=25)
                    while not queue.empty():  # coalesce bursts into one event
                        rev = queue.get_nowait()
                    yield sse(rev)
                except TimeoutError:
                    yield ": keepalive\n\n"  # defeats proxy idle timeouts
        finally:
            bus.unsubscribe(kitchen_id, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # nginx fronts this in production — never buffer the stream.
            "X-Accel-Buffering": "no",
        },
    )


# ── Members ─────────────────────────────────────────────────────────────────


@router.get("/{kitchen_id}/members", response_model=list[MemberOut])
def list_members(
    ctx: KitchenContext = Depends(member_of),
    session: Session = Depends(get_session),
):
    return _members_out(session, ctx.kitchen)


@router.patch("/{kitchen_id}/members/{user_id}", response_model=list[MemberOut])
def update_member_role(
    user_id: int,
    data: MemberRoleUpdate,
    ctx: KitchenContext = Depends(admin_of),
    session: Session = Depends(get_session),
):
    if user_id == ctx.kitchen.owner_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "the owner's role cannot be changed")
    member = _get_member(session, ctx.kitchen.id, user_id)
    if not member:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    member.role = data.role
    session.add(member)
    session.commit()
    return _members_out(session, ctx.kitchen)


@router.delete("/{kitchen_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    user_id: int,
    ctx: KitchenContext = Depends(member_of),
    session: Session = Depends(get_session),
):
    """Admins remove members; every member may remove themselves (leave). The
    owner can do neither — ownership has to be transferred first."""
    if user_id != ctx.user.id and ctx.role != KitchenRole.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")
    if user_id == ctx.kitchen.owner_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "the owner cannot be removed")
    member = _get_member(session, ctx.kitchen.id, user_id)
    if not member:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")
    session.delete(member)
    session.commit()


# ── Invitations (kitchen side) ──────────────────────────────────────────────


@router.get("/{kitchen_id}/invites", response_model=list[PendingInviteOut])
def list_pending_invites(
    ctx: KitchenContext = Depends(admin_of),
    session: Session = Depends(get_session),
):
    return _pending_out(session, ctx.kitchen.id)


@router.post(
    "/{kitchen_id}/invites",
    response_model=list[PendingInviteOut],
    status_code=status.HTTP_201_CREATED,
)
def invite_member(
    data: InviteIn,
    ctx: KitchenContext = Depends(admin_of),
    session: Session = Depends(get_session),
):
    """Invite a user by name. They become a member only after accepting."""
    invitee = session.exec(select(User).where(User.name == data.name.strip())).first()
    if not invitee:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    create_pending_invite(session, ctx.kitchen.id, invitee.id, data.role, ctx.user.id)
    session.commit()
    return _pending_out(session, ctx.kitchen.id)


@router.delete("/{kitchen_id}/invites/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_pending_invite(
    invite_id: int,
    ctx: KitchenContext = Depends(admin_of),
    session: Session = Depends(get_session),
):
    invite = session.get(KitchenInvite, invite_id)
    if not invite or invite.kitchen_id != ctx.kitchen.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    session.delete(invite)
    session.commit()


# ── Invitations (my side: the join dialog) ──────────────────────────────────


def _get_my_invite(session: Session, user: User, invite_id: int) -> KitchenInvite:
    invite = session.get(KitchenInvite, invite_id)
    if not invite or invite.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invite not found")
    return invite


@my_invites_router.get("", response_model=list[MyInviteOut])
def list_my_invites(
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    rows = session.exec(
        select(KitchenInvite, Kitchen, User)
        .where(KitchenInvite.user_id == user.id)
        .join(Kitchen, Kitchen.id == KitchenInvite.kitchen_id)
        .join(User, User.id == KitchenInvite.invited_by)
        .order_by(KitchenInvite.created_at)
    ).all()
    return [
        MyInviteOut(
            id=invite.id,
            kitchen_id=kitchen.id,
            kitchen_name=kitchen.name,
            role=invite.role,
            invited_by_name=inviter.name,
            created_at=invite.created_at,
        )
        for invite, kitchen, inviter in rows
    ]


@my_invites_router.post("/{invite_id}/accept", response_model=KitchenOut)
def accept_invite(
    invite_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    invite = _get_my_invite(session, user, invite_id)
    kitchen = session.get(Kitchen, invite.kitchen_id)
    member = _get_member(session, invite.kitchen_id, user.id)
    if member is None:
        member = KitchenMember(kitchen_id=invite.kitchen_id, user_id=user.id, role=invite.role)
        session.add(member)
    session.delete(invite)
    session.commit()
    session.refresh(member)
    # URL carries no kitchen id, so the change middleware can't see this one.
    bus.bump(kitchen.id)
    return _kitchen_out(kitchen, user, member)


@my_invites_router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
def decline_invite(
    invite_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    invite = _get_my_invite(session, user, invite_id)
    kitchen_id = invite.kitchen_id
    session.delete(invite)
    session.commit()
    # Not kitchen-scoped either; the admins' pending list changed.
    bus.bump(kitchen_id)


# ── Ownership ───────────────────────────────────────────────────────────────


@router.post("/{kitchen_id}/transfer", response_model=list[MemberOut])
def transfer_ownership(
    data: TransferIn,
    ctx: KitchenContext = Depends(member_of),
    session: Session = Depends(get_session),
):
    """Hand the kitchen to another member (owner only). The previous owner
    stays on as an admin member."""
    if not ctx.is_owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "only the owner can transfer ownership")
    if data.user_id == ctx.user.id:
        raise HTTPException(status.HTTP_409_CONFLICT, "already the owner")
    target = _get_member(session, ctx.kitchen.id, data.user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found")

    old_owner = _get_member(session, ctx.kitchen.id, ctx.user.id)
    old_owner.role = KitchenRole.admin
    target.role = KitchenRole.admin
    ctx.kitchen.owner_id = data.user_id
    session.add(old_owner)
    session.add(target)
    session.add(ctx.kitchen)
    session.commit()
    return _members_out(session, ctx.kitchen)
