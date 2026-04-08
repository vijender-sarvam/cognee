from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from cognee.infrastructure.engine import DataPoint
from cognee.modules.chunking.Chunker import Chunker

if TYPE_CHECKING:
    from cognee.modules.data.processing.parsers import DocumentParser


class Document(DataPoint):
    name: str
    raw_data_location: str
    external_metadata: Optional[str]
    mime_type: str
    metadata: dict = {"index_fields": ["name"]}

    async def read(
        self,
        chunker_cls: Chunker,
        max_chunk_size: int,
        document_parser: Optional[DocumentParser] = None,
    ):
        pass
