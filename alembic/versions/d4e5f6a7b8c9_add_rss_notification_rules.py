"""add rss notification rules, rule feeds and seen articles

Revision ID: d4e5f6a7b8c9
Revises: c7d8e9f0a1b2
Create Date: 2026-07-25 17:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c7d8e9f0a1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'rss_notification_rules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('list_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('scope', sa.String(), nullable=False, server_default='all'),
        sa.Column('mode', sa.String(), nullable=False, server_default='immediate'),
        sa.Column('interval_minutes', sa.Integer(), nullable=True),
        sa.Column('grouping', sa.String(), nullable=False, server_default='digest'),
        sa.Column('last_checked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['list_id'], ['user_rss_lists.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_rss_notification_rules_id'), 'rss_notification_rules', ['id'])
    op.create_index(op.f('ix_rss_notification_rules_user_id'), 'rss_notification_rules', ['user_id'])
    op.create_index(op.f('ix_rss_notification_rules_list_id'), 'rss_notification_rules', ['list_id'])

    op.create_table(
        'rss_notification_rule_feeds',
        sa.Column('rule_id', sa.Integer(), nullable=False),
        sa.Column('feed_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['rule_id'], ['rss_notification_rules.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['feed_id'], ['user_rss_feeds.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('rule_id', 'feed_id'),
    )

    op.create_table(
        'rss_seen_articles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('rule_id', sa.Integer(), nullable=False),
        sa.Column('link_hash', sa.String(), nullable=False),
        sa.Column('link', sa.String(), nullable=False),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('feed_title', sa.String(), nullable=True),
        sa.Column('feed_url', sa.String(), nullable=True),
        sa.Column('published', sa.String(), nullable=True),
        sa.Column('seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['rule_id'], ['rss_notification_rules.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('rule_id', 'link_hash', name='uq_rss_seen_rule_link'),
    )
    op.create_index(op.f('ix_rss_seen_articles_id'), 'rss_seen_articles', ['id'])
    op.create_index(op.f('ix_rss_seen_articles_rule_id'), 'rss_seen_articles', ['rule_id'])
    op.create_index(op.f('ix_rss_seen_articles_link_hash'), 'rss_seen_articles', ['link_hash'])
    op.create_index(op.f('ix_rss_seen_articles_seen_at'), 'rss_seen_articles', ['seen_at'])


def downgrade() -> None:
    op.drop_table('rss_seen_articles')
    op.drop_table('rss_notification_rule_feeds')
    op.drop_table('rss_notification_rules')
