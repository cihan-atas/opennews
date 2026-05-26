"""add news_id to podcasts

Revision ID: b6d5d849165c
Revises: ff8e34c881f7
Create Date: 2026-05-05 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b6d5d849165c'
down_revision: Union[str, None] = 'ff8e34c881f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('podcasts', sa.Column('news_id', sa.Integer(), nullable=True))
    op.create_foreign_key(None, 'podcasts', 'news', ['news_id'], ['id'])


def downgrade() -> None:
    op.drop_constraint(None, 'podcasts', type_='foreignkey')
    op.drop_column('podcasts', 'news_id')
