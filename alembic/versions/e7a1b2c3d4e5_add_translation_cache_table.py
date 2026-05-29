"""add translation_cache table

Revision ID: e7a1b2c3d4e5
Revises: d2e3f4a5b6c7
Create Date: 2026-05-29 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'e7a1b2c3d4e5'
down_revision: Union[str, None] = 'd2e3f4a5b6c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'translation_cache',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('source_hash', sa.String(), nullable=False),
        sa.Column('target_lang', sa.String(), nullable=False),
        sa.Column('translated_text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_translation_cache_id', 'translation_cache', ['id'])
    op.create_index('ix_translation_cache_source_hash', 'translation_cache', ['source_hash'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_translation_cache_source_hash', table_name='translation_cache')
    op.drop_index('ix_translation_cache_id', table_name='translation_cache')
    op.drop_table('translation_cache')
