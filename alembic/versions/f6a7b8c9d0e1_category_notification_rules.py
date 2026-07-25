"""rss_notification_rules.category_id (Akış kategori bildirimleri)

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-07-25 22:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rss_notification_rules', sa.Column('category_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_rss_notification_rules_category_id'),
                    'rss_notification_rules', ['category_id'])
    op.create_foreign_key('fk_rss_rules_category', 'rss_notification_rules', 'categories',
                          ['category_id'], ['id'], ondelete='CASCADE')


def downgrade() -> None:
    op.drop_constraint('fk_rss_rules_category', 'rss_notification_rules', type_='foreignkey')
    op.drop_index(op.f('ix_rss_notification_rules_category_id'), table_name='rss_notification_rules')
    op.drop_column('rss_notification_rules', 'category_id')
