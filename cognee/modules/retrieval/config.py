from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class RetrievalConfig(BaseSettings):
    """
    Configuration for the retrieval pipeline.

    Attributes:
    - vector_search_top_k: Number of candidates fetched from each vector collection during
      the initial wide search phase (used by GRAPH_COMPLETION and related modes).
      Smaller values are faster but may miss relevant nodes; larger values improve recall
      at the cost of more computation. Default: 10.
    """

    vector_search_top_k: int = 10

    model_config = SettingsConfigDict(env_file=".env", extra="allow")


@lru_cache
def get_retrieval_config() -> RetrievalConfig:
    return RetrievalConfig()
