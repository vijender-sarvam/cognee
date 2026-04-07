import json
from typing import Optional
from uuid import UUID

from cognee.infrastructure.databases.relational import get_relational_engine
from ..models.SearchTrace import SearchTrace


async def log_search_trace(
    query_id: UUID,
    user_id: UUID,
    query_text: str,
    search_type: str,
    dataset_name: Optional[str],
    total_duration_ms: int,
    steps: list,
) -> None:
    db_engine = get_relational_engine()

    async with db_engine.get_async_session() as session:
        session.add(
            SearchTrace(
                query_id=query_id,
                user_id=user_id,
                query_text=query_text,
                search_type=search_type,
                dataset_name=dataset_name,
                total_duration_ms=total_duration_ms,
                steps=json.dumps(steps, default=str),
            )
        )
        await session.commit()
