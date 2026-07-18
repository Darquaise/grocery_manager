"""kitchens (multi-household)

Introduce kitchens: `kitchen` (owned by a user), `kitchenmember` (role per
user), `accountinvite` (single-use registration codes), and a `kitchen_id` on
every domain table.

Data migration: all existing data is assigned to kitchen 1 ("Küche"), owned by
the first user (lowest id); every existing user becomes an admin member of it.
On a fresh database (no users yet) no kitchen is created.

Revision ID: e7a1c4d82f56
Revises: d5e8f2a1c9b3
Create Date: 2026-07-18 00:00:00.000000

"""
from collections.abc import Sequence
from datetime import UTC, datetime

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'e7a1c4d82f56'
down_revision: str | None = 'd5e8f2a1c9b3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Domain tables that become kitchen-scoped (StockItem stays product-scoped).
SCOPED_TABLES = ('category', 'location', 'product', 'shoppinglistitem', 'shoppingtrip')


def upgrade() -> None:
    op.create_table('kitchen',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('owner_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('kitchenmember',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('kitchen_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('role', sa.Enum('read', 'write', 'admin', name='kitchenrole'), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['kitchen_id'], ['kitchen.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('kitchen_id', 'user_id')
    )
    op.create_index(op.f('ix_kitchenmember_kitchen_id'), 'kitchenmember', ['kitchen_id'], unique=False)
    op.create_index(op.f('ix_kitchenmember_user_id'), 'kitchenmember', ['user_id'], unique=False)
    op.create_table('accountinvite',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('code', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('created_by', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('used_by', sa.Integer(), nullable=True),
    sa.Column('used_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['created_by'], ['user.id'], ),
    sa.ForeignKeyConstraint(['used_by'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_accountinvite_code'), 'accountinvite', ['code'], unique=True)

    # ── data migration: everything belongs to kitchen 1, owned by user 1 ────
    bind = op.get_bind()
    now = datetime.now(UTC)
    user_ids = [row[0] for row in bind.execute(sa.text('SELECT id FROM "user" ORDER BY id'))]
    kitchen_id = None
    if user_ids:
        bind.execute(
            sa.text('INSERT INTO kitchen (name, owner_id, created_at) VALUES (:name, :owner, :now)'),
            {'name': 'Küche', 'owner': user_ids[0], 'now': now},
        )
        kitchen_id = bind.execute(sa.text('SELECT max(id) FROM kitchen')).scalar()
        for user_id in user_ids:
            bind.execute(
                sa.text(
                    'INSERT INTO kitchenmember (kitchen_id, user_id, role, created_at) '
                    "VALUES (:kitchen, :user, 'admin', :now)"
                ),
                {'kitchen': kitchen_id, 'user': user_id, 'now': now},
            )

    for table in SCOPED_TABLES:
        op.add_column(table, sa.Column('kitchen_id', sa.Integer(), nullable=True))
        if kitchen_id is not None:
            bind.execute(
                sa.text(f'UPDATE {table} SET kitchen_id = :kitchen'),  # noqa: S608
                {'kitchen': kitchen_id},
            )
        # batch mode: SQLite (container smoke tests) cannot ALTER to NOT NULL in place
        with op.batch_alter_table(table) as batch:
            batch.alter_column('kitchen_id', existing_type=sa.Integer(), nullable=False)
            batch.create_foreign_key(f'fk_{table}_kitchen', 'kitchen', ['kitchen_id'], ['id'])
        op.create_index(op.f(f'ix_{table}_kitchen_id'), table, ['kitchen_id'], unique=False)


def downgrade() -> None:
    for table in reversed(SCOPED_TABLES):
        op.drop_index(op.f(f'ix_{table}_kitchen_id'), table_name=table)
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f'fk_{table}_kitchen', type_='foreignkey')
            batch.drop_column('kitchen_id')

    op.drop_index(op.f('ix_accountinvite_code'), table_name='accountinvite')
    op.drop_table('accountinvite')
    op.drop_index(op.f('ix_kitchenmember_user_id'), table_name='kitchenmember')
    op.drop_index(op.f('ix_kitchenmember_kitchen_id'), table_name='kitchenmember')
    op.drop_table('kitchenmember')
    op.drop_table('kitchen')

    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        sa.Enum(name='kitchenrole').drop(bind, checkfirst=True)
