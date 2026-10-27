"""Create local workspace schema."""
from alembic import op
revision="0001_local_workspace"
down_revision=None
branch_labels=None
depends_on=None
def upgrade():
    from app.db import init_db
    init_db()
def downgrade():
    # Local workspace data is intentionally preserved by downgrade.
    pass
