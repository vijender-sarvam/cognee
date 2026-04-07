from uuid import UUID

from sqlalchemy import delete

from cognee.infrastructure.databases.relational import get_relational_engine
from ..models.SearchTrace import SearchTrace


async def delete_search_traces(user_id: UUID) -> int:
    """Delete all retrieval traces for *user_id*. Returns the number of rows deleted."""
    db_engine = get_relational_engine()

    async with db_engine.get_async_session() as session:
        result = await session.execute(
            delete(SearchTrace).where(SearchTrace.user_id == user_id)
        )
        await session.commit()
        return result.rowcount
