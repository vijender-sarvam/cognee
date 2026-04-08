"""
ARQ-based pipeline worker.

Start the worker with:
    arq cognee.infrastructure.pipeline_queue.arq_worker.WorkerSettings

Required environment variables (in addition to normal Cognee config):
    PIPELINE_QUEUE_BACKEND=arq
    PIPELINE_QUEUE_REDIS_HOST=localhost
    PIPELINE_QUEUE_REDIS_PORT=6379
    PIPELINE_QUEUE_REDIS_PASSWORD=<optional>
    PIPELINE_QUEUE_REDIS_USERNAME=<optional>
    PIPELINE_QUEUE_REDIS_DB=0
"""

import pickle
from uuid import UUID
from typing import Any, Dict, List, Optional

from cognee.shared.logging_utils import get_logger

logger = get_logger("arq_worker")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_redis_settings():
    """Build ARQ RedisSettings from PipelineQueueConfig (PIPELINE_QUEUE_REDIS_* env vars)."""
    try:
        from arq.connections import RedisSettings
    except ImportError as exc:
        raise ImportError(
            "ARQ is required for the redis queue backend. "
            "Install it with: pip install cognee[queue]"
        ) from exc

    from cognee.infrastructure.pipeline_queue.config import get_pipeline_queue_config

    cfg = get_pipeline_queue_config()
    return RedisSettings(
        host=cfg.pipeline_queue_redis_host,
        port=cfg.pipeline_queue_redis_port,
        username=cfg.pipeline_queue_redis_username,
        password=cfg.pipeline_queue_redis_password,
        database=cfg.pipeline_queue_redis_db,
    )


async def get_arq_redis_pool():
    """Return an ArqRedis connection pool suitable for enqueuing jobs."""
    try:
        from arq import create_pool
    except ImportError as exc:
        raise ImportError(
            "ARQ is required for the redis queue backend. "
            "Install it with: pip install cognee[queue]"
        ) from exc

    return await create_pool(
        _get_redis_settings(),
        job_serializer=pickle.dumps,
        job_deserializer=pickle.loads,
    )


async def _get_user_by_id(user_id: UUID):
    """Fetch a User row by primary key — used inside the worker process."""
    from sqlalchemy.future import select
    from sqlalchemy.orm import selectinload

    from cognee.modules.users.models import User
    from cognee.infrastructure.databases.relational import get_relational_engine

    db_engine = get_relational_engine()
    async with db_engine.get_async_session() as session:
        query = (
            select(User)
            .options(selectinload(User.roles), selectinload(User.tenants))
            .where(User.id == user_id)
        )
        result = await session.execute(query)
        return result.scalars().first()


# ---------------------------------------------------------------------------
# ARQ job function
# ---------------------------------------------------------------------------


async def run_pipeline_task(
    ctx: Dict[str, Any],
    *,
    tasks: list,
    user_id: UUID,
    datasets: List[UUID],
    pipeline_name: str,
    vector_db_config: Optional[dict] = None,
    graph_db_config: Optional[dict] = None,
    incremental_loading: bool = False,
    use_pipeline_cache: bool = True,
    data_per_batch: int = 20,
):
    """
    ARQ job: runs the full pipeline for the given datasets and publishes every
    PipelineRunInfo event to the Redis pub/sub channel ``pipeline:{pipeline_run_id}``.

    DB status rows (STARTED / COMPLETED / ERRORED) are written by the pipeline
    itself via the existing log_pipeline_run_* helpers — no changes needed there.
    """
    from cognee.modules.pipelines.operations.pipeline import run_pipeline

    redis = ctx["redis"]
    user = await _get_user_by_id(user_id)

    if user is None:
        logger.error("ARQ worker: user %s not found, aborting pipeline task.", user_id)
        return

    logger.info(
        "ARQ worker starting pipeline '%s' for datasets %s (user %s)",
        pipeline_name,
        datasets,
        user_id,
    )

    async for event in run_pipeline(
        tasks=tasks,
        datasets=datasets,
        user=user,
        pipeline_name=pipeline_name,
        vector_db_config=vector_db_config,
        graph_db_config=graph_db_config,
        incremental_loading=incremental_loading,
        use_pipeline_cache=use_pipeline_cache,
        data_per_batch=data_per_batch,
    ):
        channel = f"pipeline:{event.pipeline_run_id}"
        payload = event.model_dump_json()
        await redis.publish(channel, payload)
        logger.debug("Published %s to %s", event.status, channel)

    logger.info("ARQ worker finished pipeline '%s' for datasets %s", pipeline_name, datasets)


# ---------------------------------------------------------------------------
# Worker settings
# ---------------------------------------------------------------------------


class WorkerSettings:
    """
    ARQ WorkerSettings class.

    Start the worker:
        arq cognee.infrastructure.pipeline_queue.arq_worker.WorkerSettings

    Uses pickle for job serialization so that Task objects (which wrap
    module-level callables) survive the API-process → worker round-trip.
    """

    functions = [run_pipeline_task]
    redis_settings = _get_redis_settings()

    # Pickle lets us pass Task objects and Pydantic models without custom encoders.
    job_serializer = pickle.dumps
    job_deserializer = pickle.loads

    max_jobs = 10
    job_timeout = 3600  # 1 hour per pipeline run
    keep_result = 3600  # Keep job result in Redis for 1 hour
