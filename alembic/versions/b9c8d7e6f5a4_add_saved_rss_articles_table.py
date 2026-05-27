"""add saved rss articles table

Revision ID: b9c8d7e6f5a4
Revises: a1b2c3d4e5f6
Create Date: 2026-05-27
"""
from alembic import op
import sqlalchemy as sa

revision = 'b9c8d7e6f5a4'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'saved_rss_articles',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('link', sa.String(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('feed_title', sa.String(), nullable=True),
        sa.Column('feed_url', sa.String(), nullable=True),
        sa.Column('published', sa.String(), nullable=True),
        sa.Column('saved_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table('saved_rss_articles')
