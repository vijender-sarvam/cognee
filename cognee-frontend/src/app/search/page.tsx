"use client";

import { useState, useEffect, useRef, useCallback } from "react";

import AppNav from "@/ui/Layout/AppNav";
import useDatasets, { Dataset } from "@/modules/ingestion/useDatasets";
import useChat from "@/modules/chat/hooks/useChat";

// ── See-more threshold ─────────────────────────────────────────────────────────
const PREVIEW_CHARS = 400;

function SystemMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > PREVIEW_CHARS;
  const display = !isLong || expanded ? text : text.slice(0, PREVIEW_CHARS) + "…";

  return (
    <div className="bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-bl-sm shadow-sm px-4 py-3 text-sm leading-relaxed max-w-[80%]">
      <p className="whitespace-pre-wrap break-words">{display}</p>
      {isLong && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[12px] font-medium text-indigo-500 hover:text-indigo-700 transition-colors"
        >
          {expanded ? "Collapse" : "See more"}
        </button>
      )}
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

const SendIcon = () => (
  <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
  </svg>
);

// ── Search mode labels ─────────────────────────────────────────────────────────

const MODE_LABEL: Record<string, string> = {
  CHUNKS: "Vector search",
  RAG_COMPLETION: "Vector search + LLM",
};

// ── Placeholder dataset for useChat (name drives the API call) ─────────────────

const EMPTY_DATASET: Dataset = { id: "", name: "", data: [], status: "" };

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SearchPage() {
  const { datasets, refreshDatasets } = useDatasets();
  useEffect(() => { refreshDatasets(); }, [refreshDatasets]);

  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [useLLM, setUseLLM]                   = useState(false);
  const searchType                             = useLLM ? "RAG_COMPLETION" : "CHUNKS";
  const [query, setQuery]                     = useState("");
  const messagesEndRef                        = useRef<HTMLDivElement>(null);

  // Auto-select first dataset when loaded
  useEffect(() => {
    if (datasets.length > 0 && !selectedDataset) {
      setSelectedDataset(datasets[0]);
    }
  }, [datasets, selectedDataset]);

  const { messages, sendMessage, isSearchRunning } = useChat(selectedDataset ?? EMPTY_DATASET);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSearchRunning]);

  const handleSend = useCallback(() => {
    const q = query.trim();
    if (!q || isSearchRunning || !selectedDataset) return;
    setQuery("");
    sendMessage(q, searchType, 10);
  }, [query, searchType, isSearchRunning, selectedDataset, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const SUGGESTIONS = [
    "What are the main topics?",
    "Summarize the key findings",
    "What entities are mentioned?",
    "What relationships exist between concepts?",
  ];

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <AppNav />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: dataset + settings panel ── */}
        <aside className="w-64 bg-white border-r border-gray-100 flex flex-col shrink-0">
          <div className="px-4 pt-5 pb-3 border-b border-gray-100">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Dataset</p>

            {datasets.length === 0 ? (
              <div className="text-xs text-gray-400 py-4 text-center">
                No datasets — <a href="/ingest" className="text-indigo-500 underline">ingest data first</a>
              </div>
            ) : (
              <div className="space-y-1">
                {datasets.map((ds) => (
                  <button
                    key={ds.id}
                    onClick={() => setSelectedDataset(ds)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                      selectedDataset?.id === ds.id
                        ? "bg-indigo-50 text-indigo-700 font-medium"
                        : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      selectedDataset?.id === ds.id ? "bg-indigo-500" : "bg-gray-300"
                    }`} />
                    <span className="truncate">{ds.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="px-4 pt-4 pb-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Options</p>
            <div className="flex items-center gap-3 px-1">
              <button
                type="button"
                role="switch"
                aria-checked={useLLM}
                onClick={() => setUseLLM((v) => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                  useLLM ? "bg-indigo-600" : "bg-gray-200"
                }`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  useLLM ? "translate-x-4" : "translate-x-0"
                }`} />
              </button>
              <div>
                <span className="text-xs font-semibold text-gray-600">Use LLM</span>
                <p className="text-[10px] text-gray-400">
                  {useLLM
                    ? "Results are refined by an LLM for a natural-language answer"
                    : "Raw vector similarity — fast, no LLM cost"}
                </p>
              </div>
            </div>
          </div>

          {/* Current selection summary */}
          {selectedDataset && (
            <div className="mt-auto px-4 py-3 border-t border-gray-100">
              <div className="bg-indigo-50 rounded-xl px-3 py-2.5">
                <p className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wide">Active</p>
                <p className="text-xs font-medium text-indigo-700 mt-0.5 truncate">{selectedDataset.name}</p>
                <p className="text-[10px] text-indigo-500 mt-0.5">{MODE_LABEL[searchType]}</p>
              </div>
            </div>
          )}
        </aside>

        {/* ── Main: chat area ── */}
        <main className="flex-1 flex flex-col overflow-hidden">

          {/* Empty state / messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-5 max-w-lg mx-auto text-center">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center">
                  <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="#6366f1" strokeWidth={1.6}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                {!selectedDataset ? (
                  <>
                    <div>
                      <p className="text-base font-semibold text-gray-700">No dataset selected</p>
                      <p className="text-sm text-gray-400 mt-1">Choose a dataset on the left to start searching.</p>
                    </div>
                    <a href="/ingest" className="text-sm text-indigo-600 underline">Ingest data first →</a>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-base font-semibold text-gray-700">Search your knowledge base</p>
                      <p className="text-sm text-gray-400 mt-1">
                        Searching <span className="font-medium text-gray-600">{selectedDataset.name}</span> using{" "}
                        <span className="font-medium text-gray-600">{MODE_LABEL[searchType]}</span>
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 w-full">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => setQuery(s)}
                          className="text-xs text-left text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl px-4 py-3 transition-colors leading-relaxed"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="max-w-2xl mx-auto space-y-4">
                {messages.map((msg) => (
                  <div key={msg.id} className={`flex ${msg.user === "user" ? "justify-end" : "justify-start"}`}>
                    {msg.user !== "user" && (
                      <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#6366f1" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                    )}
                    {msg.user === "user" ? (
                      <div className="max-w-[80%] bg-indigo-600 text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm leading-relaxed">
                        {typeof msg.text === "string" ? msg.text : JSON.stringify(msg.text)}
                      </div>
                    ) : (
                      <SystemMessage text={typeof msg.text === "string" ? msg.text : JSON.stringify(msg.text)} />
                    )}
                  </div>
                ))}

                {isSearchRunning && (
                  <div className="flex justify-start">
                    <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                      <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#6366f1" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex items-center gap-1.5">
                      {[0, 150, 300].map((d) => (
                        <div key={d} className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce"
                          style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-gray-100 bg-white px-6 py-4">
            <div className="max-w-2xl mx-auto flex gap-3 items-end">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  !selectedDataset
                    ? "Select a dataset first…"
                    : `Ask about ${selectedDataset.name}…`
                }
                disabled={!selectedDataset}
                rows={2}
                className="flex-1 resize-none border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-800 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent placeholder-gray-400 leading-relaxed disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!query.trim() || isSearchRunning || !selectedDataset}
                className="w-10 h-10 bg-indigo-600 text-white rounded-2xl flex items-center justify-center hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
              >
                <SendIcon />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 text-center">Enter to send · Shift+Enter for new line</p>
          </div>
        </main>
      </div>
    </div>
  );
}
