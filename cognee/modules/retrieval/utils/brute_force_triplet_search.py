from __future__ import annotations

import time
from typing import TYPE_CHECKING, List, Optional, Type, Union

from cognee.modules.observability import OtelStatusCode as StatusCode

from cognee.infrastructure.databases.graph import get_graph_engine
from cognee.infrastructure.databases.vector.exceptions import CollectionNotFoundError
from cognee.modules.graph.cognee_graph.CogneeGraph import CogneeGraph
from cognee.modules.graph.cognee_graph.CogneeGraphElements import Edge
from cognee.modules.graph.exceptions.exceptions import EntityNotFoundError
from cognee.modules.observability import (
    COGNEE_RESULT_SUMMARY,
    COGNEE_VECTOR_COLLECTION,
    COGNEE_VECTOR_RESULT_COUNT,
    new_span,
)
from cognee.modules.retrieval.utils.node_edge_vector_search import NodeEdgeVectorSearch
from cognee.modules.retrieval.utils.validate_queries import validate_queries
from cognee.modules.retrieval.utils.debug_serializer import serialize_items
from cognee.modules.retrieval.config import get_retrieval_config
from cognee.shared.logging_utils import ERROR, get_logger
from cognee.exceptions import CogneeValidationError

if TYPE_CHECKING:
    from cognee.infrastructure.databases.unified import UnifiedStoreEngine

logger = get_logger(level=ERROR)


def format_triplets(edges):
    """Formats edges into human-readable triplet strings."""
    triplets = []
    for edge in edges:
        node1 = edge.node1
        node2 = edge.node2
        edge_attributes = edge.attributes
        node1_attributes = node1.attributes
        node2_attributes = node2.attributes

        node1_info = {key: value for key, value in node1_attributes.items() if value is not None}
        node2_info = {key: value for key, value in node2_attributes.items() if value is not None}
        edge_info = {key: value for key, value in edge_attributes.items() if value is not None}

        triplet = f"Node1: {node1_info}\nEdge: {edge_info}\nNode2: {node2_info}\n\n\n"
        triplets.append(triplet)

    return "".join(triplets)


async def get_memory_fragment(
    properties_to_project: Optional[List[str]] = None,
    node_type: Optional[Type] = None,
    node_name: Optional[List[str]] = None,
    node_name_filter_operator: str = "OR",
    relevant_ids_to_filter: Optional[List[str]] = None,
    triplet_distance_penalty: Optional[float] = 6.5,
    feedback_influence: float = 0.0,
    graph_engine=None,
) -> CogneeGraph:
    """Creates and initializes a CogneeGraph memory fragment with optional property projections."""
    if properties_to_project is None:
        properties_to_project = ["id", "description", "name", "type", "text"]

    node_properties_to_project = list(properties_to_project)
    edge_properties_to_project = ["relationship_name", "edge_text", "edge_object_id"]

    if feedback_influence > 0.0:
        if "feedback_weight" not in node_properties_to_project:
            node_properties_to_project.append("feedback_weight")
        if "feedback_weight" not in edge_properties_to_project:
            edge_properties_to_project.append("feedback_weight")

    memory_fragment = CogneeGraph()

    try:
        if graph_engine is None:
            graph_engine = await get_graph_engine()
        await memory_fragment.project_graph_from_db(
            graph_engine,
            node_properties_to_project=node_properties_to_project,
            edge_properties_to_project=edge_properties_to_project,
            node_type=node_type,
            node_name=node_name,
            node_name_filter_operator=node_name_filter_operator,
            relevant_ids_to_filter=relevant_ids_to_filter,
            triplet_distance_penalty=triplet_distance_penalty,
            feedback_influence=feedback_influence,
        )
    except EntityNotFoundError:
        pass
    except Exception as e:
        logger.error(f"Error during memory fragment creation: {str(e)}")

    return memory_fragment


async def _get_top_triplet_importances(
    memory_fragment: Optional[CogneeGraph],
    vector_search: NodeEdgeVectorSearch,
    properties_to_project: Optional[List[str]],
    node_type: Optional[Type],
    node_name: Optional[List[str]],
    node_name_filter_operator: str,
    triplet_distance_penalty: float,
    feedback_influence: float,
    wide_search_limit: Optional[int],
    top_k: int,
    query_list_length: Optional[int] = None,
    graph_engine=None,
) -> Union[List[Edge], List[List[Edge]]]:
    """Creates memory fragment (if needed), maps distances, and calculates top triplet importances.

    Args:
        query_list_length: Number of queries in batch mode (None for single-query mode).
            When None, node_distances/edge_distances are flat lists; when set, they are list-of-lists.
        graph_engine: Optional pre-created graph engine to pass through to
            ``get_memory_fragment()``.

    Returns:
        List[Edge]: For single-query mode (query_list_length is None).
        List[List[Edge]]: For batch mode (query_list_length is set), one list per query.
    """
    if memory_fragment is None:
        if wide_search_limit is None:
            relevant_node_ids = None
        else:
            relevant_node_ids = vector_search.extract_relevant_node_ids()

        memory_fragment = await get_memory_fragment(
            properties_to_project=properties_to_project,
            node_type=node_type,
            node_name=node_name,
            node_name_filter_operator=node_name_filter_operator,
            relevant_ids_to_filter=relevant_node_ids,
            triplet_distance_penalty=triplet_distance_penalty,
            feedback_influence=feedback_influence,
            graph_engine=graph_engine,
        )

    await memory_fragment.map_vector_distances_to_graph_nodes(
        node_distances=vector_search.node_distances, query_list_length=query_list_length
    )
    await memory_fragment.map_vector_distances_to_graph_edges(
        edge_distances=vector_search.edge_distances, query_list_length=query_list_length
    )

    return await memory_fragment.calculate_top_triplet_importances(
        k=top_k,
        query_list_length=query_list_length,
        feedback_influence=feedback_influence,
    )


def _payload_value(payload: dict) -> str:
    """Extract the most readable value from a vector result payload.
    Tries name → relationship_name → text in that order.
    Text values are kept in full — the UI handles display truncation."""
    for field in ("name", "relationship_name", "text"):
        val = payload.get(field)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _collection_item(coll_name: str, results: list) -> str:
    """Build a single result_items entry for one collection:
    header line with count, followed by each retrieved value on its own line.

    Derives the primary field from the collection name convention
    ``{TypeName}_{field_name}`` (e.g. Entity_name → name,
    EdgeType_relationship_name → relationship_name).
    Falls back to the generic _payload_value heuristic when the derived
    field is absent."""
    count = len(results)
    header = f"{coll_name}  →  {count} result{'s' if count != 1 else ''}"

    # Derive primary field from naming convention, e.g. "EntityType_name" → "name"
    primary_field = coll_name.split("_", 1)[1] if "_" in coll_name else None

    values: list[str] = []
    for r in results:
        payload = getattr(r, "payload", None)
        val = ""

        # 1. Try the collection's own primary field first (most precise)
        if primary_field:
            if isinstance(payload, dict):
                val = payload.get(primary_field) or ""
            if not val:
                val = getattr(r, primary_field, None) or ""

        # 2. Fall back to generic heuristic across common fields
        if not val and isinstance(payload, dict):
            val = _payload_value(payload)

        if val and isinstance(val, str) and val.strip():
            values.append(f"• {val.strip()}")

    if values:
        return header + "\n" + "\n".join(values)
    return header


def _count_vector_hits(vector_search: NodeEdgeVectorSearch) -> tuple[int, list[str]]:
    """Return (total_hits, per_collection_item_strings) for the debug trace.
    Only collections with at least one result are included.
    Each item string contains the collection header + one bullet per retrieved value."""
    items: list[str] = []
    total = 0
    for coll, results in vector_search.node_distances.items():
        if not isinstance(results, list) or not results:
            continue
        # Skip batch-mode (list-of-lists) — each inner element would be a list
        if isinstance(results[0], list):
            continue
        total += len(results)
        items.append(_collection_item(coll, results))

    edge_results = vector_search.edge_distances
    if (
        isinstance(edge_results, list)
        and edge_results
        and not isinstance(edge_results[0], list)
    ):
        total += len(edge_results)
        items.append(_collection_item("EdgeType_relationship_name", edge_results))

    return total, items


async def brute_force_triplet_search(
    query: Optional[str] = None,
    query_batch: Optional[List[str]] = None,
    top_k: int = 5,
    collections: Optional[List[str]] = None,
    properties_to_project: Optional[List[str]] = None,
    memory_fragment: Optional[CogneeGraph] = None,
    node_type: Optional[Type] = None,
    node_name: Optional[List[str]] = None,
    node_name_filter_operator: str = "OR",
    wide_search_top_k: Optional[int] = None,
    triplet_distance_penalty: Optional[float] = 6.5,
    feedback_influence: float = 0.0,
    unified_engine: Optional[UnifiedStoreEngine] = None,
    debug_collector: Optional[list] = None,
) -> Union[List[Edge], List[List[Edge]]]:
    """
    Performs a brute force search to retrieve the top triplets from the graph.

    Args:
        query (Optional[str]): The search query (single query mode). Exactly one of query or query_batch must be provided.
        query_batch (Optional[List[str]]): List of search queries (batch mode). Exactly one of query or query_batch must be provided.
        top_k (int): The number of top results to retrieve.
        collections (Optional[List[str]]): List of collections to query.
        properties_to_project (Optional[List[str]]): List of properties to project.
        memory_fragment (Optional[CogneeGraph]): Existing memory fragment to reuse.
        node_type: node type to filter
        node_name: node name to filter
        wide_search_top_k (Optional[int]): Number of initial elements to retrieve from collections.
            Ignored in batch mode (always None to project full graph).
        triplet_distance_penalty (Optional[float]): Default distance penalty in graph projection
        feedback_influence (float): Weight of feedback influence in range [0, 1]

    Returns:
        List[Edge]: The top triplet results for single query mode (flat list).
        List[List[Edge]]: List of top triplet results (one per query) for batch mode (list-of-lists).

    Note:
        In single-query mode, node_distances and edge_distances are stored as flat lists.
        In batch mode, they are stored as list-of-lists (one list per query).
    """
    is_query_valid, msg = validate_queries(query, query_batch)
    if not is_query_valid:
        raise ValueError(msg)

    if top_k <= 0:
        raise ValueError("top_k must be a positive integer.")
    if not 0.0 <= feedback_influence <= 1.0:
        raise CogneeValidationError(
            message="feedback_influence must be in range [0, 1]",
            name="InvalidFeedbackInfluenceError",
        )

    with new_span("cognee.retrieval.triplet_search") as otel_span:
        otel_span.set_attribute("cognee.retrieval.top_k", top_k)
        otel_span.set_attribute(
            "cognee.retrieval.mode", "batch" if query_batch is not None else "single"
        )

        # Resolve wide_search_top_k: caller may pass None to use the configured default
        resolved_top_k = wide_search_top_k if wide_search_top_k is not None \
            else get_retrieval_config().vector_search_top_k

        query_list_length = len(query_batch) if query_batch is not None else None
        wide_search_limit = (
            None if query_list_length else (resolved_top_k if node_name is None else None)
        )

        if collections is None:
            collections = [
                "Entity_name",
                "TextSummary_text",
                "EntityType_name",
                "DocumentChunk_text",
            ]

        if "EdgeType_relationship_name" not in collections:
            collections.append("EdgeType_relationship_name")

        otel_span.set_attribute("cognee.retrieval.collection_count", len(collections))
        otel_span.set_attribute(COGNEE_VECTOR_COLLECTION, ", ".join(collections))

        try:
            vector_engine = unified_engine.vector if unified_engine else None
            graph_engine = unified_engine.graph if unified_engine else None

            vector_search = NodeEdgeVectorSearch(vector_engine=vector_engine)

            # ── Phase 1: multi-collection vector search ───────────────────────
            t_vec = time.monotonic()
            await vector_search.embed_and_retrieve_distances(
                query=None if query_list_length else query,
                query_batch=query_batch if query_list_length else None,
                collections=collections,
                wide_search_limit=wide_search_limit,
                node_name=node_name,
                node_name_filter_operator=node_name_filter_operator,
                # Fetch full payloads only when debug tracing is active (no production cost)
                include_payload=debug_collector is not None,
            )
            vec_duration_ms = int((time.monotonic() - t_vec) * 1000)

            if query_batch is not None:
                otel_span.set_attribute("cognee.retrieval.batch_size", len(query_batch))

            if not vector_search.has_results():
                otel_span.set_attribute(COGNEE_VECTOR_RESULT_COUNT, 0)
                otel_span.set_attribute(COGNEE_RESULT_SUMMARY, "No vector results found")
                if debug_collector is not None:
                    debug_collector.append({
                        "name": "vector_search",
                        "label": "Multi-Collection Vector Search",
                        "duration_ms": vec_duration_ms,
                        "result_count": 0,
                        "result_items": [
                            f"Searched {len(collections)} collection(s) — no results found"
                        ],
                        "status": "success",
                    })
                return [[] for _ in range(query_list_length)] if query_list_length else []

            if debug_collector is not None:
                total_hits, vec_items = _count_vector_hits(vector_search)
                debug_collector.append({
                    "name": "vector_search",
                    "label": "Multi-Collection Vector Search",
                    "duration_ms": vec_duration_ms,
                    "result_count": total_hits,
                    "result_items": vec_items,
                    "status": "success",
                })

            # ── Phase 2: score fusion + triplet ranking ───────────────────────
            t_fusion = time.monotonic()
            results = await _get_top_triplet_importances(
                memory_fragment,
                vector_search,
                properties_to_project,
                node_type,
                node_name,
                node_name_filter_operator,
                triplet_distance_penalty,
                feedback_influence,
                wide_search_limit,
                top_k,
                query_list_length=query_list_length,
                graph_engine=graph_engine,
            )
            fusion_duration_ms = int((time.monotonic() - t_fusion) * 1000)

            result_count = sum(len(r) for r in results) if query_list_length else len(results)
            otel_span.set_attribute(COGNEE_VECTOR_RESULT_COUNT, result_count)
            otel_span.set_attribute(
                COGNEE_RESULT_SUMMARY,
                f"Found {result_count} triplet(s) from {len(collections)} collection(s)",
            )

            if debug_collector is not None:
                flat = (
                    [edge for batch in results for edge in batch]
                    if query_list_length
                    else results
                )
                debug_collector.append({
                    "name": "score_fusion",
                    "label": "Score Fusion & Triplet Ranking",
                    "duration_ms": fusion_duration_ms,
                    "result_count": result_count,
                    "result_items": serialize_items(flat),
                    "status": "success",
                })

            return results
        except CollectionNotFoundError:
            return [[] for _ in range(query_list_length)] if query_list_length else []
        except Exception as error:
            otel_span.set_status(StatusCode.ERROR, str(error))
            otel_span.record_exception(error)

            logger.error(
                "Error during brute force search for query: %s. Error: %s",
                query_batch if query_list_length else [query],
                error,
            )
            raise error
