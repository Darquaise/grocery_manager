"""current package marker on stockitem

Adds `stockitem.current_since`: the package a product is currently being used
from. It keeps that role until it is used up, so a package added later queues up
behind it even when it expires sooner (before, the soonest-expiring package
silently became the current one and status changes hit the wrong package).

Backfill picks the package each product would have shown as current until now —
the most urgent one — so nothing visibly changes for existing data.

Revision ID: a4c7e93b15d2
Revises: f3b9d2e61a07
Create Date: 2026-07-18 17:40:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4c7e93b15d2'
down_revision: str | None = 'f3b9d2e61a07'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Mirrors `shopping_logic.sort_stock`: order by the date that matches the
# product's expiry mode (nulls last), then by creation. The `expirymode` enum
# stores the Python member *names*, hence 'purchase_date' (value: purchaseDate).
_BACKFILL = sa.text(
    """
    UPDATE stockitem SET current_since = now()
    WHERE id IN (
        SELECT DISTINCT ON (s.product_id) s.id
        FROM stockitem s
        JOIN product p ON p.id = s.product_id
        ORDER BY s.product_id,
                 CASE
                     WHEN p.can_expire = 'expiry' THEN s.expiry_date
                     WHEN p.can_expire = 'purchase_date' THEN s.purchase_date
                 END ASC NULLS LAST,
                 s.created_at ASC
    )
    """
)


def upgrade() -> None:
    op.add_column('stockitem', sa.Column('current_since', sa.DateTime(), nullable=True))
    if op.get_bind().dialect.name == 'postgresql':
        op.execute(_BACKFILL)
    # Other dialects: leaving every row NULL is safe — `ensure_current` adopts
    # the most urgent package on the next write, which is the same choice.


def downgrade() -> None:
    op.drop_column('stockitem', 'current_since')
