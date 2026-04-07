from uuid import uuid4
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Integer, String, Text, UUID
from cognee.infrastructure.databases.relational import Base


class SearchTrace(Base):
    """Per-search retrieval trace.  Each row captures the step-by-step pipeline
    for one (query, dataset) pair so the debug UI can visualise what happened."""

    __tablename__ = "search_traces"

    id = Column(UUID, primary_key=True, default=uuid4)

    query_id = Column(UUID, index=True)
    user_id = Column(UUID, index=True)

    query_text = Column(Text)
    search_type = Column(String)
    dataset_name = Column(String, nullable=True)
    total_duration_ms = Column(Integer, nullable=True)

    # JSON-encoded list of step dicts: [{name, label, order, duration_ms, result_count,
    #   result_preview, status, error?}, ...]
    steps = Column(Text)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
