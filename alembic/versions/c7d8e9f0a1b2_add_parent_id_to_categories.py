"""add parent_id to categories (hierarchical categories)

Revision ID: c7d8e9f0a1b2
Revises: ca743bf08dbc
Create Date: 2026-06-15 04:12:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, None] = 'ca743bf08dbc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('categories', sa.Column('parent_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_categories_parent_id'), 'categories', ['parent_id'], unique=False)
    op.create_foreign_key(
        'fk_categories_parent_id_categories',
        'categories', 'categories',
        ['parent_id'], ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint('fk_categories_parent_id_categories', 'categories', type_='foreignkey')
    op.drop_index(op.f('ix_categories_parent_id'), table_name='categories')
    op.drop_column('categories', 'parent_id')
