from sqlmodel import Session, select

from .config import settings
from .models import User
from .security import hash_password


def seed(session: Session) -> None:
    """Idempotent: create the two configured accounts.

    Categories and storage locations are intentionally *not* pre-seeded — users
    create their own from scratch. Existing entries are left untouched.
    """
    for name, password, color in (
        (settings.user1_name, settings.user1_password, settings.user1_color),
        (settings.user2_name, settings.user2_password, settings.user2_color),
    ):
        if not name or not password:
            continue
        if session.exec(select(User).where(User.name == name)).first():
            continue
        session.add(User(name=name, color=color, password_hash=hash_password(password)))

    session.commit()
