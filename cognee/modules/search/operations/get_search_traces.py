import json
from uuid import UUID

from sqlalchemy import select

from cognee.infrastructure.databases.relational import get_relational_engine
from ..models.SearchTrace import SearchTrace


async def get_search_traces(user_id: UUID, limit: int = 10) -> list[dict]:
    """Return the *limit* most-recent retrieval traces for *user_id*."""
    db_engine = get_relational_engine()

    async with db_engine.get_async_session() as session:
        rows = (
            await session.scalars(
                select(SearchTrace)
                .filter(SearchTrace.user_id == user_id)
                .order_by(SearchTrace.created_at.desc())
                .limit(limit)
            )
        ).all()

        result = []
        for row in rows:
            result.append(
                {
                    "id": str(row.id),
                    "query_id": str(row.query_id),
                    "query_text": row.query_text,
                    "search_type": row.search_type,
                    "dataset_name": row.dataset_name,
                    "total_duration_ms": row.total_duration_ms,
                    "steps": json.loads(row.steps) if row.steps else [],
                    "created_at": (
                        row.created_at.isoformat() if row.created_at else None
                    ),
                }
            )
        return result
