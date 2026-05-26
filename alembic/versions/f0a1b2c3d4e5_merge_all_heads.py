from typing import Sequence, Union
from alembic import op

revision: str = 'f0a1b2c3d4e5'
down_revision: Union[str, None] = ('d3e4f5a6b7c8', 'e1f2a3b4c5d6', '54c3d0d13471')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
