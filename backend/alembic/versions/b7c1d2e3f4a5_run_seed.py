"""run seed

Revision ID: b7c1d2e3f4a5
Revises: f4045f1ce6ea
Create Date: 2026-11-08 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b7c1d2e3f4a5'
down_revision: Union[str, Sequence[str], None] = 'f4045f1ce6ea'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('runs', sa.Column('seed', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('runs', 'seed')
