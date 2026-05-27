"""add podcast transcript column

Revision ID: a1b2c3d4e5f6
Revises: f0a1b2c3d4e5
Create Date: 2026-05-27
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'f0a1b2c3d4e5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('podcasts', sa.Column('transcript', sa.String(), nullable=True))


def downgrade():
    op.drop_column('podcasts', 'transcript')
