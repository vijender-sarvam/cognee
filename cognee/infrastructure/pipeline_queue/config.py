from functools import lru_cache
from typing import Literal, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class PipelineQueueConfig(BaseSettings):
    """
    Configuration for the pipeline task queue backend.

    Attributes:
    - pipeline_queue_backend: "memory" uses in-process asyncio tasks (default, no extra deps).
      "arq" uses ARQ workers backed by Redis for cross-process, persistent job execution.

    Redis connection (only used when pipeline_queue_backend="arq"):
    - pipeline_queue_redis_host: Redis host for the ARQ job queue.
    - pipeline_queue_redis_port: Redis port for the ARQ job queue.
    - pipeline_queue_redis_username: Redis username (optional).
    - pipeline_queue_redis_password: Redis password (optional).
    - pipeline_queue_redis_db: Redis logical database index (default 0).
    """

    pipeline_queue_backend: Literal["memory", "arq"] = "memory"

    pipeline_queue_redis_host: str = "localhost"
    pipeline_queue_redis_port: int = 6379
    pipeline_queue_redis_username: Optional[str] = None
    pipeline_queue_redis_password: Optional[str] = None
    pipeline_queue_redis_db: int = 0

    model_config = SettingsConfigDict(env_file=".env", extra="allow")


@lru_cache
def get_pipeline_queue_config() -> PipelineQueueConfig:
    return PipelineQueueConfig()
