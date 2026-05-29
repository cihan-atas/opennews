"""add vector support and user clicks

Revision ID: ff8e34c881f7
Revises: b3f9a12c7e01
Create Date: 2026-05-05 19:27:43.772627

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector

# revision identifiers, used by Alembic.
revision: str = 'ff8e34c881f7'
down_revision: Union[str, None] = 'b3f9a12c7e01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
