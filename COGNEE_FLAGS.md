# Cognee — Important Flags: Ingestion & Retrieval

All flags are set in `.env`. Current values are from your live `.env` file.

---

## INGESTION FLAGS (affect `cognee.add()` + `cognee.cognify()`)

### Graph Extraction Quality

| Flag | Default | Your current value | What it does |
|---|---|---|---|
| `GRAPH_PROMPT_PATH` | `generate_graph_prompt.txt` (29 lines) | **not set → basic prompt active** | Path to the system prompt used for LLM graph extraction |
| `ONTOLOGY_FILE_PATH` | *(empty)* | **not set → ontology OFF** | Full path to your OWL file for entity canonicalization |
| `ONTOLOGY_RESOLVER` | `rdflib` | not set (default ok) | Which ontology engine to use |
| `MATCHING_STRATEGY` | `fuzzy` | not set (default ok) | How LLM terms are matched against OWL classes — fuzzy means ~80% similarity threshold |
| `TRIPLET_EMBEDDING` | `False` | **not set → OFF** | Whether to embed full subject-predicate-object triplets during cognify |

**What to enable to improve extraction quality:**

- Set `GRAPH_PROMPT_PATH` to the absolute path of `generate_graph_prompt_guided.txt` → better entity types, ISO dates, cleaner edge names
- Set `ONTOLOGY_FILE_PATH` to a curated OWL file → prevents "Physicist", "Scientist", "Person" becoming 3 separate nodes
- Set `TRIPLET_EMBEDDING=true` → enables `TRIPLET_COMPLETION` search (costs more embeddings at cognify time, but enables richer retrieval later)

---

### Chunking & Batching

| Flag | Default | Your current value | What it does |
|---|---|---|---|
| `chunk_size` (API param) | auto-calculated | not set → auto | Max tokens per chunk: `min(embedding_max_tokens, llm_context / 2)`. Smaller = more granular nodes. Larger = more context per LLM call |
| `CHUNKS_PER_BATCH` | `100` | not set → 100 | How many chunks are sent to LLM in one parallel batch during cognify |
| `incremental_loading` (API param) | `True` | not set → True | Skip re-processing data that was already cognified. Set to `False` to force full reprocessing |
| `RAISE_INCREMENTAL_LOADING_ERRORS` | `True` | not set → True | When `True`, any error during chunk processing raises and stops the run. When `False`, bad chunks are skipped and logged |

**What to tune:**

- Reduce `chunk_size` (e.g. 256 tokens) if entities are being merged together in the same chunk — smaller chunks = finer-grained graph nodes
- Increase `chunk_size` (e.g. 1024 tokens) if entity relationships are being missed because context is split across chunks
- Set `RAISE_INCREMENTAL_LOADING_ERRORS=False` in production if you want the pipeline to continue past bad documents

---

### Data Access & Deduplication

| Flag | Default | Your current value | What it does |
|---|---|---|---|
| `ENABLE_BACKEND_ACCESS_CONTROL` | `True` | **True** ✓ | Creates isolated graph + vector DB per user+dataset. Required for multi-user separation |
| `REQUIRE_AUTHENTICATION` | `False` | **False** | Whether API calls require a Bearer token |
| `ACCEPT_LOCAL_FILE_PATH` | `True` | not set → True | Allow adding local file paths via `cognee.add()`. Set to `False` in production backends |
| `ALLOW_HTTP_REQUESTS` | `True` | not set → True | Allow Cognee to fetch URLs. Disable to prevent SSRF if no proper infra is in place |
| `DLT_MAX_ROWS_PER_TABLE` | `50` | not set → 50 | Max rows read per table when ingesting from DLT sources. Set to `0` for no limit |

---

### LLM Rate Limiting (affects cognify throughput)

| Flag | Default | Your current value | What it does |
|---|---|---|---|
| `LLM_RATE_LIMIT_ENABLED` | `False` | **True** ✓ | Client-side throttle to avoid hitting Azure/OpenAI rate limits |
| `LLM_RATE_LIMIT_REQUESTS` | `60` | **60** | Max LLM requests per interval |
| `LLM_RATE_LIMIT_INTERVAL` | `60` | **60** | Interval in seconds |
| `LLM_RATE_LIMIT_TOKENS` | `0` (disabled) | not set → 0 | Max tokens per interval. `0` = token limiting off |
| `EMBEDDING_RATE_LIMIT_ENABLED` | `False` | not set → False | Same throttle but for embedding calls |

**What to tune:**

- If Azure returns 429 errors, lower `LLM_RATE_LIMIT_REQUESTS` or enable `EMBEDDING_RATE_LIMIT_ENABLED`
- If throughput is fine, you can increase `LLM_RATE_LIMIT_REQUESTS` to cognify faster

---

## RETRIEVAL FLAGS (affect `cognee.search()`)

### GRAPH_COMPLETION Search Tuning

These are passed directly when calling `search()` or when constructing a `GraphCompletionRetriever`.

| Parameter | Default | What it does |
|---|---|---|
| `top_k` | `5` | Final number of triplets returned as LLM context. Increase to give the LLM more context, decrease to keep answers focused |
| `wide_search_top_k` | `100` | How many candidates are fetched per collection before fusion. Increase if relevant nodes are being missed; increase costs more |
| `triplet_distance_penalty` | `6.5` | Score assigned to nodes/edges not found in any vector collection. Must stay above 2.0 (max real cosine distance). Higher = stricter exclusion |
| `feedback_influence` | `0.0` | Weight given to learned `feedback_weight` per node/edge. `0.0` = pure cosine distance. `1.0` = fully preference-driven. Currently off |
| `node_type` | `None` | Filter graph traversal to only nodes of a specific type (e.g. only `Entity` nodes) |
| `node_name` | `None` | Filter results to only nodes belonging to specific named sets (NodeSets) |

**What to tune for better retrieval:**

- Increase `top_k` from 5 to 10-15 if answers are missing facts that exist in the graph
- Increase `wide_search_top_k` from 100 to 200 if the right entities exist in the graph but aren't being picked up (rare but possible on large graphs)
- Lower `triplet_distance_penalty` to 3.0 if you want partially-matched triplets to compete with fully-matched ones
- Enable `feedback_influence` (e.g. 0.3) once you have feedback signals stored — nudges frequently-useful nodes upward

---

### Search Type Selection

| Flag / Parameter | Default | What it does |
|---|---|---|
| `query_type` | `GRAPH_COMPLETION` | Which search strategy to use. See table below |
| `ALLOW_CYPHER_QUERY` | `True` | Whether the `CYPHER` search type is allowed. Set to `False` to block raw graph queries |

**Available search types and when to use each:**

| Type | Use when |
|---|---|
| `GRAPH_COMPLETION` | Default. Good for relational questions — "who worked with X", "what did Y discover" |
| `RAG_COMPLETION` | Good for factual questions directly answered in the text, no relationships needed |
| `CHUNKS` | You want raw text back, not an LLM answer |
| `SUMMARIES` | You want high-level answers without reading all chunks |
| `TRIPLET_COMPLETION` | You want semantic subject-predicate-object matching (requires `TRIPLET_EMBEDDING=true`) |
| `FEELING_LUCKY` | Let the LLM auto-select the best type for each query |
| `CYPHER` | You know the graph schema and want to run exact queries |

---

## QUICK WINS — What to Turn On Right Now

| Priority | Flag to set | Value | Expected improvement |
|---|---|---|---|
| High | `GRAPH_PROMPT_PATH` | absolute path to `generate_graph_prompt_guided.txt` | Cleaner entity types, better edge names, ISO dates |
| High | `TRIPLET_EMBEDDING` | `true` | Enables full triplet semantic search |
| High | `ONTOLOGY_FILE_PATH` | path to your domain OWL file | Prevents duplicate entity types, canonicalizes names |
| Medium | `top_k` (at search time) | `10` or `15` | More context for LLM, better for multi-hop answers |
| Medium | `chunk_size` (at cognify time) | `256`–`512` for fine-grained, `1024` for dense docs | Tune to your document structure |
| Low | `feedback_influence` | `0.3` | Useful once feedback signals exist in graph |
| Low | `EMBEDDING_RATE_LIMIT_ENABLED` | `true` | Prevents embedding throttle errors under heavy load |
| Low | `RAISE_INCREMENTAL_LOADING_ERRORS` | `False` | Lets pipeline skip bad docs instead of crashing |
