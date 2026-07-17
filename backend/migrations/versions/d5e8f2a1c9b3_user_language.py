"""user language

Add a nullable `language` column to `user` holding the account's chosen UI
language (e.g. "en" / "de"). NULL until the user has logged in once and their
current selection was persisted.

Revision ID: d5e8f2a1c9b3
Revises: c3a7e1f29b41
Create Date: 2026-07-15 00:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'd5e8f2a1c9b3'
down_revision: str | None = 'c3a7e1f29b41'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'user',
        sa.Column('language', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('user', 'language')
