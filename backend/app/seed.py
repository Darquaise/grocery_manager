from sqlmodel import Session, select

from .config import settings
from .models import Category, Location, User
from .security import hash_password

# Default categories (editable later via the API).
DEFAULT_CATEGORIES = [
    "Gemüse",
    "Obst",
    "Milchprodukte",
    "Brot/Backwaren",
    "Vorrat/Trocken",
    "Tiefkühl",
    "Getränke",
    "Hygiene/Haushalt",
    "Sonstiges",
]

# Default storage locations (editable later via the API).
DEFAULT_LOCATIONS = [
    "Kühlschrank",
    "Vorratsschrank",
    "Tiefkühler",
]


def seed(session: Session) -> None:
    """Idempotent: create default categories/locations and the two accounts."""
    if not session.exec(select(Category)).first():
        for i, name in enumerate(DEFAULT_CATEGORIES):
            session.add(Category(name=name, sort_order=i, is_default=True))

    if not session.exec(select(Location)).first():
        for i, name in enumerate(DEFAULT_LOCATIONS):
            session.add(Location(name=name, sort_order=i, is_default=True))

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
