"use client";

import { useState, useCallback, useEffect, useRef, ChangeEvent, DragEvent } from "react";

import AppNav from "@/ui/Layout/AppNav";
import addData from "@/modules/ingestion/addData";
import cognifyDataset from "@/modules/datasets/cognifyDataset";
import createDataset from "@/modules/datasets/createDataset";
import useDatasets, { Dataset } from "@/modules/ingestion/useDatasets";

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

// ── Types ──────────────────────────────────────────────────────────────────────

interface IngestionJob {
  datasetId: string;
  datasetName: string;
  step: "uploading" | "cognifying" | "done" | "error";
  files: string[];
  error?: string;
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function IngestPage() {
  const { datasets, refreshDatasets, removeDataset, getDatasetData } = useDatasets();

  useEffect(() => { refreshDatasets(); }, [refreshDatasets]);

  // Upload form state
  const [datasetName, setDatasetName]     = useState("");
  const [dragOver, setDragOver]           = useState(false);
  const [pendingFiles, setPendingFiles]   = useState<File[]>([]);
  const [jobs, setJobs]                   = useState<IngestionJob[]>([]);
  const [expanded, setExpanded]           = useState<Set<string>>(new Set());
  const [chunkSize, setChunkSize]         = useState<number | undefined>(undefined);
  const fileInputRef                      = useRef<HTMLInputElement>(null);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      if (!next.has(id)) return next;
      // Fetch data when opening
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

    const job: IngestionJob = {
      datasetId:   "",
      datasetName: name,
      step:        "uploading",
      files:       pendingFiles.map((f) => f.name),
    };
    setJobs((prev) => [job, ...prev]);
    setPendingFiles([]);
    setDatasetName("");

    try {
      const dataset: Dataset = await createDataset({ name });
      job.datasetId = dataset.id;
      setJobs((prev) => prev.map((j) => (j.datasetName === name && j.step === "uploading" ? { ...j, datasetId: dataset.id } : j)));

      await addData(dataset, pendingFiles.length ? pendingFiles : []);

      setJobs((prev) => prev.map((j) => (j.datasetId === dataset.id ? { ...j, step: "cognifying" } : j)));

      await cognifyDataset(dataset, false, chunkSize);

      setJobs((prev) => prev.map((j) => (j.datasetId === dataset.id ? { ...j, step: "done" } : j)));
      refreshDatasets();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setJobs((prev) => prev.map((j) => (j.datasetName === name ? { ...j, step: "error", error: message } : j)));
    }
  }, [pendingFiles, datasetName, chunkSize, refreshDatasets]);

  // Add more files to existing dataset
  const handleAddToDataset = useCallback(
    async (dataset: Dataset, e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      e.target.value = "";

      const job: IngestionJob = {
        datasetId:   dataset.id,
        datasetName: dataset.name,
        step:        "uploading",
        files:       files.map((f) => f.name),
      };
      setJobs((prev) => [job, ...prev]);

      try {
        await addData(dataset, files);
        setJobs((prev) => prev.map((j) => (j.datasetId === dataset.id && j.step === "uploading" ? { ...j, step: "cognifying" } : j)));
        await cognifyDataset(dataset, false, chunkSize);
        setJobs((prev) => prev.map((j) => (j.datasetId === dataset.id && j.step === "cognifying" ? { ...j, step: "done" } : j)));
        refreshDatasets();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setJobs((prev) => prev.map((j) => (j.datasetId === dataset.id && j.step !== "done" ? { ...j, step: "error", error: message } : j)));
      }
    },
    [refreshDatasets]
  );

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <AppNav />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <h1 className="text-xl font-bold text-gray-900 mb-1">Ingest Data</h1>
          <p className="text-sm text-gray-500 mb-8">Upload files, build knowledge graphs, and manage datasets.</p>

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

                <button
                  onClick={handleIngest}
                  disabled={!pendingFiles.length}
                  className="mt-4 w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Upload & Build Knowledge Graph
                </button>
              </div>

              {/* Active jobs */}
              {jobs.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                  <h2 className="text-sm font-semibold text-gray-700 mb-3">Ingestion jobs</h2>
                  <div className="space-y-3">
                    {jobs.map((job, i) => (
                      <div key={i} className={`rounded-xl p-3 border ${
                        job.step === "error" ? "border-red-200 bg-red-50" :
                        job.step === "done"  ? "border-emerald-200 bg-emerald-50" :
                        "border-amber-200 bg-amber-50"
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          {job.step === "done" ? (
                            <span className="text-emerald-500">
                              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </span>
                          ) : job.step === "error" ? (
                            <span className="text-red-400">
                              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </span>
                          ) : (
                            <div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                          )}
                          <span className="text-xs font-semibold text-gray-700">{job.datasetName}</span>
                        </div>

                        <p className={`text-xs ${
                          job.step === "error" ? "text-red-600" :
                          job.step === "done"  ? "text-emerald-700" : "text-amber-700"
                        }`}>
                          {job.step === "uploading"  && "Uploading files…"}
                          {job.step === "cognifying" && "Extracting entities & building graph…"}
                          {job.step === "done"       && `Done — ${job.files.length} file(s) ingested`}
                          {job.step === "error"      && `Error: ${job.error}`}
                        </p>

                        {/* Progress bar */}
                        {(job.step === "uploading" || job.step === "cognifying") && (
                          <div className="mt-2 w-full h-1 bg-amber-100 rounded-full overflow-hidden">
                            <div className={`h-full bg-amber-400 rounded-full transition-all duration-700 animate-pulse ${
                              job.step === "cognifying" ? "w-4/5" : "w-1/3"
                            }`} />
                          </div>
                        )}

                        <p className="text-[10px] text-gray-400 mt-1">
                          {job.files.join(", ").slice(0, 80)}{job.files.join(", ").length > 80 ? "…" : ""}
                        </p>
                      </div>
                    ))}
                  </div>
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
                          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                          <span className="flex-1 text-sm font-medium text-gray-800 truncate">{dataset.name}</span>
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
                            {/* Add more files */}
                            <label className="flex items-center gap-2 px-4 py-2 text-xs text-indigo-600 font-medium cursor-pointer hover:bg-indigo-50 transition-colors relative">
                              <input type="file" multiple className="sr-only" onChange={(e) => handleAddToDataset(dataset, e)} />
                              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                              </svg>
                              Add more files
                            </label>

                            {dataset.data?.length ? (
                              dataset.data.map((file) => (
                                <div key={file.id} className="flex items-center gap-2 px-4 py-1.5 border-t border-gray-50">
                                  <span className="text-gray-400 shrink-0"><FileIcon /></span>
                                  <span className="text-xs text-gray-600 truncate flex-1">{file.name}</span>
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
        </div>
      </div>
    </div>
  );
}
