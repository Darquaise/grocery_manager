"""split product from stock instances

Separate a product's definition from its actual stock: stock now lives in a
`stockitem` table (one row per package, each with its own expiry/purchase date),
so a product can hold several packages with different dates. The product gains a
`package_size` (1 = "status", >1 = "counter"), a `can_expire` mode, and reorder
thresholds; its old inline stock columns are dropped. Shopping-list items gain a
`purchase_plan` (planned packages, materialised into stock on trip completion).

No data migration: stocks are re-entered fresh.

Revision ID: c3a7e1f29b41
Revises: b2f4c1a9d3e7
Create Date: 2026-06-21 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c3a7e1f29b41'
down_revision: str | None = 'b2f4c1a9d3e7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# SQLAlchemy persists enums by member *name* (not value), matching the existing
# `shoppingstate` ('open', 'in_cart'). ExpiryMode.purchase_date has value
# "purchaseDate" but is stored as "purchase_date".
expiry_enum = sa.Enum('expiry', 'purchase_date', 'none', name='expirymode')


def upgrade() -> None:
    bind = op.get_bind()

    # New per-package stock table.
    op.create_table(
        'stockitem',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('expiry_date', sa.Date(), nullable=True),
        sa.Column('purchase_date', sa.Date(), nullable=True),
        sa.Column('status_level', sa.Integer(), nullable=True),
        sa.Column('remaining', sa.Integer(), nullable=True),
        sa.Column('size', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['product_id'], ['product.id'], ),
        sa.ForeignKeyConstraint(['updated_by'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_stockitem_product_id'), 'stockitem', ['product_id'], unique=False)

    # Product: new columns. server_default keeps existing rows valid; the ORM
    # supplies the value going forward.
    if bind.dialect.name == 'postgresql':
        expiry_enum.create(bind, checkfirst=True)
    op.add_column(
        'product', sa.Column('package_size', sa.Integer(), nullable=False, server_default='1')
    )
    op.add_column(
        'product',
        sa.Column('can_expire', expiry_enum, nullable=False, server_default='none'),
    )
    op.add_column('product', sa.Column('reorder_status_level', sa.Integer(), nullable=True))
    op.add_column('product', sa.Column('reorder_refill_count', sa.Integer(), nullable=True))
    op.add_column('product', sa.Column('reorder_total_units', sa.Integer(), nullable=True))

    # Product: drop the old inline-stock columns.
    op.drop_column('product', 'current_value')
    op.drop_column('product', 'min_value')
    op.drop_column('product', 'step')
    op.drop_column('product', 'full_value')
    op.drop_column('product', 'unit')
    op.drop_column('product', 'expiry_date')
    op.drop_column('product', 'tracking_type')
    if bind.dialect.name == 'postgresql':
        sa.Enum(name='trackingtype').drop(bind, checkfirst=True)

    # Shopping list: planned packages.
    op.add_column(
        'shoppinglistitem',
        sa.Column('purchase_plan', sqlmodel.sql.sqltypes.AutoString(), nullable=True),
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_column('shoppinglistitem', 'purchase_plan')

    tracking_enum = sa.Enum('status', 'counter', 'amount', name='trackingtype')
    if bind.dialect.name == 'postgresql':
        tracking_enum.create(bind, checkfirst=True)
    op.add_column(
        'product',
        sa.Column('tracking_type', tracking_enum, nullable=False, server_default='status'),
    )
    op.add_column('product', sa.Column('expiry_date', sa.Date(), nullable=True))
    op.add_column('product', sa.Column('unit', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('product', sa.Column('full_value', sa.Float(), nullable=True))
    op.add_column('product', sa.Column('step', sa.Float(), nullable=True))
    op.add_column('product', sa.Column('min_value', sa.Float(), nullable=True))
    op.add_column(
        'product', sa.Column('current_value', sa.Float(), nullable=False, server_default='0')
    )

    op.drop_column('product', 'reorder_total_units')
    op.drop_column('product', 'reorder_refill_count')
    op.drop_column('product', 'reorder_status_level')
    op.drop_column('product', 'can_expire')
    op.drop_column('product', 'package_size')
    if bind.dialect.name == 'postgresql':
        sa.Enum(name='expirymode').drop(bind, checkfirst=True)

    op.drop_index(op.f('ix_stockitem_product_id'), table_name='stockitem')
    op.drop_table('stockitem')
