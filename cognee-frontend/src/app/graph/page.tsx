"use client";

import { useState, useEffect, useCallback, ChangeEvent } from "react";

import AppNav from "@/ui/Layout/AppNav";
import getDatasetGraph from "@/modules/datasets/getDatasetGraph";
import useDatasets, { Dataset } from "@/modules/ingestion/useDatasets";
import VisGraphVisualization, { VisGraphData } from "@/app/(graph)/VisGraphVisualization";

// ── Page ───────────────────────────────────────────────────────────────────────

export default function GraphPage() {
  const { datasets, refreshDatasets } = useDatasets();
  useEffect(() => { refreshDatasets(); }, [refreshDatasets]);

  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [graphData, setGraphData]             = useState<VisGraphData | undefined>();
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  // Filter / search controls
  const [nodeSearch, setNodeSearch]   = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [allTypes, setAllTypes]       = useState<string[]>([]);

  // Auto-select first dataset
  useEffect(() => {
    if (datasets.length > 0 && !selectedDataset) {
      handleSelectDataset(datasets[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets]);

  const handleSelectDataset = useCallback(async (ds: Dataset) => {
    setSelectedDataset(ds);
    setGraphData(undefined);
    setError(null);
    setHiddenTypes(new Set());
    setNodeSearch("");
    setLoading(true);

    try {
      const graph = await getDatasetGraph(ds);
      const data: VisGraphData = { nodes: graph.nodes, links: graph.edges };
      setGraphData(data);
      const types = Array.from(new Set(graph.nodes.map((n: { type?: string }) => n.type).filter(Boolean))) as string[];
      setAllTypes(types);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleType = (type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  };

  const handleDatasetChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const ds = datasets.find((d) => d.id === e.target.value);
    if (ds) handleSelectDataset(ds);
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <AppNav />

      {/* ── Toolbar ── */}
      <div className="h-12 bg-white border-b border-gray-100 flex items-center gap-3 px-5 shrink-0">

        {/* Dataset selector */}
        <select
          value={selectedDataset?.id ?? ""}
          onChange={handleDatasetChange}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer max-w-[200px]"
        >
          {datasets.length === 0 && <option value="">No datasets</option>}
          {datasets.map((ds) => (
            <option key={ds.id} value={ds.id}>{ds.name}</option>
          ))}
        </select>

        {/* Divider */}
        {allTypes.length > 0 && <div className="h-5 w-px bg-gray-200" />}

        {/* Node type filter chips */}
        {allTypes.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-gray-400 font-medium shrink-0">Filter:</span>
            {allTypes.map((type) => {
              const hidden = hiddenTypes.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border transition-all ${
                    hidden
                      ? "border-gray-200 text-gray-400 bg-gray-50 line-through"
                      : "border-indigo-200 text-indigo-700 bg-indigo-50"
                  }`}
                >
                  {type}
                </button>
              );
            })}
          </div>
        )}

        {/* Divider */}
        <div className="h-5 w-px bg-gray-200 ml-auto" />

        {/* Node search */}
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={nodeSearch}
            onChange={(e) => setNodeSearch(e.target.value)}
            placeholder="Highlight node…"
            className="pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 w-36"
          />
        </div>
      </div>

      {/* ── Graph canvas ── */}
      <div className="flex-1 relative overflow-hidden">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-3 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500">Loading knowledge graph…</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
            <div className="text-center max-w-sm">
              <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-3">
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#ef4444" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">Failed to load graph</p>
              <p className="text-xs text-gray-500 mt-1">{error}</p>
              {selectedDataset && (
                <button
                  onClick={() => handleSelectDataset(selectedDataset)}
                  className="mt-3 text-xs text-indigo-600 underline"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && !error && datasets.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-medium text-gray-600">No datasets available</p>
              <a href="/ingest" className="text-sm text-indigo-600 underline mt-1 block">Ingest data first →</a>
            </div>
          </div>
        )}

        <VisGraphVisualization
          data={graphData}
          hiddenTypes={hiddenTypes}
          highlightLabel={nodeSearch}
        />
      </div>
    </div>
  );
}
