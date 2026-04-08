from cognee.infrastructure.databases.graph.neo4j_driver.Neo4jAuraDevDatasetDatabaseHandler import (
    Neo4jAuraDevDatasetDatabaseHandler,
)
from cognee.infrastructure.databases.vector.lancedb.LanceDBDatasetDatabaseHandler import (
    LanceDBDatasetDatabaseHandler,
)
from cognee.infrastructure.databases.vector.chromadb.ChromaDBDatasetDatabaseHandler import (
    ChromaDBDatasetDatabaseHandler,
)
from cognee.infrastructure.databases.graph.kuzu.KuzuDatasetDatabaseHandler import (
    KuzuDatasetDatabaseHandler,
)
from cognee.infrastructure.databases.graph.kuzu.KuzuRemoteDatasetDatabaseHandler import (
    KuzuRemoteDatasetDatabaseHandler,
)
from cognee.infrastructure.databases.vector.pgvector.PGVectorDatasetDatabaseHandler import (
    PGVectorDatasetDatabaseHandler,
)

supported_dataset_database_handlers = {
    "neo4j_aura_dev": {
        "handler_instance": Neo4jAuraDevDatasetDatabaseHandler,
        "handler_provider": "neo4j",
    },
    "lancedb": {"handler_instance": LanceDBDatasetDatabaseHandler, "handler_provider": "lancedb"},
    "chromadb": {
        "handler_instance": ChromaDBDatasetDatabaseHandler,
        "handler_provider": "chromadb",
    },
    "pgvector": {
        "handler_instance": PGVectorDatasetDatabaseHandler,
        "handler_provider": "pgvector",
    },
    "kuzu": {"handler_instance": KuzuDatasetDatabaseHandler, "handler_provider": "kuzu"},
    "kuzu-remote": {
        "handler_instance": KuzuRemoteDatasetDatabaseHandler,
        "handler_provider": "kuzu-remote",
    },
}
