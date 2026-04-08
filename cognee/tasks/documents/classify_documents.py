from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from cognee.modules.data.models import Data
import json
from cognee.modules.pipelines.tasks.task import task_summary
from cognee.modules.data.processing.document_types import (
    Document,
    PdfDocument,
    AudioDocument,
    ImageDocument,
    TextDocument,
    UnstructuredDocument,
    CsvDocument,
    DltRowDocument,
)
from cognee.modules.engine.models.node_set import NodeSet
from cognee.modules.engine.utils.generate_node_id import generate_node_id
from cognee.tasks.documents.exceptions import WrongDataDocumentInputError
from cognee.tasks.ingestion.dlt_utils import is_dlt_sourced

if TYPE_CHECKING:
    from cognee.modules.data.processing.parsers import DocumentParser

EXTENSION_TO_DOCUMENT_CLASS = {
    "pdf": PdfDocument,  # Text documents
    "txt": TextDocument,
    "csv": CsvDocument,
    "docx": UnstructuredDocument,
    "doc": UnstructuredDocument,
    "odt": UnstructuredDocument,
    "xls": UnstructuredDocument,
    "xlsx": UnstructuredDocument,
    "ppt": UnstructuredDocument,
    "pptx": UnstructuredDocument,
    "odp": UnstructuredDocument,
    "ods": UnstructuredDocument,
    "png": ImageDocument,  # Image documents
    "dwg": ImageDocument,
    "xcf": ImageDocument,
    "jpg": ImageDocument,
    "jpx": ImageDocument,
    "apng": ImageDocument,
    "gif": ImageDocument,
    "webp": ImageDocument,
    "cr2": ImageDocument,
    "tif": ImageDocument,
    "bmp": ImageDocument,
    "jxr": ImageDocument,
    "psd": ImageDocument,
    "ico": ImageDocument,
    "heic": ImageDocument,
    "avif": ImageDocument,
    "aac": AudioDocument,  # Audio documents
    "mid": AudioDocument,
    "mp3": AudioDocument,
    "m4a": AudioDocument,
    "ogg": AudioDocument,
    "flac": AudioDocument,
    "wav": AudioDocument,
    "amr": AudioDocument,
    "aiff": AudioDocument,
}


def update_node_set(document):
    """
    Extracts node_set from document's external_metadata.

    Parses the external_metadata of the given document and updates the document's
    belongs_to_set attribute with NodeSet objects generated from the node_set found in the
    external_metadata. If the external_metadata is not valid JSON, is not a dictionary, does
    not contain the 'node_set' key, or if node_set is not a list, the function has no effect
    and will return early.

    Parameters:
    -----------

        - document: The document object which contains external_metadata from which the
          node_set will be extracted.
    """
    try:
        external_metadata = json.loads(document.external_metadata)
    except json.JSONDecodeError:
        return

    if not isinstance(external_metadata, dict):
        return

    if "node_set" not in external_metadata:
        return

    node_set = external_metadata["node_set"]
    if not isinstance(node_set, list):
        return

    document.belongs_to_set = [
        NodeSet(id=generate_node_id(f"NodeSet:{node_set_name}"), name=node_set_name)
        for node_set_name in node_set
    ]
    document.source_node_set = ", ".join(node_set)


@task_summary("Classified {n} document(s)")
async def classify_documents(
    data_documents: list[Data],
    document_parser: Optional[DocumentParser] = None,
) -> list[Document]:
    """
    Classifies a list of data items into specific document types based on their file
    extensions.

    When a *document_parser* is provided and the original file was a PDF that was
    pre-processed into plain text during the ADD step, the classifier uses the
    **original** extension and data location so that the chosen parser can operate
    on the raw PDF rather than the (possibly empty) extracted text.
    """
    if not isinstance(data_documents, list):
        raise WrongDataDocumentInputError("data_documents")

    documents = []
    for data_item in data_documents:
        if is_dlt_sourced(data_item):
            doc_class = DltRowDocument
            ext = data_item.extension
            location = data_item.raw_data_location
            mime = data_item.mime_type
        else:
            ext = data_item.extension
            location = data_item.raw_data_location
            mime = data_item.mime_type

            if (
                document_parser is not None
                and getattr(data_item, "original_extension", None)
                and data_item.original_extension != data_item.extension
                and data_item.original_extension in EXTENSION_TO_DOCUMENT_CLASS
            ):
                ext = data_item.original_extension
                location = data_item.original_data_location or location
                mime = data_item.original_mime_type or mime

            doc_class = EXTENSION_TO_DOCUMENT_CLASS[ext]

        document = doc_class(
            id=data_item.id,
            title=f"{data_item.name}.{ext}",
            raw_data_location=location,
            name=data_item.name,
            mime_type=mime,
            external_metadata=json.dumps(data_item.external_metadata, indent=4),
        )
        update_node_set(document)
        documents.append(document)

    return documents
