"""managed locations

Turn the free-text product.location into a managed Location list (like
categories): a `location` table plus a product.location_id FK. Existing
free-text values are migrated into Location rows.

Revision ID: b2f4c1a9d3e7
Revises: 4b5d683a1555
Create Date: 2026-06-20 17:45:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'b2f4c1a9d3e7'
down_revision: str | None = '4b5d683a1555'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FK_NAME = 'fk_product_location_id_location'


def upgrade() -> None:
    op.create_table(
        'location',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_location_name'), 'location', ['name'], unique=False)

    op.add_column('product', sa.Column('location_id', sa.Integer(), nullable=True))
    op.create_foreign_key(FK_NAME, 'product', 'location', ['location_id'], ['id'])

    # Migrate existing free-text locations into managed rows, then link products.
    op.execute(
        "INSERT INTO location (name, sort_order, is_default) "
        "SELECT DISTINCT location, 0, false FROM product "
        "WHERE location IS NOT NULL AND location <> ''"
    )
    op.execute(
        "UPDATE product SET location_id = "
        "(SELECT l.id FROM location l WHERE l.name = product.location) "
        "WHERE location IS NOT NULL AND location <> ''"
    )

    op.drop_column('product', 'location')


def downgrade() -> None:
    op.add_column(
        'product',
        sa.Column('location', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )
    op.execute(
        "UPDATE product SET location = "
        "(SELECT l.name FROM location l WHERE l.id = product.location_id) "
        "WHERE location_id IS NOT NULL"
    )
    op.drop_constraint(FK_NAME, 'product', type_='foreignkey')
    op.drop_column('product', 'location_id')
    op.drop_index(op.f('ix_location_name'), table_name='location')
    op.drop_table('location')
