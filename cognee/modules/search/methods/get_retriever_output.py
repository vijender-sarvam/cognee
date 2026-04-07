import time
from typing import Any

from cognee.infrastructure.databases.graph import get_graph_engine
from cognee.modules.search.models.SearchResultPayload import SearchResultPayload
from cognee.modules.search.methods.get_search_type_retriever_instance import (
    get_search_type_retriever_instance,
)
from cognee.modules.search.types import SearchType
from cognee.modules.retrieval.utils.access_tracking import update_node_access_timestamps
from cognee.modules.retrieval.utils.debug_serializer import serialize_items
from cognee.shared.logging_utils import get_logger
from cognee.modules.observability import (
    new_span,
    COGNEE_SEARCH_TYPE,
    COGNEE_RESULT_COUNT,
    COGNEE_RESULT_SUMMARY,
)

logger = get_logger()

# Search modes whose "completion" step returns raw payloads rather than an LLM string.
_PAYLOAD_RETURN_MODES = {"SummariesRetriever", "ChunksRetriever"}


def _result_count(obj: Any) -> int:
    if isinstance(obj, list):
        return len(obj)
    if isinstance(obj, str):
        return len(obj)
    return 1 if obj is not None else 0


async def get_retriever_output(query_type: SearchType, query_text: str, **kwargs):
    graph_engine = await get_graph_engine()
    is_empty = await graph_engine.is_empty()

    if is_empty:
        logger.warning("Search attempt on an empty knowledge graph")

    retriever_instance = await get_search_type_retriever_instance(
        query_type=query_type, query_text=query_text, **kwargs
    )

    retriever_class = type(retriever_instance).__name__
    is_payload_mode = retriever_class in _PAYLOAD_RETURN_MODES

    steps: list[dict] = []

    # ── Step 1: retrieve raw objects ──────────────────────────────────────────
    t0 = time.monotonic()
    step1: dict = {"name": "retrieve_objects", "status": "success"}
    try:
        with new_span("cognee.retrieval.get_objects") as span:
            span.set_attribute("cognee.retrieval.retriever", retriever_class)
            span.set_attribute(COGNEE_SEARCH_TYPE, query_type.value)
            retrieved_objects = await retriever_instance.get_retrieved_objects(query=query_text)
            obj_count = _result_count(retrieved_objects)
            span.set_attribute(COGNEE_RESULT_COUNT, obj_count)
            span.set_attribute(
                COGNEE_RESULT_SUMMARY,
                f"{retriever_class} retrieved {obj_count} object(s)",
            )
        step1.update(
            label="Retrieve Summaries" if retriever_class == "SummariesRetriever"
            else "Retrieve Chunks" if retriever_class == "ChunksRetriever"
            else "Retrieve Objects",
            duration_ms=int((time.monotonic() - t0) * 1000),
            result_count=obj_count,
            result_items=serialize_items(retrieved_objects),
        )
    except Exception as exc:
        step1.update(
            label="Retrieve Objects",
            duration_ms=int((time.monotonic() - t0) * 1000),
            result_count=0,
            result_items=[],
            status="error",
            error=str(exc),
        )
        step1["order"] = 1
        steps.append(step1)
        raise

    # If the retriever populated sub-steps (e.g. GraphCompletionRetriever exposes
    # "Multi-Collection Vector Search" and "Score Fusion" as separate phases),
    # use those instead of the single coarse step 1.
    sub_steps = getattr(retriever_instance, "_debug_sub_steps", None)
    if sub_steps:
        # Re-number from 1 so the trace is always contiguous.
        for i, ss in enumerate(sub_steps, start=1):
            ss["order"] = i
        steps.extend(sub_steps)
    else:
        step1["order"] = 1
        steps.append(step1)

    # Centralised access tracking for all retriever types
    if retrieved_objects:
        await update_node_access_timestamps(retrieved_objects)

    # ── Build context (order assigned dynamically after step 1 / sub-steps) ──
    t0 = time.monotonic()
    step2: dict = {"name": "build_context", "label": "Build Context", "status": "success"}
    try:
        with new_span("cognee.retrieval.get_context") as span:
            span.set_attribute("cognee.retrieval.retriever", retriever_class)
            context = await retriever_instance.get_context_from_objects(
                query=query_text, retrieved_objects=retrieved_objects
            )
            if isinstance(context, str):
                span.set_attribute("cognee.retrieval.context_length", len(context))
            elif isinstance(context, list):
                span.set_attribute("cognee.retrieval.context_items", len(context))
        step2.update(
            order=len(steps) + 1,
            duration_ms=int((time.monotonic() - t0) * 1000),
            result_count=_result_count(context),
            result_items=serialize_items(context),
        )
    except Exception as exc:
        step2.update(
            order=len(steps) + 1,
            duration_ms=int((time.monotonic() - t0) * 1000),
            result_count=0,
            result_items=[],
            status="error",
            error=str(exc),
        )
        steps.append(step2)
        raise
    steps.append(step2)

    # ── Generate completion ───────────────────────────────────────────────────
    completion = None
    if not kwargs.get("only_context", False):
        t0 = time.monotonic()
        step3_label = "Return Payloads" if is_payload_mode else "Generate Completion (LLM)"
        step3: dict = {
            "name": "generate_completion",
            "label": step3_label,
            "status": "success",
        }
        try:
            with new_span("cognee.retrieval.get_completion") as span:
                span.set_attribute("cognee.retrieval.retriever", retriever_class)
                completion = await retriever_instance.get_completion_from_context(
                    query=query_text,
                    retrieved_objects=retrieved_objects,
                    context=context,
                )
                if isinstance(completion, str):
                    span.set_attribute("cognee.retrieval.completion_length", len(completion))
                span.set_attribute(
                    COGNEE_RESULT_SUMMARY,
                    f"{retriever_class} generated completion",
                )
            step3.update(
                order=len(steps) + 1,
                duration_ms=int((time.monotonic() - t0) * 1000),
                result_count=_result_count(completion),
                result_items=serialize_items(completion),
            )
        except Exception as exc:
            step3.update(
                order=len(steps) + 1,
                duration_ms=int((time.monotonic() - t0) * 1000),
                result_count=0,
                result_items=[],
                status="error",
                error=str(exc),
            )
            steps.append(step3)
            raise
        steps.append(step3)

    search_result = SearchResultPayload(
        result_object=retrieved_objects,
        context=context,
        completion=completion,
        search_type=query_type,
        only_context=kwargs.get("only_context", False),
        dataset_name=kwargs.get("dataset").name if kwargs.get("dataset") else None,
        dataset_id=kwargs.get("dataset").id if kwargs.get("dataset") else None,
        dataset_tenant_id=kwargs.get("dataset").tenant_id if kwargs.get("dataset") else None,
        steps=steps,
    )

    return search_result
