from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from cognee.shared.logging_utils import get_logger
from cognee.modules.chunking.Chunker import Chunker
from cognee.infrastructure.files.utils.open_data_file import open_data_file

from .Document import Document

if TYPE_CHECKING:
    from cognee.modules.data.processing.parsers import DocumentParser

logger = get_logger("PDFDocument")


class PdfDocument(Document):
    type: str = "pdf"

    async def read(
        self,
        chunker_cls: Chunker,
        max_chunk_size: int,
        document_parser: Optional[DocumentParser] = None,
    ):
        from cognee.modules.data.processing.parsers import get_parser

        parser = document_parser or get_parser("pypdf")

        async with open_data_file(self.raw_data_location, mode="rb") as stream:
            logger.info(
                f"Reading PDF: {self.raw_data_location} (parser={type(parser).__name__})"
            )

            async def get_text():
                async for text in parser.extract_text(stream, self.mime_type):
                    yield text

            chunker = chunker_cls(self, get_text=get_text, max_chunk_size=max_chunk_size)

            async for chunk in chunker.read():
                yield chunk
