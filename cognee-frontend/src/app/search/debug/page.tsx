"use client";

import { useState, useEffect, useCallback } from "react";
import AppNav from "@/ui/Layout/AppNav";
import { fetch as apiFetch } from "@/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TraceStep {
  name: string;
  label: string;
  order: number;
  duration_ms: number;
  result_count: number;
  /** Complete list of serialized result strings — one per retrieved item. */
  result_items: string[];
  status: "success" | "error";
  error?: string;
}

interface SearchTraceRecord {
  id: string;
  query_id: string;
  query_text: string;
  search_type: string;
  dataset_name: string | null;
  total_duration_ms: number;
  steps: TraceStep[];
  created_at: string | null;
}

/** One query may fan out across multiple datasets — group them into one card. */
interface DatasetSlice {
  trace_id: string;
  dataset_name: string | null;
  total_duration_ms: number;
  steps: TraceStep[];
}

interface GroupedTrace {
  query_id: string;
  query_text: string;
  search_type: string;
  created_at: string | null;
  /** Max duration across all dataset slices (for the header). */
  total_duration_ms: number;
  datasets: DatasetSlice[];
}

function groupTraces(records: SearchTraceRecord[]): GroupedTrace[] {
  const map = new Map<string, GroupedTrace>();
  for (const r of records) {
    if (!map.has(r.query_id)) {
      map.set(r.query_id, {
        query_id: r.query_id,
        query_text: r.query_text,
        search_type: r.search_type,
        created_at: r.created_at,
        total_duration_ms: r.total_duration_ms,
        datasets: [],
      });
    }
    const g = map.get(r.query_id)!;
    g.total_duration_ms = Math.max(g.total_duration_ms, r.total_duration_ms);
    g.datasets.push({
      trace_id: r.id,
      dataset_name: r.dataset_name,
      total_duration_ms: r.total_duration_ms,
      steps: r.steps,
    });
  }
  return Array.from(map.values());
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MODE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  GRAPH_COMPLETION:            { bg: "bg-violet-50",  text: "text-violet-700",  border: "border-violet-200" },
  RAG_COMPLETION:              { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200"   },
  SUMMARIES:                   { bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200"  },
  CHUNKS:                      { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200"},
};

const MODE_LABELS: Record<string, string> = {
  GRAPH_COMPLETION: "GraphRAG",
  RAG_COMPLETION:   "RAG",
  SUMMARIES:        "Summaries",
  CHUNKS:           "Chunks",
};

function modeStyle(searchType: string) {
  return MODE_COLORS[searchType] ?? { bg: "bg-gray-50", text: "text-gray-700", border: "border-gray-200" };
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const delta = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (delta < 60)   return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Step row ──────────────────────────────────────────────────────────────────

const STEP_ICONS: Record<string, JSX.Element> = {
  retrieve_objects: (
    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h7" />
    </svg>
  ),
  // GraphCompletion sub-step 1: parallel vector search across multiple collections
  vector_search: (
    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
    </svg>
  ),
  // GraphCompletion sub-step 2: graph distance mapping + importance ranking
  score_fusion: (
    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
    </svg>
  ),
  build_context: (
    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  generate_completion: (
    <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
};

const COLLAPSED_ITEM_LIMIT = 3;
const ITEM_PREVIEW_CHARS = 200;

// ── Single result item with inline see-more ────────────────────────────────

function ResultItem({ index, text }: { index: number; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > ITEM_PREVIEW_CHARS;
  const display = !isLong || expanded ? text : text.slice(0, ITEM_PREVIEW_CHARS) + "…";

  return (
    <div className="flex gap-2 bg-gray-50 rounded-lg border border-gray-100 px-3 py-2">
      <span className="text-[10px] text-gray-300 font-mono mt-0.5 select-none shrink-0 w-4 text-right">
        {index}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-gray-700 font-mono whitespace-pre-wrap break-words leading-relaxed">
          {display}
        </p>
        {isLong && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="text-[11px] text-indigo-500 hover:text-indigo-700 font-medium mt-1 transition-colors"
          >
            {expanded ? "Collapse" : "See more"}
          </button>
        )}
      </div>
    </div>
  );
}

function StepRow({ step, isLast }: { step: TraceStep; isLast: boolean }) {
  const [open, setOpen]       = useState(false);
  const [showAll, setShowAll] = useState(false);
  const isError  = step.status === "error";
  const items    = step.result_items ?? [];
  const visible  = showAll ? items : items.slice(0, COLLAPSED_ITEM_LIMIT);
  const hasMore  = items.length > COLLAPSED_ITEM_LIMIT;

  return (
    <div className="relative">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-[18px] top-9 bottom-0 w-px bg-gray-100" />
      )}

      {/* ── Header row (always visible) ── */}
      <button
        onClick={() => { setOpen((v) => !v); if (open) setShowAll(false); }}
        className="w-full flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-gray-50 transition-colors text-left"
      >
        {/* Icon circle */}
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            isError ? "bg-red-100 text-red-600" : "bg-indigo-50 text-indigo-600"
          }`}
        >
          {STEP_ICONS[step.name] ?? (
            <span className="text-xs font-bold">{step.order}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${isError ? "text-red-700" : "text-gray-800"}`}>
              {step.label}
            </span>
            <span className="text-[11px] text-gray-400 font-mono">{formatMs(step.duration_ms)}</span>
            {items.length > 0 && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            )}
            {isError && (
              <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
                error
              </span>
            )}
          </div>

          {/* Collapsed inline preview — first line of first item, single line */}
          {!open && items.length > 0 && !isError && (
            <p className="text-[11px] text-gray-400 truncate mt-0.5 pr-4">
              {items[0].split("\n")[0]}
            </p>
          )}
        </div>

        <svg
          width="14" height="14" fill="none" viewBox="0 0 24 24"
          stroke="currentColor" strokeWidth={2}
          className={`shrink-0 mt-1.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Expanded item list ── */}
      {open && (
        <div className="ml-12 mb-2 space-y-1.5">
          {isError ? (
            <div className="text-[12px] text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100 font-mono whitespace-pre-wrap">
              {step.error ?? "Unknown error"}
            </div>
          ) : items.length === 0 ? (
            <p className="text-[11px] text-gray-400 italic px-2">(no results)</p>
          ) : (
            <>
              {visible.map((text, i) => (
                <ResultItem key={i} index={i + 1} text={text} />
              ))}

              {/* Show all / Collapse toggle */}
              {hasMore && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAll((v) => !v); }}
                  className="text-[11px] text-indigo-500 hover:text-indigo-700 font-medium px-2 py-1 transition-colors"
                >
                  {showAll
                    ? "Collapse"
                    : `Show all ${items.length} items`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Trace card ────────────────────────────────────────────────────────────────

function DatasetSteps({ slice }: { slice: DatasetSlice }) {
  const colors = ["bg-violet-400", "bg-blue-400", "bg-emerald-400", "bg-amber-400"];
  const steps = slice.steps.slice().sort((a, b) => a.order - b.order);

  return (
    <>
      {/* Duration bar */}
      <div className="flex items-center gap-2 mb-4">
        {steps.map((step) => {
          const pct = slice.total_duration_ms
            ? Math.max(2, Math.round((step.duration_ms / slice.total_duration_ms) * 100))
            : Math.round(100 / steps.length);
          return (
            <div
              key={step.order}
              title={`${step.label}: ${formatMs(step.duration_ms)}`}
              className={`h-2 rounded-full ${colors[(step.order - 1) % colors.length]} transition-all`}
              style={{ width: `${pct}%`, minWidth: "6px" }}
            />
          );
        })}
      </div>
      {steps.map((step, i) => (
        <StepRow key={step.order} step={step} isLast={i === steps.length - 1} />
      ))}
    </>
  );
}

function TraceCard({ trace }: { trace: GroupedTrace }) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const style = modeStyle(trace.search_type);
  const multiDataset = trace.datasets.length > 1;
  const activeSlice = trace.datasets[activeIdx] ?? trace.datasets[0];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        {/* Mode badge */}
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border mt-0.5 shrink-0 ${style.bg} ${style.text} ${style.border}`}
        >
          {MODE_LABELS[trace.search_type] ?? trace.search_type}
        </span>

        {/* Query */}
        <span className="flex-1 text-sm text-gray-800 font-medium leading-snug line-clamp-2">
          {trace.query_text}
        </span>

        {/* Right meta */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs font-mono text-indigo-600 font-semibold">
            {formatMs(trace.total_duration_ms)}
          </span>
          <span className="text-[10px] text-gray-400">{relativeTime(trace.created_at)}</span>
        </div>

        <svg
          width="14" height="14" fill="none" viewBox="0 0 24 24"
          stroke="currentColor" strokeWidth={2}
          className={`shrink-0 mt-1 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dataset indicator (collapsed view) */}
      {!open && (
        <div className="px-5 pb-3 -mt-1 flex items-center gap-2 flex-wrap">
          <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h8m-8 5h4" />
          </svg>
          {trace.datasets.map((ds) => (
            <span key={ds.trace_id} className="text-[10px] text-gray-400">
              {ds.dataset_name ?? "unknown"}
            </span>
          ))}
        </div>
      )}

      {/* Steps panel */}
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-1">
          {/* Dataset tab switcher — only shown when multiple datasets */}
          {multiDataset && (
            <div className="flex items-center gap-1.5 mb-4 flex-wrap">
              {trace.datasets.map((ds, idx) => (
                <button
                  key={ds.trace_id}
                  onClick={(e) => { e.stopPropagation(); setActiveIdx(idx); }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    activeIdx === idx
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                      : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                  }`}
                >
                  {ds.dataset_name ?? `Dataset ${idx + 1}`}
                  <span className="ml-1.5 font-mono text-[10px] opacity-60">
                    {formatMs(ds.total_duration_ms)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Single dataset label (no tabs needed) */}
          {!multiDataset && activeSlice.dataset_name && (
            <div className="flex items-center gap-1.5 mb-3">
              <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="#9ca3af" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h8m-8 5h4" />
              </svg>
              <span className="text-[10px] text-gray-400">{activeSlice.dataset_name}</span>
            </div>
          )}

          <DatasetSteps key={activeSlice.trace_id} slice={activeSlice} />
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SearchDebugPage() {
  const [grouped, setGrouped]   = useState<GroupedTrace[]>([]);
  const [loading, setLoading]   = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [limit, setLimit]       = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/v1/search/debug?limit=${limit}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SearchTraceRecord[] = await res.json();
      setGrouped(groupTraces(data));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load traces");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const clearAll = useCallback(async () => {
    if (!window.confirm("Delete all search traces? This cannot be undone.")) return;
    setClearing(true);
    setError(null);
    try {
      const res = await apiFetch("/v1/search/debug", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGrouped([]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to clear traces");
    } finally {
      setClearing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Summary stats — count unique queries, not individual dataset slices
  const avgMs = grouped.length
    ? Math.round(grouped.reduce((s, t) => s + t.total_duration_ms, 0) / grouped.length)
    : null;
  const modeCounts = grouped.reduce<Record<string, number>>((acc, t) => {
    acc[t.search_type] = (acc[t.search_type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <AppNav />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* ── Page header ── */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Search Debug Traces</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Step-by-step retrieval pipeline for recent searches
              </p>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              >
                <option value={5}>Last 5</option>
                <option value={10}>Last 10</option>
                <option value={25}>Last 25</option>
                <option value={50}>Last 50</option>
              </select>
              <button
                onClick={load}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                  className={loading ? "animate-spin" : ""}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
              {grouped.length > 0 && (
                <button
                  onClick={clearAll}
                  disabled={clearing}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-red-200 text-red-500 rounded-xl hover:bg-red-50 hover:border-red-300 disabled:opacity-50 transition-colors"
                >
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  {clearing ? "Clearing…" : "Clear all"}
                </button>
              )}
            </div>
          </div>

          {/* ── Stats strip ── */}
          {grouped.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Searches" value={String(grouped.length)} />
              <StatCard label="Avg duration" value={avgMs !== null ? formatMs(avgMs) : "—"} />
              <StatCard
                label="Modes used"
                value={Object.entries(modeCounts)
                  .map(([k, v]) => `${MODE_LABELS[k] ?? k} ×${v}`)
                  .join(", ")}
              />
            </div>
          )}

          {/* ── Error ── */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ── Empty state ── */}
          {!loading && !error && grouped.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center">
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#6366f1" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <p className="text-base font-semibold text-gray-700">No traces yet</p>
                <p className="text-sm text-gray-400 mt-1">
                  Run a search to see the step-by-step retrieval pipeline here.
                </p>
              </div>
              <a href="/search" className="text-sm text-indigo-600 underline">
                Go to Search →
              </a>
            </div>
          )}

          {/* ── Skeleton while loading ── */}
          {loading && grouped.length === 0 && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 h-20 animate-pulse" />
              ))}
            </div>
          )}

          {/* ── Trace list ── */}
          {grouped.map((trace) => (
            <TraceCard key={trace.query_id} trace={trace} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-gray-800 mt-0.5 truncate">{value}</p>
    </div>
  );
}
