"""
Sarvam Document Intelligence OCR parser.

Uses the Sarvam async job API to digitise PDFs into markdown:
    1. Create job  → get ``job_id``
    2. Get upload URL → PUT raw PDF bytes to presigned URL
    3. Start job
    4. Poll status until ``Completed`` / ``PartiallyCompleted`` / ``Failed``
    5. Download result ZIP → extract ``.md`` file

PDFs longer than ``SARVAM_MAX_PAGES`` (default 10) are split into
smaller chunks locally with pypdf, each processed as a separate job.

Configuration (environment variables):
    SARVAM_API_KEY          — subscription key for the API
    SARVAM_OCR_BASE_URL     — API base (default: https://api.sarvam.ai/doc-digitization/job/v1)

Requires: aiohttp (already a cognee dependency), pypdf
"""

from __future__ import annotations

import io
import os
import re
import asyncio
import logging
import zipfile
from typing import BinaryIO, AsyncGenerator

import aiohttp

from .parser import DocumentParser

_BASE64_IMG_RE = re.compile(
    r"!\[[^\]]*\]\(data:image/[^;]+;base64,[A-Za-z0-9+/\n=]+\)",
    re.DOTALL,
)

logger = logging.getLogger("sarvam_parser")

SARVAM_MAX_PAGES = 10
SARVAM_MAX_CONCURRENT_JOBS = 10
POLL_INTERVAL = 5
MAX_POLLS = 120
MAX_RETRIES = 4
RETRY_BACKOFF_BASE = 2
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=60)


def _get_config():
    api_key = os.environ.get("SARVAM_API_KEY", "")
    base_url = os.environ.get(
        "SARVAM_OCR_BASE_URL",
        "https://api.sarvam.ai/doc-digitization/job/v1",
    )
    return api_key, base_url


def _split_pdf_bytes(pdf_bytes: bytes) -> list[tuple[bytes, int]]:
    """Split a PDF into ≤SARVAM_MAX_PAGES chunks using pypdf.

    Returns list of (chunk_bytes, start_page_1based).
    """
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(pdf_bytes))
    total = len(reader.pages)

    if total <= SARVAM_MAX_PAGES:
        return [(pdf_bytes, 1)]

    chunks: list[tuple[bytes, int]] = []
    for start in range(0, total, SARVAM_MAX_PAGES):
        end = min(start + SARVAM_MAX_PAGES, total)
        writer = PdfWriter()
        for i in range(start, end):
            writer.add_page(reader.pages[i])

        buf = io.BytesIO()
        writer.write(buf)
        chunks.append((buf.getvalue(), start + 1))
        logger.info("Split chunk: pages %d-%d", start + 1, end)

    return chunks


def _strip_base64_images(md: str) -> str:
    """Remove inline base64-encoded images that blow up the text chunker."""
    return _BASE64_IMG_RE.sub("", md)


async def _request_with_retry(
    session: aiohttp.ClientSession,
    method: str,
    url: str,
    **kwargs,
) -> aiohttp.ClientResponse:
    """Fire an HTTP request with retries on 429 and transient errors."""
    kwargs.setdefault("timeout", REQUEST_TIMEOUT)

    for attempt in range(MAX_RETRIES):
        try:
            resp = await session.request(method, url, **kwargs)
            if resp.status == 429:
                retry_after = int(resp.headers.get("Retry-After", RETRY_BACKOFF_BASE**attempt))
                logger.warning("Rate limited (429), retrying in %ds (attempt %d)", retry_after, attempt + 1)
                resp.release()
                await asyncio.sleep(retry_after)
                continue
            resp.raise_for_status()
            return resp
        except (aiohttp.ServerDisconnectedError, aiohttp.ClientOSError, asyncio.TimeoutError) as exc:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = RETRY_BACKOFF_BASE**attempt
            logger.warning("%s %s attempt %d failed (%s), retrying in %ds", method, url, attempt + 1, exc, wait)
            await asyncio.sleep(wait)

    raise RuntimeError(f"All {MAX_RETRIES} retries exhausted for {method} {url}")


SARVAM_LANGUAGES = {
    "hi-IN": "Hindi",
    "en-IN": "English",
    "bn-IN": "Bengali",
    "gu-IN": "Gujarati",
    "kn-IN": "Kannada",
    "ml-IN": "Malayalam",
    "mr-IN": "Marathi",
    "or-IN": "Odia",
    "pa-IN": "Punjabi",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
    "ur-IN": "Urdu",
    "as-IN": "Assamese",
    "bodo-IN": "Bodo",
    "doi-IN": "Dogri",
    "ks-IN": "Kashmiri",
    "kok-IN": "Konkani",
    "mai-IN": "Maithili",
    "mni-IN": "Manipuri",
    "ne-IN": "Nepali",
    "sa-IN": "Sanskrit",
    "sat-IN": "Santali",
    "sd-IN": "Sindhi",
}


class SarvamOcrParser(DocumentParser):
    """PDF parser using Sarvam Document Intelligence OCR API."""

    def __init__(self, language: str = "en-IN"):
        self.language = language

    async def extract_text(
        self, stream: BinaryIO, mime_type: str
    ) -> AsyncGenerator[str, None]:
        api_key, base_url = _get_config()
        if not api_key:
            raise ValueError(
                "SARVAM_API_KEY environment variable is required for the sarvam parser"
            )

        pdf_bytes = stream.read()
        chunks = _split_pdf_bytes(pdf_bytes)

        headers = {
            "api-subscription-key": api_key,
            "Content-Type": "application/json",
        }

        semaphore = asyncio.Semaphore(SARVAM_MAX_CONCURRENT_JOBS)

        async def _limited_parse(idx: int, chunk_bytes: bytes, start_page: int) -> str:
            chunk_name = f"document_part{idx + 1}.pdf"
            async with semaphore:
                logger.info(
                    "Parsing chunk %d/%d (pages from %d)",
                    idx + 1, len(chunks), start_page,
                )
                return await self._parse_single(
                    session, base_url, headers, api_key,
                    chunk_bytes, chunk_name, language=self.language,
                )

        async with aiohttp.ClientSession() as session:
            results = await asyncio.gather(
                *(
                    _limited_parse(i, chunk_bytes, start_page)
                    for i, (chunk_bytes, start_page) in enumerate(chunks)
                ),
                return_exceptions=True,
            )

        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.error("Chunk %d/%d failed: %s", i + 1, len(chunks), result)
                continue
            if result:
                md = _strip_base64_images(result)
                if md.strip():
                    yield md

    async def _parse_single(
        self,
        session: "aiohttp.ClientSession",
        base_url: str,
        headers: dict,
        api_key: str,
        pdf_bytes: bytes,
        filename: str,
        language: str = "en-IN",
    ) -> str:
        # 1. Create job
        logger.info("Creating Sarvam job for %s", filename)
        resp = await _request_with_retry(
            session, "POST", base_url,
            json={"job_parameters": {"language": language, "output_format": "md"}},
            headers=headers,
        )
        job_data = await resp.json()
        job_id = job_data["job_id"]
        logger.info("Created job %s", job_id)

        # 2. Get upload URL
        resp = await _request_with_retry(
            session, "POST", f"{base_url}/upload-files",
            json={"job_id": job_id, "files": [filename]},
            headers=headers,
        )
        upload_data = await resp.json()
        upload_url = upload_data["upload_urls"][filename]["file_url"]

        # 3. Upload PDF to presigned URL
        logger.info("Uploading %s (%d bytes)", filename, len(pdf_bytes))
        upload_headers: dict[str, str] = {"Content-Type": "application/pdf"}
        if "blob.core.windows.net" in upload_url:
            upload_headers["x-ms-blob-type"] = "BlockBlob"

        resp = await _request_with_retry(
            session, "PUT", upload_url,
            data=pdf_bytes, headers=upload_headers,
        )
        resp.release()

        # 4. Start job
        logger.info("Starting job %s", job_id)
        resp = await _request_with_retry(
            session, "POST", f"{base_url}/{job_id}/start",
            headers=headers,
        )
        resp.release()

        # 5. Poll + download
        return await self._poll_and_download(session, base_url, headers, api_key, job_id)

    async def _poll_and_download(
        self,
        session: "aiohttp.ClientSession",
        base_url: str,
        headers: dict,
        api_key: str,
        job_id: str,
    ) -> str:
        poll_headers = {"api-subscription-key": api_key}

        for attempt in range(MAX_POLLS):
            resp = await _request_with_retry(
                session, "GET", f"{base_url}/{job_id}/status",
                headers=poll_headers,
            )
            status_data = await resp.json()
            state = status_data["job_state"]

            logger.info("Job %s status: %s (poll %d)", job_id, state, attempt + 1)

            if state == "Completed":
                break
            elif state == "PartiallyCompleted":
                logger.warning("Job %s partially completed", job_id)
                break
            elif state == "Failed":
                error = status_data.get("error_message", "Unknown error")
                raise RuntimeError(f"Sarvam job {job_id} failed: {error}")
            else:
                await asyncio.sleep(POLL_INTERVAL)
        else:
            raise TimeoutError(
                f"Sarvam job {job_id} did not complete within "
                f"{MAX_POLLS * POLL_INTERVAL}s"
            )

        # Download results
        resp = await _request_with_retry(
            session, "POST", f"{base_url}/{job_id}/download-files",
            headers=headers,
        )
        download_data = await resp.json()

        download_urls = download_data.get("download_urls", {})
        if not download_urls:
            raise RuntimeError(f"No download URLs for job {job_id}")

        output_filename = next(iter(download_urls))
        file_url = download_urls[output_filename]["file_url"]
        logger.info("Downloading result for job %s", job_id)

        resp = await _request_with_retry(session, "GET", file_url)
        zip_bytes = await resp.read()

        # Extract markdown from ZIP
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            md_files = [n for n in zf.namelist() if n.endswith(".md")]
            if md_files:
                return zf.read(md_files[0]).decode("utf-8")
            for name in zf.namelist():
                if not name.endswith(".json"):
                    return zf.read(name).decode("utf-8")

        raise RuntimeError(f"No markdown file found in download for job {job_id}")
