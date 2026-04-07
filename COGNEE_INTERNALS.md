# Cognee Internals — End to End Guide

---

## 1. Ingestion: `cognee.add()`

**Goal:** Take raw data (text, PDF, URL, S3) and store it safely, ready for processing.

**Flow:**

```
raw input
  → flatten into individual files/items
  → classify: TextData / BinaryData / S3BinaryData
  → generate deterministic ID from hash(content + user_id)   ← deduplication key
  → copy file to internal storage (.cognee_system/data/)
  → convert to plain text using the right loader
  → write Data record in relational DB (SQLite / Postgres)
```

**Deduplication:** Same file added twice by the same user → same hash → same `data_id` → no duplicate stored.

**Loaders:** `PyPdfLoader` for PDFs, `TextLoader` for plain text, `ImageLoader` for images, `UnstructuredLoader` for complex docs. Selected automatically by file extension / MIME type.

---

## 2. Cognify: `cognee.cognify()`

**Goal:** Read stored text, break it into chunks, extract a knowledge graph using an LLM, embed everything, and store it in graph + vector DBs.

**Flow:**

```
Data records from DB
  → classify each file into Document type (TextDocument, PdfDocument, etc.)
  → chunk each document into DocumentChunk objects
  → for each chunk batch, call LLM to extract KnowledgeGraph (nodes + edges)
  → turn extracted graph into Entity and EntityType nodes
  → optionally validate nodes against OWL ontology
  → generate a text summary for each chunk
  → embed all nodes, edges, summaries into vector DB
  → store all nodes + edges in graph DB
```

---

### 2.1 Text Chunking

**Goal:** Split a document into smaller pieces the LLM can handle, respecting natural language boundaries.

**Three nested layers, bottom-up:**

**Layer 1 — word:** Scans every character. Labels each as: word character, sentence-ending punctuation (`.!?`), or paragraph break (`\n\n`). Output: stream of classified word tokens.

**Layer 2 — sentence:** Accumulates words into sentences. Splits when sentence-ending punctuation is found AND tokens are near `max_chunk_size`, OR a paragraph boundary appears. Each sentence group gets a paragraph UUID.

**Layer 3 — paragraph:** Accumulates sentences into larger chunks. Prefers to split at paragraph boundaries. Only splits mid-paragraph if tokens exceed `max_chunk_size`.

**`max_chunk_size`:**
```
min(embedding_model_max_tokens, llm_context_window / 2)
```
The `/2` reserves room for the LLM's own output.

**`cut_type`** on each chunk records why the boundary was made: `paragraph_end`, `sentence_end`, or `word`.

---

### 2.2 Graph Extraction

**Goal:** For each chunk, ask the LLM to identify entities (nodes) and relationships (edges).

**What the LLM receives:**
- The chunk text
- A system prompt instructing it to extract nodes and edges like Wikipedia articles
- A Pydantic schema (`KnowledgeGraph`) forcing structured JSON output

**Example** — chunk: *"Albert Einstein won the 1921 Nobel Prize in Physics"*

```
nodes:
  - id: "Albert Einstein"        type: "Person"   description: "German-born theoretical physicist"
  - id: "Nobel Prize in Physics" type: "Award"    description: "Prize awarded by the Royal Swedish Academy"

edges:
  - source: "Albert Einstein" → target: "Nobel Prize in Physics"  relationship: "won"
```

**How node IDs are generated (deterministic):**

```
"Albert Einstein"
  → lowercase + spaces→underscore + remove apostrophes
  → "albert_einstein"
  → uuid5(NAMESPACE_OID, "albert_einstein")
  → same UUID every time for the same string ✓
```

This means `"albert einstein"` and `"ALBERT EINSTEIN"` always collapse to the same node. Abbreviations like `"A. Einstein"` or `"Einstein"` do **not** — they produce separate UUIDs.

**Entity description:** The Pydantic schema marks `description: str` as required — the LLM must fill it. No length or style guidance in the prompt. Quality depends on LLM and chunk content.

---

### 2.3 Active Extraction Prompt

Two prompts exist:

| Prompt file | Lines | Status |
|---|---|---|
| `generate_graph_prompt.txt` | 29 | **Active (default)** |
| `generate_graph_prompt_guided.txt` | 78 | Opt-in only |

The guided prompt adds stricter rules: ISO 8601 dates, snake_case edge names, explicit coreference instructions. To activate it, pass it as `custom_prompt` or set `GRAPH_PROMPT_PATH` in `.env`.

---

### 2.4 Entity Deduplication Gap

**What normalization handles:**

```
"Albert Einstein" → albert_einstein → UUID_A
"albert einstein" → albert_einstein → UUID_A  ✓
"ALBERT EINSTEIN" → albert_einstein → UUID_A  ✓
```

**What it misses:**

```
"A. Einstein"    → a._einstein    → UUID_B  ✗ different node
"Einstein"       → einstein       → UUID_C  ✗ different node
```

**Why the LLM prompt doesn't fully fix it:**
The coreference instruction in the prompt works **within a single chunk** — the LLM can see all mentions in one call. But each chunk is a **separate isolated LLM call** with no memory of other chunks. "Einstein" in chunk 0 and "Albert Einstein" in chunk 3 are processed independently → two nodes.

**Two experimental POC fixes (not in default pipeline):**
- **Post-chunk disambiguation:** Before the LLM call for a chunk, search the vector DB for already-known entity names similar to that chunk's text. Append the top matches to the prompt as hints. Works for chunks processed after the entity first appears.
- **Prefetch disambiguation:** Maintains an in-memory DataFrame of entity embeddings across chunks. Uses cosine similarity to suggest the closest known canonical name before each LLM call. More robust.

---

### 2.5 Ontology

**What it is:** A curated dictionary of agreed-upon terms, written in OWL format. Contains classes (`Person`, `Organization`) and named individuals (`Google`, `Apple`).

**What problem it solves:** Without ontology, the LLM might extract "Physicist", "Scientist", and "Person" as three separate `EntityType` nodes for the same real category. With ontology, a fuzzy matcher resolves all three to the canonical term and forces them to the same UUID.

**Example:**
```
LLM extracts type "Physicist"
  → fuzzy-matches against OWL → closest class: "Person"
  → EntityType renamed to "person", UUID = generate_node_id("Person")
  → merges with every other "Person" type node in graph ✓
```

**Is ontology currently active?**
No. `ONTOLOGY_FILE_PATH` is not set in `.env`. The default resolver is a pass-through — every node gets `ontology_valid = False`.

**Does the OWL file update when you cognify?**
No. The OWL file is a static, read-only input. The graph DB grows with each cognify run, but the OWL file never changes. You must update it manually.

---

### 2.6 What Gets Stored in the Vector DB

Each DataPoint type defines which fields to embed. After cognify, these collections exist:

| Collection | What is embedded | Used for |
|---|---|---|
| `Entity_name` | entity name e.g. "albert einstein" | node retrieval in search |
| `EntityType_name` | type name e.g. "person" | type-level filtering |
| `DocumentChunk_text` | raw chunk text | RAG-style retrieval |
| `TextSummary_text` | LLM-generated chunk summary | summary-based search |
| `EdgeType_relationship_name` | relationship label e.g. "won" | edge relevance in search |

**Two kinds of edges and how they are embedded:**

- **`contains` edge** (DocumentChunk → Entity): gets a rich combined string:
  `"relationship_name: contains; entity_name: albert einstein; entity_description: German-born theoretical physicist"` — the full string is embedded.

- **Entity-to-entity edges** (e.g. `won`, `born_in`): only the relationship label string is embedded. No surrounding sentence context is captured from the original text.

---

### 2.7 TRIPLET_EMBEDDING

**Currently active?** No. `triplet_embedding = False` in config, not set in `.env`.

**What it does when enabled:** Creates a `Triplet` object for every edge by concatenating source + relationship + target into one embeddable string:

```
"albert einstein -› won -› nobel prize in physics"
```

This populates an additional collection and enables `TRIPLET_COMPLETION` search — searching by full subject-predicate-object meaning rather than individual terms. Disabled by default because it roughly doubles the embeddings generated during cognify.

---

## 3. Search Pipeline: `cognee.search()`

**Goal:** Given a query, find relevant knowledge and return an LLM-generated answer.

**Three-phase interface — every search type follows this:**

```
Phase 1 — get_retrieved_objects   →  find relevant data (vector search / graph traversal)
Phase 2 — get_context_from_objects →  format retrieved data into readable text
Phase 3 — get_completion_from_context → LLM generates the final answer
```

**Search types at a glance:**

| Type | How it retrieves | Graph used? |
|---|---|---|
| `GRAPH_COMPLETION` (default) | Triplet search across all collections | Yes |
| `RAG_COMPLETION` | Chunk text vector similarity | No |
| `CHUNKS` | Chunk text vector similarity, no LLM answer | No |
| `SUMMARIES` | Summary text vector similarity | No |
| `TRIPLET_COMPLETION` | Triplet embedding similarity | Yes (requires `TRIPLET_EMBEDDING=True`) |
| `FEELING_LUCKY` | LLM picks the best type for your query | Depends |

---

### 3.1 RAG_COMPLETION — How Context Is Handled

No graph traversal. Pure vector similarity over raw text chunks.

**Flow:**
```
query
  → embed query → float vector
  → search DocumentChunk_text collection
  → return top-k chunks sorted by cosine distance (closest first)
  → concatenate chunks with newlines (similarity order, not document order)
  → pass to LLM as context
```

**Key limitation:** If the answer spans multiple chunks that are far apart in the document, they may not both be retrieved. The chunks come back in similarity order, so their original document order and surrounding context is lost.

---

### 3.2 Vector Search — Similarity Metric and Top-K

**Metric:** Cosine distance, hardcoded in the LanceDB adapter.
- Range: `[0.0, 2.0]`
- Lower score = more similar (opposite of cosine similarity)

**Per-collection fetch limit:** `wide_search_top_k = 100` — up to 100 results fetched per collection.

**Collections searched (in parallel):**
```
Entity_name  +  EntityType_name  +  DocumentChunk_text  +  TextSummary_text  +  EdgeType_relationship_name
```
All searched simultaneously using `asyncio.gather`. With 5 collections, up to 500 scored results come back before fusion.

---

### 3.3 Multi-Collection Score Fusion — GRAPH_COMPLETION

**Goal:** From raw cosine distances across 5 collections, pick the 5 most relevant triplets (node → edge → node) from the graph.

**Step 1 — Load graph into memory.**
The graph DB is projected into an in-memory `CogneeGraph`. When `wide_search_top_k=100`, only nodes that appeared in vector results are loaded (pre-filter) — not the full graph.

**Step 2 — Reset all distances to 6.5 (penalty sentinel).**
Every node and edge starts at `vector_distance = 6.5`. Since real cosine distance is always in `[0, 2]`, the penalty value is guaranteed to always rank worse than any real result. Nodes not found in any collection keep this penalty permanently.

**Step 3 — Map real cosine scores onto the graph.**

- **Nodes:** each vector result's ID is looked up directly. If found in the graph, `vector_distance` is overwritten with the real cosine score.
- **Edges:** the relationship label is hashed to an `edge_type_id`. One label match updates **all edges in the graph with that label**. So if `"won"` scores 0.05, every `won` edge gets 0.05 — regardless of which nodes it connects.

**Step 4 — Compute a triplet score for every edge.**

```
triplet_score = node1.vector_distance + edge.vector_distance + node2.vector_distance
```

Example — query: *"Who won the Nobel Prize?"*

| Triplet | node1 | edge | node2 | total |
|---|---|---|---|---|
| einstein → won → nobel_prize | 0.12 | 0.05 | 0.08 | **0.25** ✓ |
| marie_curie → won → nobel_chemistry | 0.45 | 0.05 | 0.21 | 0.71 |
| einstein → developed → relativity | 0.12 | 0.72 | 0.55 | 1.39 |
| bohr → born_in → copenhagen | 6.5 | 6.5 | 6.5 | **19.5** ✗ |

**Step 5 — Pick top 5 with `heapq.nsmallest`.**
Selects 5 edges with the lowest triplet score in O(n log 5) — efficient even for large graphs. These 5 triplets become the context fed to the LLM.

**Key design properties:**

- A triplet wins only if **all three components** are relevant. One penalized node (6.5) makes the whole triplet's minimum score 6.5 — worse than any fully-matched triplet.
- Edge scores are shared: all `born_in` edges get the same edge score. Node scores separate `bohr → born_in → copenhagen` from `curie → born_in → warsaw`.
- **Feedback blending** (`feedback_influence`) is currently off (`0.0`). When enabled, a learned `feedback_weight` per node/edge would nudge frequently-useful nodes toward lower effective distances, blending user preference with cosine relevance.

---

## 4. Limitations Summary

| Issue | Root Cause | Fix |
|---|---|---|
| "Einstein" ≠ "Albert Einstein" across chunks | Each chunk is an isolated LLM call | POC disambiguation prompts; or ontology |
| Ontology not active | `ONTOLOGY_FILE_PATH` not set in `.env` | Set env var + provide OWL file |
| OWL file never auto-updated | By design — static read-only input | Manual curation only |
| Entity-to-entity edge context lost | LLM returns label only, not the sentence | Not implemented in default pipeline |
| TRIPLET_EMBEDDING off | `triplet_embedding=False` in config | Set `TRIPLET_EMBEDDING=true` in `.env` |
| Guided prompt not active | Default is the basic 29-line prompt | Set `GRAPH_PROMPT_PATH` or pass `custom_prompt` |
