"""
Dataset database handler for ChromaDB (HTTP client-server).

All datasets share the same ChromaDB server instance. Isolation happens
at the collection level — each dataset's vectors are stored in
collections whose names incorporate the dataset identifier.
"""

from uuid import UUID
from typing import Optional

from cognee.infrastructure.databases.vector import get_vectordb_config
from cognee.modules.users.models import User, DatasetDatabase
from cognee.infrastructure.databases.dataset_database_handler import DatasetDatabaseHandlerInterface


class ChromaDBDatasetDatabaseHandler(DatasetDatabaseHandlerInterface):
    """Passthrough handler — every dataset maps to the shared ChromaDB server."""

    @classmethod
    async def create_dataset(cls, dataset_id: Optional[UUID], user: Optional[User]) -> dict:
        vector_config = get_vectordb_config()

        if vector_config.vector_db_provider != "chromadb":
            raise ValueError(
                "ChromaDBDatasetDatabaseHandler can only be used with the "
                "chromadb vector database provider."
            )

        return {
            "vector_database_provider": vector_config.vector_db_provider,
            "vector_database_url": vector_config.vector_db_url,
            "vector_database_key": vector_config.vector_db_key,
            "vector_database_name": str(dataset_id),
            "vector_dataset_database_handler": "chromadb",
        }

    @classmethod
    async def delete_dataset(cls, dataset_database: DatasetDatabase):
        pass
