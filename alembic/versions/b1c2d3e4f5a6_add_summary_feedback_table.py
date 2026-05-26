"""add summary_feedback table

Revision ID: b1c2d3e4f5a6
Revises: a9c1d2e3f4b5
Create Date: 2026-05-23 00:01:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a9c1d2e3f4b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'summary_feedback',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('news_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('rating', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['news_id'], ['news.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_summary_feedback_id', 'summary_feedback', ['id'])
    op.create_index('ix_summary_feedback_news_user', 'summary_feedback', ['news_id', 'user_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_summary_feedback_news_user', table_name='summary_feedback')
    op.drop_index('ix_summary_feedback_id', table_name='summary_feedback')
    op.drop_table('summary_feedback')
