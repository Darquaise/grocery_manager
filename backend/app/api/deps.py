from dataclasses import dataclass
from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session, select

from ..db import get_session
from ..models import Kitchen, KitchenMember, KitchenRole, User


def current_user(
        request: Request,
        session: Session = Depends(get_session),
) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    user = session.get(User, user_id)
    if not user:
        request.session.clear()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid session")
    return user


@dataclass
class KitchenContext:
    """The authenticated user's view of one kitchen (resolved per request)."""

    kitchen: Kitchen
    user: User
    role: KitchenRole

    @property
    def is_owner(self) -> bool:
        return self.kitchen.owner_id == self.user.id


_ROLE_ORDER = {KitchenRole.read: 0, KitchenRole.write: 1, KitchenRole.admin: 2}


def effective_role(kitchen: Kitchen, member: KitchenMember) -> KitchenRole:
    """The owner always acts as an admin, whatever their member row says."""
    return KitchenRole.admin if kitchen.owner_id == member.user_id else member.role


def require_role(minimum: KitchenRole):
    """Dependency factory: resolve `{kitchen_id}` from the path, check that the
    current user is a member with at least `minimum` rights, and return the
    context. Non-members get a 404 (kitchen existence stays hidden)."""

    def dependency(
            kitchen_id: int, session: Session = Depends(get_session), user: User = Depends(current_user),
    ) -> KitchenContext:
        kitchen = session.get(Kitchen, kitchen_id)
        member = (
            session.exec(
                select(KitchenMember).where(
                    KitchenMember.kitchen_id == kitchen_id,
                    KitchenMember.user_id == user.id,
                )
            ).first()
            if kitchen
            else None
        )
        if not kitchen or not member:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "kitchen not found")
        role = effective_role(kitchen, member)
        if _ROLE_ORDER[role] < _ROLE_ORDER[minimum]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient permissions")
        return KitchenContext(kitchen=kitchen, user=user, role=role)

    return dependency


# The three access levels used by the routers.
member_of = require_role(KitchenRole.read)
writer_of = require_role(KitchenRole.write)
admin_of = require_role(KitchenRole.admin)
