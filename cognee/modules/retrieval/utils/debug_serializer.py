"""
Shared serialization helpers for the retrieval debug trace.

Used by both get_retriever_output (outer step capture) and
brute_force_triplet_search (inner sub-step capture) so the two layers
produce consistent item strings without circular imports.
"""

from typing import Any


def serialize_single(item: Any) -> str:
    """Convert one retrieval result item to a clean, human-readable string."""

    # Vector search result objects expose a .payload dict
    if hasattr(item, "payload") and isinstance(item.payload, dict):
        text = item.payload.get("text", "")
        if text:
            return text
        return str(item.payload)

    # Graph Edge: node1 → relationship → node2 with full text snippet (no truncation)
    if hasattr(item, "node1") and hasattr(item, "node2"):
        n1_attrs = item.node1.attributes if hasattr(item.node1, "attributes") else {}
        n2_attrs = item.node2.attributes if hasattr(item.node2, "attributes") else {}
        rel = (
            item.attributes.get("relationship_name")
            or item.attributes.get("edge_type")
            or "→"
        ) if hasattr(item, "attributes") else "→"

        # Prefer name; fall back to [type] label; avoid raw UUIDs
        def _node_label(attrs: dict) -> str:
            name = attrs.get("name", "").strip()
            if name:
                return name
            node_type = attrs.get("type", "").strip()
            return f"[{node_type}]" if node_type else "[Node]"

        name1 = _node_label(n1_attrs)
        name2 = _node_label(n2_attrs)
        line = f"{name1}  →[{rel}]→  {name2}"
        # Include full text from the source node — no truncation
        snippet = n1_attrs.get("text") or n1_attrs.get("description") or ""
        if snippet:
            line += f"\n{snippet}"
        return line

    # Graph Node (has .attributes but not .node1)
    if hasattr(item, "attributes") and isinstance(item.attributes, dict):
        attrs = item.attributes
        name = attrs.get("name", "").strip()
        node_type = attrs.get("type", "").strip()
        text = attrs.get("text") or attrs.get("description") or ""
        label = name if name else (f"[{node_type}]" if node_type else "[Node]")
        header = f"{label} ({node_type})" if node_type and name else label
        return f"{header}: {text}" if text else (header or str(attrs))

    # Plain dict
    if isinstance(item, dict):
        text = item.get("text", "")
        if text:
            return text
        name = item.get("name", "")
        node_type = item.get("type", "")
        desc = item.get("description", "")
        if name:
            header = f"[{node_type}] {name}" if node_type else name
            return f"{header}: {desc}" if desc else header
        return str(item)

    return str(item)


def serialize_items(obj: Any) -> list[str]:
    """Serialize any retrieval result into a complete list of clean strings — no truncation."""
    if obj is None:
        return []
    if isinstance(obj, str):
        return [obj]
    if isinstance(obj, list):
        return [serialize_single(item) for item in obj] if obj else []
    return [serialize_single(obj)]
