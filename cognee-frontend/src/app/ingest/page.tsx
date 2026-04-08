"use client";

import { useState, useCallback, useEffect, useRef, ChangeEvent, DragEvent } from "react";

import AppNav from "@/ui/Layout/AppNav";
import addData from "@/modules/ingestion/addData";
import cognifyDataset from "@/modules/datasets/cognifyDataset";
import createDataset from "@/modules/datasets/createDataset";
import useDatasets, { Dataset, DatasetStatus } from "@/modules/ingestion/useDatasets";
import { pollDatasetStatus, DatasetProcessingStatus } from "@/modules/datasets/getDatasetStatus";

// ── Icons ──────────────────────────────────────────────────────────────────────

const UploadCloudIcon = () => (
  <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.4} className="text-indigo-400">
    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
    className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const FileIcon = () => (
  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

// ── Status helpers ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { dot: string; bg: string; text: string; label: string }> = {
  DATASET_PROCESSING_INITIATED: { dot: "bg-amber-400", bg: "bg-amber-50 border-amber-200", text: "text-amber-700", label: "Queued" },
  DATASET_PROCESSING_STARTED:   { dot: "bg-amber-400 animate-pulse", bg: "bg-amber-50 border-amber-200", text: "text-amber-700", label: "Processing" },
  DATASET_PROCESSING_COMPLETED: { dot: "bg-emerald-400", bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", label: "Completed" },
  DATASET_PROCESSING_ERRORED:   { dot: "bg-red-400", bg: "bg-red-50 border-red-200", text: "text-red-700", label: "Failed" },
};

function StatusBadge({ status }: { status: string | DatasetStatus }) {
  if (!status) return null;
  const c = STATUS_CONFIG[status];
  if (!c) return null;

  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.bg} ${c.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

function shortId(uuid: string) {
  return uuid.slice(0, 8);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface PipelineRun {
  id: string;
  pipeline_run_id: string;
  dataset_id: string;
  dataset_name: string;
  status: string;
  created_at: string;
  total_files: number;
  completed_files: number;
}

interface UploadJob {
  datasetName: string;
  datasetId?: string;
  step: "uploading" | "cognifying";
  files: string[];
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function IngestPage() {
  const { datasets, refreshDatasets, refreshStatuses, removeDataset, removeDatasetData, getDatasetData } = useDatasets();

  const initialLoadRef = useRef(false);

  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    refreshDatasets();
  }, [refreshDatasets]);

  // Upload form state
  const [datasetName, setDatasetName]     = useState("");
  const [dragOver, setDragOver]           = useState(false);
  const [pendingFiles, setPendingFiles]   = useState<File[]>([]);
  const [uploadJobs, setUploadJobs]       = useState<UploadJob[]>([]);
  const [expanded, setExpanded]           = useState<Set<string>>(new Set());
  const [chunkSize, setChunkSize]         = useState<number | undefined>(undefined);
  const skipGraph                         = true;
  const [docParser, setDocParser]         = useState<string | undefined>(undefined);
  const [availableParsers, setAvailableParsers] = useState<string[]>([]);
  const [sarvamLang, setSarvamLang]       = useState("or-IN");
  const [sarvamLangs, setSarvamLangs]     = useState<Record<string, string>>({});
  const fileInputRef                      = useRef<HTMLInputElement>(null);

  // Pipeline runs (server-backed)
  const [pipelineRuns, setPipelineRuns]   = useState<PipelineRun[]>([]);
  const [runsLoading, setRunsLoading]     = useState(true);

  const fetchPipelineRuns = useCallback(async () => {
    try {
      const { fetch: apiFetch } = await import("@/utils");
      const res = await apiFetch("/v1/datasets/pipeline-runs?limit=50");
      const runs: PipelineRun[] = await res.json();
      setPipelineRuns(runs);
    } catch {
      // silently fail
    } finally {
      setRunsLoading(false);
    }
  }, []);

  // Fetch parsers, languages, and pipeline runs on mount
  useEffect(() => {
    import("@/utils").then(({ fetch: apiFetch }) => {
      apiFetch("/v1/cognify/parsers")
        .then((r) => r.json())
        .then((parsers: string[]) => setAvailableParsers(parsers))
        .catch(() => setAvailableParsers(["pypdf", "sarvam", "unstructured"]));

      apiFetch("/v1/cognify/sarvam-languages")
        .then((r) => r.json())
        .then((langs: Record<string, string>) => setSarvamLangs(langs))
        .catch(() => {});
    });

    fetchPipelineRuns();
  }, [fetchPipelineRuns]);

  // Auto-refresh pipeline runs every 5s when any run is active
  useEffect(() => {
    const hasActive = pipelineRuns.some(
      (r) => r.status === "DATASET_PROCESSING_INITIATED" || r.status === "DATASET_PROCESSING_STARTED",
    );
    if (!hasActive && uploadJobs.length === 0) return;

    const interval = setInterval(fetchPipelineRuns, 5000);
    return () => clearInterval(interval);
  }, [pipelineRuns, uploadJobs, fetchPipelineRuns]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      if (!next.has(id)) return next;
      getDatasetData(id);
      return next;
    });
  };

  // File picking
  const handleDrop = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
  }, []);

  const handleFileInput = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  }, []);

  const removeFile = (name: string) =>
    setPendingFiles((prev) => prev.filter((f) => f.name !== name));

  // Run ingestion
  const handleIngest = useCallback(async () => {
    if (!pendingFiles.length) return;

    const name = datasetName.trim() || `dataset_${Date.now()}`;
    const filesToUpload = [...pendingFiles];

    const job: UploadJob = {
      datasetName: name,
      step: "uploading",
      files: filesToUpload.map((f) => f.name),
    };
    setUploadJobs((prev) => [job, ...prev]);
    setPendingFiles([]);
    setDatasetName("");

    try {
      const dataset: Dataset = await createDataset({ name });
      setUploadJobs((prev) => prev.map((j) => (j.datasetName === name ? { ...j, datasetId: dataset.id } : j)));

      await addData(dataset, filesToUpload);
      setUploadJobs((prev) => prev.map((j) => (j.datasetId === dataset.id ? { ...j, step: "cognifying" } : j)));

      const opts = docParser === "sarvam" ? { language: sarvamLang } : undefined;
      await cognifyDataset(dataset, false, chunkSize, skipGraph, docParser, opts);
      refreshStatuses();
      fetchPipelineRuns();

      // Remove upload job — pipeline runs table takes over tracking
      setUploadJobs((prev) => prev.filter((j) => j.datasetId !== dataset.id));

      // Poll for completion to refresh datasets list
      pollDatasetStatus(dataset.id, (status: DatasetProcessingStatus) => {
        fetchPipelineRuns();
        refreshStatuses();
        if (status === "DATASET_PROCESSING_COMPLETED" || status === "DATASET_PROCESSING_ERRORED") {
          refreshDatasets();
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setUploadJobs((prev) => prev.map((j) => (j.datasetName === name ? { ...j, step: "uploading" } : j)));
      alert(`Ingestion failed: ${message}`);
      setUploadJobs((prev) => prev.filter((j) => j.datasetName !== name));
    }
  }, [pendingFiles, datasetName, chunkSize, skipGraph, docParser, sarvamLang, refreshDatasets, refreshStatuses, fetchPipelineRuns]);

  // Add more files to existing dataset
  const handleAddToDataset = useCallback(
    async (dataset: Dataset, e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      e.target.value = "";

      const job: UploadJob = {
        datasetName: dataset.name,
        datasetId: dataset.id,
        step: "uploading",
        files: files.map((f) => f.name),
      };
      setUploadJobs((prev) => [job, ...prev]);

      try {
        await addData(dataset, files);
        setUploadJobs((prev) => prev.map((j) => (j.datasetId === dataset.id && j.step === "uploading" ? { ...j, step: "cognifying" } : j)));

        const opts = docParser === "sarvam" ? { language: sarvamLang } : undefined;
        await cognifyDataset(dataset, false, chunkSize, skipGraph, docParser, opts);
        refreshStatuses();
        fetchPipelineRuns();

        setUploadJobs((prev) => prev.filter((j) => j.datasetId !== dataset.id));

        pollDatasetStatus(dataset.id, (status: DatasetProcessingStatus) => {
          fetchPipelineRuns();
          refreshStatuses();
          if (status === "DATASET_PROCESSING_COMPLETED" || status === "DATASET_PROCESSING_ERRORED") {
            refreshDatasets();
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        alert(`Ingestion failed: ${message}`);
        setUploadJobs((prev) => prev.filter((j) => j.datasetId !== dataset.id));
      }
    },
    [chunkSize, skipGraph, docParser, sarvamLang, refreshDatasets, refreshStatuses, fetchPipelineRuns],
  );

  // Counts for the pipeline runs summary
  const activeCount    = pipelineRuns.filter((r) => r.status === "DATASET_PROCESSING_STARTED" || r.status === "DATASET_PROCESSING_INITIATED").length;
  const completedCount = pipelineRuns.filter((r) => r.status === "DATASET_PROCESSING_COMPLETED").length;
  const failedCount    = pipelineRuns.filter((r) => r.status === "DATASET_PROCESSING_ERRORED").length;

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <AppNav />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <h1 className="text-xl font-bold text-gray-900 mb-1">Ingest Data</h1>
          <p className="text-sm text-gray-500 mb-8">Upload files, store embeddings, and manage datasets.</p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* ── Upload zone ── */}
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Upload Files</h2>

                {/* Drag-drop zone */}
                <label
                  className={`flex flex-col items-center justify-center gap-3 w-full rounded-xl border-2 border-dashed p-8 cursor-pointer transition-all ${
                    dragOver
                      ? "border-indigo-400 bg-indigo-50"
                      : "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <input ref={fileInputRef} type="file" multiple className="sr-only" onChange={handleFileInput} />
                  <UploadCloudIcon />
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-600">
                      {dragOver ? "Drop files here" : "Drag & drop files"}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">PDF, DOCX, TXT, CSV, MD and more</p>
                  </div>
                  <span className="text-xs text-indigo-600 font-medium underline">Browse files</span>
                </label>

                {/* Pending files */}
                {pendingFiles.length > 0 && (
                  <div className="mt-4 space-y-1.5">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                      Ready to upload ({pendingFiles.length})
                    </p>
                    {pendingFiles.map((f) => (
                      <div key={f.name} className="flex items-center justify-between gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-gray-400 shrink-0"><FileIcon /></span>
                          <span className="text-xs text-gray-700 truncate">{f.name}</span>
                          <span className="text-[10px] text-gray-400 shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                        </div>
                        <button onClick={() => removeFile(f.name)} className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
                          <TrashIcon />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Dataset name */}
                <div className="mt-4">
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Dataset name (optional)</label>
                  <input
                    type="text"
                    value={datasetName}
                    onChange={(e) => setDatasetName(e.target.value)}
                    placeholder="my_research_papers"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-gray-50"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">No spaces or periods. Leave blank for auto-name.</p>
                </div>

                {/* Chunk size */}
                <div className="mt-4">
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                    Chunk size —{" "}
                    <span className="text-indigo-600 font-bold">
                      {chunkSize ? `${chunkSize} tokens` : "Auto (server default)"}
                    </span>
                  </label>
                  <div className="flex gap-2">
                    {([undefined, 256, 512, 768, 1024] as const).map((size) => (
                      <button
                        key={size ?? "auto"}
                        type="button"
                        onClick={() => setChunkSize(size)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          chunkSize === size
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
                        }`}
                      >
                        {size ?? "Auto"}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {chunkSize === undefined && "Uses server default — min(embedding max tokens, LLM context / 2)"}
                    {chunkSize === 256 && "Very fine-grained — best for dense factual documents"}
                    {chunkSize === 512 && "Recommended — best for books and narrative content"}
                    {chunkSize === 768 && "Balanced — good for long-form articles and technical docs"}
                    {chunkSize === 1024 && "Large chunks — best for structured legal or policy documents"}
                  </p>
                </div>

                {/* Document parser */}
                <div className="mt-4">
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                    PDF Parser —{" "}
                    <span className="text-indigo-600 font-bold">
                      {docParser ?? "pypdf (default)"}
                    </span>
                  </label>
                  <div className="flex gap-2">
                    {[undefined, ...availableParsers.filter((p) => p !== "pypdf")].map((p) => (
                      <button
                        key={p ?? "default"}
                        type="button"
                        onClick={() => setDocParser(p)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          docParser === p
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-white text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-600"
                        }`}
                      >
                        {p ?? "pypdf"}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {!docParser && "Default — pure-Python text extraction (fast, no extra deps)"}
                    {docParser === "sarvam" && "Sarvam OCR — high-quality digitisation with layout & table support"}
                    {docParser === "unstructured" && "Layout-aware extraction with table support (requires unstructured)"}
                    {docParser && docParser !== "unstructured" && docParser !== "sarvam" && `Custom parser: ${docParser}`}
                  </p>

                  {/* Sarvam language selector */}
                  {docParser === "sarvam" && (
                    <div className="mt-3">
                      <label className="block text-xs font-semibold text-gray-500 mb-1">
                        Document Language —{" "}
                        <span className="text-indigo-600 font-bold">
                          {sarvamLangs[sarvamLang] ?? sarvamLang}
                        </span>
                      </label>
                      <select
                        value={sarvamLang}
                        onChange={(e) => setSarvamLang(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none"
                      >
                        {Object.entries(sarvamLangs).length > 0
                          ? Object.entries(sarvamLangs).map(([code, label]) => (
                              <option key={code} value={code}>
                                {label} ({code})
                              </option>
                            ))
                          : <option value="en-IN">English (en-IN)</option>
                        }
                      </select>
                    </div>
                  )}
                </div>

                <button
                  onClick={handleIngest}
                  disabled={!pendingFiles.length}
                  className="mt-4 w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Upload & Store Embeddings
                </button>
              </div>

              {/* Active upload indicator */}
              {uploadJobs.length > 0 && (
                <div className="bg-white rounded-2xl border border-amber-200 p-4 shadow-sm">
                  {uploadJobs.map((job, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-700 truncate">{job.datasetName}</p>
                        <p className="text-[10px] text-amber-600">
                          {job.step === "uploading" ? "Uploading files…" : "Starting pipeline…"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Dataset list ── */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">Datasets</h2>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{datasets.length}</span>
              </div>

              {datasets.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                    <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="#94a3b8" strokeWidth={1.6}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-500">No datasets yet</p>
                  <p className="text-xs text-gray-400 mt-1">Upload files on the left to get started</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {datasets.map((dataset) => {
                    const isOpen  = expanded.has(dataset.id);
                    const fileCount = dataset.data?.length || 0;

                    return (
                      <div key={dataset.id} className="border border-gray-100 rounded-xl overflow-hidden">
                        {/* Header */}
                        <div
                          className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors"
                          onClick={() => toggleExpand(dataset.id)}
                        >
                          <ChevronIcon open={isOpen} />
                          <span className="flex-1 text-sm font-medium text-gray-800 truncate">{dataset.name}</span>
                          <StatusBadge status={dataset.status} />
                          {fileCount > 0 && (
                            <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full shrink-0">{fileCount} files</span>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); removeDataset(dataset.id).then(() => refreshDatasets()); }}
                            className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                          >
                            <TrashIcon />
                          </button>
                        </div>

                        {/* Expanded files */}
                        {isOpen && (
                          <div className="border-t border-gray-100">
                            {dataset.data?.length ? (
                              dataset.data.map((file) => (
                                <div key={file.id} className="flex items-center gap-2 px-4 py-1.5 border-t border-gray-50">
                                  <span className="text-gray-400 shrink-0"><FileIcon /></span>
                                  <span className="text-xs text-gray-600 truncate flex-1">{file.name}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm(`Delete "${file.name}" and all its embeddings?`)) {
                                        removeDatasetData(dataset.id, file.id).then(() => getDatasetData(dataset.id));
                                      }
                                    }}
                                    className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                                    title="Delete file and embeddings"
                                  >
                                    <TrashIcon />
                                  </button>
                                </div>
                              ))
                            ) : (
                              <p className="text-xs text-gray-400 px-4 py-3">No files loaded — click to expand</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Pipeline Runs ── */}
          <div className="mt-8 bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-gray-700">Pipeline Runs</h2>
                <div className="flex items-center gap-2 text-[10px]">
                  {activeCount > 0 && (
                    <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      {activeCount} active
                    </span>
                  )}
                  {completedCount > 0 && (
                    <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                      {completedCount} completed
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full font-semibold">
                      {failedCount} failed
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={fetchPipelineRuns}
                className="text-gray-400 hover:text-indigo-600 transition-colors p-1.5 rounded-lg hover:bg-gray-50"
                title="Refresh"
              >
                <RefreshIcon />
              </button>
            </div>

            {runsLoading ? (
              <div className="text-center py-8 text-xs text-gray-400">Loading pipeline runs…</div>
            ) : pipelineRuns.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-500">No pipeline runs yet</p>
                <p className="text-xs text-gray-400 mt-1">Upload files above to start your first ingestion</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="text-left py-2 px-3">Dataset</th>
                      <th className="text-left py-2 px-3">Progress</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipelineRuns.map((run) => {
                      const total = run.total_files || 0;
                      const done = run.completed_files || 0;
                      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

                      return (
                        <tr key={run.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="py-2.5 px-3">
                            <span className="font-medium text-gray-700">{run.dataset_name || shortId(run.dataset_id)}</span>
                          </td>
                          <td className="py-2.5 px-3">
                            {total > 0 ? (
                              <div className="flex items-center gap-2">
                                <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? "bg-emerald-400" : "bg-indigo-400"}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-gray-500 font-medium whitespace-nowrap">
                                  {done}/{total} files
                                </span>
                              </div>
                            ) : (
                              <span className="text-[10px] text-gray-400">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge status={run.status} />
                          </td>
                          <td className="py-2.5 px-3 text-gray-400" title={run.created_at}>
                            {run.created_at ? timeAgo(run.created_at) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
