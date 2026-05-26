from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'b6d5d849165c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('podcasts', sa.Column('source_url', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('podcasts', 'source_url')
