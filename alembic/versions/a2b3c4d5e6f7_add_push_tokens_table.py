"""add push_tokens table

Revision ID: a2b3c4d5e6f7
Revises: f0a1b2c3d4e5, f8604c70b4f0, ff8e34c881f7
Create Date: 2026-05-27 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, tuple] = ('f0a1b2c3d4e5', 'f8604c70b4f0', 'ff8e34c881f7')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'push_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(), nullable=False),
        sa.Column('platform', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token'),
    )
    op.create_index('ix_push_tokens_id', 'push_tokens', ['id'])
    op.create_index('ix_push_tokens_token', 'push_tokens', ['token'])


def downgrade() -> None:
    op.drop_index('ix_push_tokens_token', table_name='push_tokens')
    op.drop_index('ix_push_tokens_id', table_name='push_tokens')
    op.drop_table('push_tokens')
