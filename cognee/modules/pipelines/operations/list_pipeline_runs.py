from uuid import UUID

from sqlalchemy import select, func

from cognee.infrastructure.databases.relational import get_relational_engine
from cognee.modules.pipelines.models.PipelineRun import PipelineRun


async def list_pipeline_runs(dataset_ids: list[UUID], limit: int = 50) -> list[PipelineRun]:
    """Return one row per dataset (newest first) with the latest overall status.

    Multiple internal pipeline steps (add, cognify, etc.) are collapsed
    into a single entry so the caller sees one status per dataset.
    """
    db_engine = get_relational_engine()

    async with db_engine.get_async_session() as session:
        latest = (
            select(
                PipelineRun.dataset_id,
                func.max(PipelineRun.created_at).label("max_created_at"),
            )
            .filter(PipelineRun.dataset_id.in_(dataset_ids))
            .group_by(PipelineRun.dataset_id)
            .subquery()
        )

        query = (
            select(PipelineRun)
            .join(
                latest,
                (PipelineRun.dataset_id == latest.c.dataset_id)
                & (PipelineRun.created_at == latest.c.max_created_at),
            )
            .order_by(PipelineRun.created_at.desc())
            .limit(limit)
        )
        result = await session.execute(query)
        return list(result.scalars().all())
