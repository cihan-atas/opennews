"""rss_notification_rules.list_id nullable (Gündem kuralı için)

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-07-25 19:05:00.000000

Gündem bildirimi (scope="trending") bir RSS listesine bağlı değil; haber
gündemini ve kullanıcının tüm beslemelerini birlikte kapsıyor.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('rss_notification_rules', 'list_id',
                    existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    # Geri alırken listesiz (Gündem) kurallar anlamsız kalır — önce silinir.
    op.execute("DELETE FROM rss_notification_rules WHERE list_id IS NULL")
    op.alter_column('rss_notification_rules', 'list_id',
                    existing_type=sa.Integer(), nullable=False)
