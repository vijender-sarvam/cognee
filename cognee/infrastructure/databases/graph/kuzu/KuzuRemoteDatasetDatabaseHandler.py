"""
Dataset database handler for Kuzu Remote (REST API server).

Each dataset gets a unique database name on the remote server,
giving per-dataset graph isolation without the file-locking issues of
embedded Kuzu.
"""

from uuid import UUID
from typing import Optional

from cognee.infrastructure.databases.graph.config import get_graph_config
from cognee.infrastructure.databases.graph.get_graph_engine import create_graph_engine
from cognee.modules.users.models import User, DatasetDatabase
from cognee.infrastructure.databases.dataset_database_handler import DatasetDatabaseHandlerInterface


class KuzuRemoteDatasetDatabaseHandler(DatasetDatabaseHandlerInterface):
    """Handler that maps each dataset to its own database on the Kuzu Remote server."""

    @classmethod
    async def create_dataset(cls, dataset_id: Optional[UUID], user: Optional[User]) -> dict:
        graph_config = get_graph_config()

        if graph_config.graph_database_provider != "kuzu-remote":
            raise ValueError(
                "KuzuRemoteDatasetDatabaseHandler can only be used with the "
                "kuzu-remote graph database provider."
            )

        graph_db_name = str(dataset_id)

        return {
            "graph_database_name": graph_db_name,
            "graph_database_url": graph_config.graph_database_url,
            "graph_database_provider": "kuzu-remote",
            "graph_database_key": graph_config.graph_database_key,
            "graph_dataset_database_handler": "kuzu-remote",
            "graph_database_connection_info": {
                "graph_database_username": graph_config.graph_database_username,
                "graph_database_password": graph_config.graph_database_password,
            },
        }

    @classmethod
    async def delete_dataset(cls, dataset_database: DatasetDatabase):
        graph_engine = create_graph_engine(
            graph_database_provider=dataset_database.graph_database_provider,
            graph_database_url=dataset_database.graph_database_url,
            graph_database_name=dataset_database.graph_database_name,
            graph_database_key=dataset_database.graph_database_key,
            graph_file_path="",
            graph_database_username=dataset_database.graph_database_connection_info.get(
                "graph_database_username", ""
            ),
            graph_database_password=dataset_database.graph_database_connection_info.get(
                "graph_database_password", ""
            ),
            graph_dataset_database_handler="",
            graph_database_port="",
        )
        await graph_engine.delete_graph()
