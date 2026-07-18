"""kitchen invites + owner deletion support

`kitcheninvite`: pending invitations (membership starts on accept). The
account-registration codes (`accountinvite`) can optionally carry a kitchen +
role — registering with such a code creates a pending kitchen invite.

Revision ID: f3b9d2e61a07
Revises: e7a1c4d82f56
Create Date: 2026-07-18 01:30:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f3b9d2e61a07'
down_revision: str | None = 'e7a1c4d82f56'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _role_type() -> sa.types.TypeEngine:
    """The existing `kitchenrole` enum — must not be re-created on Postgres."""
    if op.get_bind().dialect.name == 'postgresql':
        return postgresql.ENUM('read', 'write', 'admin', name='kitchenrole', create_type=False)
    return sa.Enum('read', 'write', 'admin', name='kitchenrole')


def upgrade() -> None:
    op.create_table('kitcheninvite',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('kitchen_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('role', _role_type(), nullable=False),
    sa.Column('invited_by', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['kitchen_id'], ['kitchen.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
    sa.ForeignKeyConstraint(['invited_by'], ['user.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('kitchen_id', 'user_id')
    )
    op.create_index(op.f('ix_kitcheninvite_kitchen_id'), 'kitcheninvite', ['kitchen_id'], unique=False)
    op.create_index(op.f('ix_kitcheninvite_user_id'), 'kitcheninvite', ['user_id'], unique=False)

    op.add_column('accountinvite', sa.Column('kitchen_id', sa.Integer(), nullable=True))
    op.add_column('accountinvite', sa.Column('kitchen_role', _role_type(), nullable=True))
    with op.batch_alter_table('accountinvite') as batch:
        batch.create_foreign_key('fk_accountinvite_kitchen', 'kitchen', ['kitchen_id'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('accountinvite') as batch:
        batch.drop_constraint('fk_accountinvite_kitchen', type_='foreignkey')
        batch.drop_column('kitchen_role')
        batch.drop_column('kitchen_id')

    op.drop_index(op.f('ix_kitcheninvite_user_id'), table_name='kitcheninvite')
    op.drop_index(op.f('ix_kitcheninvite_kitchen_id'), table_name='kitcheninvite')
    op.drop_table('kitcheninvite')
