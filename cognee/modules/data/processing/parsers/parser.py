"""
Pluggable document-parser abstraction.

Parsers are responsible for extracting raw text from a file stream.
They are decoupled from chunking — the chunker receives the text segments
produced by the parser and splits them into semantic chunks.

Built-in parsers:
    - ``pypdf``         — Pure-Python PDF text extraction (default, no extra deps).
    - ``unstructured``  — Uses the ``unstructured`` library; handles tables,
                          layout-aware extraction, and many more formats.
                          Requires: ``pip install cognee[docs]``

Custom parsers:
    Subclass ``DocumentParser``, implement ``extract_text``, and register::

        from cognee.modules.data.processing.parsers import register_parser

        class MyParser(DocumentParser):
            async def extract_text(self, stream, mime_type):
                yield my_custom_extraction(stream)

        register_parser("my_parser", MyParser)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncGenerator, BinaryIO, Dict, Type


class DocumentParser(ABC):
    """Base class for document parsers."""

    @abstractmethod
    async def extract_text(
        self, stream: BinaryIO, mime_type: str
    ) -> AsyncGenerator[str, None]:
        """Yield text segments extracted from *stream*."""
        ...  # pragma: no cover
        yield  # make this a valid async generator for subclasses


# ---------------------------------------------------------------------------
# Built-in implementations
# ---------------------------------------------------------------------------


class PyPdfParser(DocumentParser):
    """Default PDF parser using pypdf."""

    async def extract_text(self, stream, mime_type):
        from pypdf import PdfReader

        reader = PdfReader(stream, strict=False)
        for page in reader.pages:
            text = page.extract_text()
            if text:
                yield text


class UnstructuredParser(DocumentParser):
    """Parser backed by the ``unstructured`` library (pip install cognee[docs])."""

    async def extract_text(self, stream, mime_type):
        try:
            from unstructured.partition.auto import partition
        except ModuleNotFoundError:
            raise ImportError(
                "The 'unstructured' package is required for this parser. "
                "Install it with: pip install cognee[docs]"
            )

        elements = partition(file=stream, content_type=mime_type)
        text = "\n\n".join(str(el) for el in elements)
        if text:
            yield text


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_PARSER_REGISTRY: Dict[str, Type[DocumentParser]] = {
    "pypdf": PyPdfParser,
    "unstructured": UnstructuredParser,
}

# Lazy-register parsers that have external deps so they don't fail at import time
def _register_lazy_parsers():
    from cognee.modules.data.processing.parsers.sarvam_parser import SarvamOcrParser

    _PARSER_REGISTRY["sarvam"] = SarvamOcrParser


try:
    _register_lazy_parsers()
except Exception:
    pass


def register_parser(name: str, parser_cls: Type[DocumentParser]) -> None:
    """Register a custom parser under *name*."""
    _PARSER_REGISTRY[name] = parser_cls


def get_parser(name: str | None = None, **kwargs) -> DocumentParser:
    """Instantiate a parser by name.  Defaults to ``pypdf``.

    Extra *kwargs* are forwarded to the parser constructor (e.g.
    ``get_parser("sarvam", language="od-IN")``).
    """
    name = name or "pypdf"
    cls = _PARSER_REGISTRY.get(name)
    if cls is None:
        available = ", ".join(sorted(_PARSER_REGISTRY))
        raise ValueError(f"Unknown document parser '{name}'. Available: {available}")
    return cls(**kwargs)


def list_parsers() -> list[str]:
    """Return the names of all registered parsers."""
    return sorted(_PARSER_REGISTRY)
