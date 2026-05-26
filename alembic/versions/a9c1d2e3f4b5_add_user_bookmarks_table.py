"""add user_bookmarks table

Revision ID: a9c1d2e3f4b5
Revises: ff8e34c881f7
Create Date: 2026-05-23 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a9c1d2e3f4b5'
down_revision: Union[str, None] = 'b6d5d849165c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_bookmarks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('news_id', sa.Integer(), nullable=False),
        sa.Column('saved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['news_id'], ['news.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_user_bookmarks_id', 'user_bookmarks', ['id'])
    op.create_index('ix_user_bookmarks_user_news', 'user_bookmarks', ['user_id', 'news_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_user_bookmarks_user_news', table_name='user_bookmarks')
    op.drop_index('ix_user_bookmarks_id', table_name='user_bookmarks')
    op.drop_table('user_bookmarks')
