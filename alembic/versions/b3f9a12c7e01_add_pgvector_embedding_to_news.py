"""add pgvector embedding to news

Revision ID: b3f9a12c7e01
Revises: 6ca649c145da
Create Date: 2026-05-04 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b3f9a12c7e01'
down_revision: Union[str, None] = '6ca649c145da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pgvector extension'ı etkinleştir (zaten varsa sessizce geç)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    # 768 boyutlu embedding kolonu ekle (Gemini text-embedding-004)
    op.add_column('news', sa.Column('embedding', sa.Text(), nullable=True))
    op.execute("ALTER TABLE news ALTER COLUMN embedding TYPE vector(768) USING embedding::vector(768)")


def downgrade() -> None:
    op.drop_column('news', 'embedding')
