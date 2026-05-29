"""add is_admin to users and title to community_rss_sources

Revision ID: a1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-05-29

"""
from typing import Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = 'f0a1b2c3d4e5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_admin', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('community_rss_sources', sa.Column('title', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('community_rss_sources', 'title')
    op.drop_column('users', 'is_admin')
