"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ── Cognee graph data types ────────────────────────────────────────────────────

export interface VisGraphNode {
  id: string;
  label: string;
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  properties?: Record<string, any>;
}

export interface VisGraphEdge {
  source: string;
  target: string;
  label: string;
}

export interface VisGraphData {
  nodes: VisGraphNode[];
  links: VisGraphEdge[];
}

export interface SelectedNodeInfo extends VisGraphNode {
  degree: number;
}

// ── Light-mode type colour palette ────────────────────────────────────────────
// Each type gets a pastel bg (readable on white) and a saturated border/accent.

const TYPE_COLORS: Record<string, { bg: string; border: string }> = {
  // Cognee core types
  TextDocument:  { bg: "#f0fdf4", border: "#16a34a" },
  DocumentChunk: { bg: "#f0f9ff", border: "#0284c7" },
  TextSummary:   { bg: "#eef2ff", border: "#4f46e5" },
  Entity:        { bg: "#fdf4ff", border: "#9333ea" },
  EntityType:    { bg: "#fff7ed", border: "#ea580c" },
  NodeSet:       { bg: "#fff7ed", border: "#ea580c" },
  // Code graph types
  GitHubUser:    { bg: "#f8fafc", border: "#475569" },
  Comment:       { bg: "#f0f9ff", border: "#38bdf8" },
  Issue:         { bg: "#fff1f2", border: "#e11d48" },
  Repository:    { bg: "#fafaf9", border: "#78716c" },
  Commit:        { bg: "#f0fdfa", border: "#0d9488" },
  File:          { bg: "#f0fdf4", border: "#15803d" },
  FileChange:    { bg: "#eff6ff", border: "#3b82f6" },
  // Generic NER (uppercase)
  PERSON:        { bg: "#fefce8", border: "#ca8a04" },
  ORGANIZATION:  { bg: "#eff6ff", border: "#2563eb" },
  LOCATION:      { bg: "#f0fdf4", border: "#16a34a" },
  EVENT:         { bg: "#fff1f2", border: "#e11d48" },
  CONCEPT:       { bg: "#fdf4ff", border: "#9333ea" },
  OBJECT:        { bg: "#fff7ed", border: "#ea580c" },
  TECHNOLOGY:    { bg: "#ecfeff", border: "#0891b2" },
  PRODUCT:       { bg: "#f0fdfa", border: "#0d9488" },
  DATE:          { bg: "#fefce8", border: "#a16207" },
  WORK_OF_ART:   { bg: "#fdf4ff", border: "#a855f7" },
  FOOD:          { bg: "#fef9c3", border: "#d97706" },
  ACTIVITY:      { bg: "#ecfeff", border: "#06b6d4" },
};
const DEFAULT_COLOR = { bg: "#f8fafc", border: "#94a3b8" };

function typeColor(type?: string) {
  if (!type) return DEFAULT_COLOR;
  return TYPE_COLORS[type] || TYPE_COLORS[type.toUpperCase()] || DEFAULT_COLOR;
}

// ── Layout types ──────────────────────────────────────────────────────────────

type LayoutMode = "force" | "hierarchy" | "radial";

// ── Component ──────────────────────────────────────────────────────────────────

interface VisGraphVisualizationProps {
  data?: VisGraphData;
  onNodeSelect?: (node: SelectedNodeInfo | null) => void;
  hiddenTypes?: Set<string>;
  highlightLabel?: string;
}

export default function VisGraphVisualization({
  data,
  onNodeSelect,
  hiddenTypes = new Set(),
  highlightLabel = "",
}: VisGraphVisualizationProps) {
  const containerRef     = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const networkRef       = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgesDSRef       = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodesDSRef       = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origNodesRef     = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const origEdgesRef     = useRef<any[]>([]);

  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [showLabels, setShowLabels]       = useState(false);
  const [nodeCount, setNodeCount]         = useState(0);
  const [edgeCount, setEdgeCount]         = useState(0);
  const [selectedNode, setSelectedNode]   = useState<SelectedNodeInfo | null>(null);
  const [layout, setLayout]               = useState<LayoutMode>("force");
  const [physicsOn, setPhysicsOn]         = useState(true);

  const showLabelsRef    = useRef(showLabels);
  const focusedNodeIdRef = useRef(focusedNodeId);
  useEffect(() => { showLabelsRef.current = showLabels; },    [showLabels]);
  useEffect(() => { focusedNodeIdRef.current = focusedNodeId; }, [focusedNodeId]);

  useEffect(() => {
    onNodeSelect?.(selectedNode);
  }, [selectedNode, onNodeSelect]);

  // ── Build layout options ──────────────────────────────────────────────────

  const getOptions = useCallback((mode: LayoutMode, nodeCount: number) => {
    const base = {
      nodes: { shape: "dot" },
      interaction: {
        hover:        true,
        tooltipDelay: 150,
        keyboard:     { enabled: true },
        zoomView:     true,
        dragView:     true,
      },
      autoResize: true,
    };

    if (mode === "hierarchy") {
      return {
        ...base,
        layout: {
          hierarchical: {
            enabled:        true,
            direction:      "UD",
            sortMethod:     "hubsize",
            levelSeparation: 200,
            nodeSpacing:    180,
            treeSpacing:    220,
          },
        },
        physics: {
          enabled: true,
          hierarchicalRepulsion: { nodeDistance: 240, centralGravity: 0.1, springLength: 200 },
          stabilization: { iterations: 150 },
        },
      };
    }

    if (mode === "radial") {
      return {
        ...base,
        layout: { improvedLayout: true, randomSeed: 42 },
        physics: {
          enabled: true,
          solver: "repulsion",
          repulsion: {
            nodeDistance:    280,
            centralGravity:  0.2,
            springLength:    220,
            springConstant:  0.04,
            damping:         0.4,
          },
          stabilization: { iterations: 200 },
        },
      };
    }

    // Force (default)
    return {
      ...base,
      layout: { improvedLayout: nodeCount < 200, randomSeed: 42 },
      physics: {
        enabled: true,
        solver: "barnesHut",
        barnesHut: {
          gravitationalConstant: -22000,
          centralGravity:  0.15,
          springLength:    220,
          springConstant:  0.03,
          damping:         0.18,
          avoidOverlap:    1.0,
        },
        stabilization: { iterations: 300, updateInterval: 20 },
      },
    };
  }, []);

  // ── Build & render vis-network ────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    let destroyed = false;

    import("vis-network/standalone").then(({ Network, DataSet }) => {
      if (destroyed || !containerRef.current || !data) return;

      const nodes = data.nodes || [];
      const links = data.links || [];

      // Degree per node
      const degreeMap: Record<string, number> = {};
      links.forEach((e) => {
        degreeMap[e.source] = (degreeMap[e.source] || 0) + 1;
        degreeMap[e.target] = (degreeMap[e.target] || 0) + 1;
      });

      // Ego-network filter
      let filteredLinks = links;
      let filteredNodes = nodes;

      if (focusedNodeId) {
        filteredLinks = links.filter(
          (e) => e.source === focusedNodeId || e.target === focusedNodeId
        );
        const neighborIds = new Set<string>([focusedNodeId]);
        filteredLinks.forEach((e) => { neighborIds.add(e.source); neighborIds.add(e.target); });
        filteredNodes = nodes.filter((n) => neighborIds.has(n.id));
      }

      if (hiddenTypes.size > 0) {
        const allowedIds = new Set(filteredNodes.filter((n) => !hiddenTypes.has(n.type || "")).map((n) => n.id));
        filteredNodes  = filteredNodes.filter((n) => allowedIds.has(n.id));
        filteredLinks  = filteredLinks.filter((e) => allowedIds.has(e.source) && allowedIds.has(e.target));
      }

      const connectedIds = new Set<string>();
      filteredLinks.forEach((e) => { connectedIds.add(e.source); connectedIds.add(e.target); });

      // ── vis nodes ────────────────────────────────────────────────────────
      const visNodes = filteredNodes.map((n) => {
        const tc          = typeColor(n.type);
        const degree      = degreeMap[n.id] || 0;
        const isFocused   = n.id === focusedNodeId;
        const isConnected = connectedIds.has(n.id);
        const size        = isFocused ? 44 : isConnected ? Math.min(20 + degree * 4, 54) : 14;

        const desc: string =
          n.properties?.description ||
          n.properties?.summary     ||
          n.properties?.text?.slice(0, 120) ||
          "";

        const tooltip = [
          `<b style="color:#0f172a;font-size:13px">${n.label}</b>`,
          `<span style="color:#6366f1;font-size:11px;font-weight:600">${n.type || "Unknown"}</span>`,
          `<span style="color:#64748b;font-size:11px">Connections: ${degree}</span>`,
          desc ? `<hr style="border:none;border-top:1px solid #e2e8f0;margin:4px 0"><span style="color:#94a3b8;font-size:10px">${desc.slice(0, 140)}</span>` : "",
        ].filter(Boolean).join("<br>");

        return {
          id:    n.id,
          label: n.label,
          shape: "dot",
          color: {
            background: isFocused ? tc.border : tc.bg,
            border:     isFocused ? "#ffffff"  : tc.border,
            highlight:  { background: tc.border, border: "#4f46e5" },
            hover:      { background: tc.border, border: "#4f46e5" },
          },
          font: {
            color:       isFocused ? "#ffffff" : "#1e293b",
            size:        isFocused ? 14 : Math.min(10 + degree, 13),
            strokeWidth: 0,
            strokeColor: "transparent",
            background:  "rgba(255,255,255,0.85)",
            vadjust:     0,
          },
          size,
          borderWidth: isFocused ? 3 : isConnected ? 2 : 1.5,
          shadow: {
            enabled: true,
            color:   tc.border + "30",
            size:    isFocused ? 20 : 8,
            x: 0, y: 2,
          },
          title:    tooltip,
          nodeData: n,
        };
      });

      // ── vis edges with parallel-curve ─────────────────────────────────────
      const pairCount: Record<string, number> = {};
      filteredLinks.forEach((e) => {
        const key = [e.source, e.target].sort().join("::");
        pairCount[key] = (pairCount[key] || 0) + 1;
      });

      const pairSeen: Record<string, number> = {};
      const visEdges = filteredLinks.map((e, i) => {
        const key        = [e.source, e.target].sort().join("::");
        pairSeen[key]    = (pairSeen[key] || 0) + 1;
        const total      = pairCount[key] || 1;
        const idx        = pairSeen[key];
        const multi      = total > 1;
        const halfSpread = total * 0.15;
        const roundness  = multi ? -halfSpread + (idx - 1) * (2 * halfSpread / Math.max(total - 1, 1)) : 0;
        const permLabel  = showLabels || !!focusedNodeId ? e.label.replace(/_/g, " ") : "";

        return {
          id:        "e" + i,
          from:      e.source,
          to:        e.target,
          label:     permLabel,
          edgeLabel: e.label,
          arrows:    { to: { enabled: true, scaleFactor: 0.45, type: "arrow" } },
          color: {
            color:     "rgba(99,102,241,0.25)",
            highlight: "#6366f1",
            hover:     "rgba(99,102,241,0.6)",
          },
          font: {
            color:       "#64748b",
            size:        9,
            strokeWidth: 2,
            strokeColor: "#ffffff",
            align:       "top",
          },
          width:      1.5,
          smooth:     multi ? { type: "curvedCW", roundness } : { type: "continuous" },
          hoverWidth: 2.5,
          title:      e.label.replace(/_/g, " "),
          chosen: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            edge:  (values: any) => { values.width = 3; values.color = "#6366f1"; },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: (values: any) => { values.color = "#1e293b"; values.size = 11; },
          },
        };
      });

      const nodesDS = new DataSet(visNodes);
      const edgesDS = new DataSet(visEdges);
      nodesDSRef.current  = nodesDS;
      edgesDSRef.current  = edgesDS;
      origNodesRef.current = visNodes;
      origEdgesRef.current = visEdges;

      setNodeCount(filteredNodes.length);
      setEdgeCount(filteredLinks.length);

      const options = getOptions(layout, filteredNodes.length);

      if (networkRef.current) { networkRef.current.destroy(); }

      const network = new Network(containerRef.current!, { nodes: nodesDS, edges: edgesDS }, options);
      networkRef.current = network;

      network.once("stabilizationIterationsDone", () => {
        network.setOptions({ physics: { stabilization: false } });
        setTimeout(() => network.fit({ animation: { duration: 400 } }), 50);
      });
      network.once("afterDrawing", () => { network.fit({ animation: false }); });

      // Edge hover
      network.on("hoverEdge", (params: { edge: string }) => {
        const item = edgesDS.get(params.edge) as { edgeLabel?: string } | null;
        if (item?.edgeLabel) edgesDS.update({ id: params.edge, label: item.edgeLabel.replace(/_/g, " ") });
      });
      network.on("blurEdge", (params: { edge: string }) => {
        if (!showLabelsRef.current && !focusedNodeIdRef.current)
          edgesDS.update({ id: params.edge, label: "" });
      });

      // Node hover
      network.on("hoverNode", (params: { node: string }) => {
        const connected: string[] = network.getConnectedEdges(params.node);
        connected.forEach((eid) => {
          const item = edgesDS.get(eid) as { edgeLabel?: string } | null;
          if (item?.edgeLabel) edgesDS.update({ id: eid, label: item.edgeLabel.replace(/_/g, " ") });
        });
      });
      network.on("blurNode", (params: { node: string }) => {
        if (!showLabelsRef.current && !focusedNodeIdRef.current) {
          const connected: string[] = network.getConnectedEdges(params.node);
          connected.forEach((eid) => edgesDS.update({ id: eid, label: "" }));
        }
      });

      // Click — select node + dim unrelated nodes/edges in-place
      network.on("click", (params: { nodes: string[]; edges: string[] }) => {
        if (params.nodes.length > 0) {
          const nodeId   = params.nodes[0];
          const nodeData = data.nodes.find((n) => n.id === nodeId);
          if (!nodeData) return;

          setSelectedNode({ ...nodeData, degree: degreeMap[nodeId] || 0 });

          // Step 1: restore full graph so every click starts from complete data
          nodesDS.clear();
          nodesDS.add(origNodesRef.current);
          edgesDS.clear();
          edgesDS.add(origEdgesRef.current);

          // Step 2: re-resolve connected edges/nodes after restore
          const connEdgeIdsFresh = new Set<string>(network.getConnectedEdges(nodeId) as string[]);
          const connNodeIdsFresh = new Set<string>([nodeId]);
          connEdgeIdsFresh.forEach((eid) => {
            const e = edgesDS.get(eid) as { from: string; to: string } | null;
            if (e) { connNodeIdsFresh.add(e.from); connNodeIdsFresh.add(e.to); }
          });

          // Step 3: remove unrelated edges then unrelated nodes
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          edgesDS.remove((edgesDS.get() as any[]).filter((e) => !connEdgeIdsFresh.has(e.id)).map((e) => e.id));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nodesDS.remove((nodesDS.get() as any[]).filter((n) => !connNodeIdsFresh.has(n.id)).map((n) => n.id));

          // Step 4: highlight centre node and active edges
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          nodesDS.update((nodesDS.get() as any[]).map((n) => ({
            id:          n.id,
            borderWidth: n.id === nodeId ? 4 : n.borderWidth,
            shadow:      n.id === nodeId
              ? { enabled: true, color: "rgba(99,102,241,0.45)", size: 26, x: 0, y: 0 }
              : n.shadow,
          })));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          edgesDS.update((edgesDS.get() as any[]).map((e) => ({
            id:    e.id,
            color: { color: "#6366f1", highlight: "#4f46e5", hover: "#4f46e5" },
            width: 2.5,
            font:  { color: "#4f46e5", size: 10, strokeWidth: 0, background: "rgba(255,255,255,0.85)", align: "top" },
          })));

        } else {
          // Background click — restore full graph
          setSelectedNode(null);
          nodesDS.clear();
          nodesDS.add(origNodesRef.current);
          edgesDS.clear();
          edgesDS.add(origEdgesRef.current);
        }
      });

      // Double-click → ego view
      network.on("doubleClick", (params: { nodes: string[] }) => {
        if (params.nodes.length > 0) setFocusedNodeId(params.nodes[0]);
      });
    });

    return () => {
      destroyed = true;
      if (networkRef.current) { networkRef.current.destroy(); networkRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, focusedNodeId, showLabels, hiddenTypes, layout, getOptions]);

  // ── Highlight search matches without rebuilding the network ───────────────
  useEffect(() => {
    const nodesDS  = nodesDSRef.current;
    const network  = networkRef.current;
    if (!nodesDS || !network) return;

    const term = highlightLabel.trim().toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = origNodesRef.current.length ? origNodesRef.current : nodesDS.get();

    if (term === "") {
      // Reset every node to its stored base colour
      nodesDS.update(all.map((n) => {
        const tc = typeColor(n.nodeData?.type ?? n.type ?? "");
        const isFocused = n.id === focusedNodeId;
        return {
          id:          n.id,
          color: {
            background: isFocused ? tc.border : tc.bg,
            border:     isFocused ? "#ffffff"  : tc.border,
            highlight:  { background: tc.border, border: "#4f46e5" },
            hover:      { background: tc.border, border: "#4f46e5" },
          },
          size:        n.size,
          borderWidth: n.borderWidth,
          font:        n.font,
        };
      }));
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matchIds: string[] = [];
    nodesDS.update(all.map((n) => {
      const label   = (n.label ?? "").toLowerCase();
      const isMatch = label.includes(term);
      if (isMatch) matchIds.push(n.id);
      const tc = typeColor(n.nodeData?.type ?? n.type ?? "");
      return {
        id:    n.id,
        color: isMatch
          ? { background: "#fef08a", border: "#f59e0b", highlight: { background: "#fde047", border: "#d97706" }, hover: { background: "#fde047", border: "#d97706" } }
          : { background: tc.bg + "55", border: tc.border + "55", highlight: { background: tc.border, border: "#4f46e5" }, hover: { background: tc.border, border: "#4f46e5" } },
        size:        isMatch ? (n.size ?? 14) + 8 : (n.size ?? 14),
        borderWidth: isMatch ? 3 : 1,
        font: { ...n.font, color: isMatch ? "#92400e" : "rgba(100,116,139,0.4)" },
      };
    }));

    // Fit view to matching nodes
    if (matchIds.length > 0) {
      network.fit({
        nodes:     matchIds,
        animation: { duration: 400, easingFunction: "easeInOutQuad" },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightLabel]);

  // ── Controls ───────────────────────────────────────────────────────────────

  const handleFitView = () => {
    networkRef.current?.fit({ animation: { duration: 500, easingFunction: "easeInOutQuad" } });
  };

  const handleTogglePhysics = () => {
    const next = !physicsOn;
    setPhysicsOn(next);
    networkRef.current?.setOptions({ physics: { enabled: next } });
  };

  // ── Selected node style ────────────────────────────────────────────────────

  const tc = selectedNode ? typeColor(selectedNode.type) : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-50">
      {/* vis-network canvas */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Empty state */}
      {!data && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center shadow-sm">
            <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#6366f1" strokeWidth={1.6}>
              <circle cx="5" cy="12" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="19" cy="19" r="2" />
              <path strokeLinecap="round" d="M7 12h10M17 7l-10 5M17 17L7 12" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-500">No graph data</p>
            <p className="text-xs text-gray-400 mt-1">Select a dataset and load its graph</p>
          </div>
        </div>
      )}

      {/* ── Top-left controls bar ── */}
      <div className="absolute top-3 left-3 flex items-center gap-2 flex-wrap">

        {/* Back to all (ego view) */}
        {focusedNodeId && (
          <button
            onClick={() => { setFocusedNodeId(null); setSelectedNode(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold shadow hover:bg-indigo-700 transition-colors"
          >
            <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Show all
          </button>
        )}

        {/* Layout toggle group */}
        <div className="flex bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
          {(["force", "hierarchy", "radial"] as LayoutMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setLayout(mode)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-r border-gray-100 last:border-r-0 ${
                layout === mode
                  ? "bg-indigo-600 text-white"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-800"
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Freeze physics */}
        <button
          onClick={handleTogglePhysics}
          title={physicsOn ? "Freeze layout" : "Unfreeze layout"}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shadow-sm border transition-colors ${
            physicsOn
              ? "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
              : "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100"
          }`}
        >
          {physicsOn ? (
            <>
              <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Freeze
            </>
          ) : (
            <>
              <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Unfreeze
            </>
          )}
        </button>

        {/* Fit view */}
        <button
          onClick={handleFitView}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 transition-colors"
        >
          <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
          Fit
        </button>

        {/* Edge labels toggle */}
        <label className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 shadow-sm cursor-pointer hover:bg-gray-50 transition-colors select-none">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => setShowLabels(e.target.checked)}
            className="accent-indigo-600 w-3 h-3"
          />
          Edge labels
        </label>
      </div>

      {/* ── Bottom-left stats ── */}
      {data && (
        <div className="absolute bottom-3 left-3 flex gap-2">
          <span className="px-2.5 py-1 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg text-[11px] text-gray-500 shadow-sm font-medium">
            {nodeCount} nodes
          </span>
          <span className="px-2.5 py-1 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg text-[11px] text-gray-500 shadow-sm font-medium">
            {edgeCount} edges
          </span>
          {focusedNodeId && (
            <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 rounded-lg text-[11px] text-indigo-600 shadow-sm font-medium">
              Ego view · {focusedNodeId.slice(0, 20)}
            </span>
          )}
        </div>
      )}

      {/* ── Bottom-right hint (hide when inspector open) ── */}
      {data && !focusedNodeId && !selectedNode && (
        <div className="absolute bottom-3 right-3 px-2.5 py-1 bg-white/80 backdrop-blur-sm border border-gray-100 rounded-lg text-[10px] text-gray-400 shadow-sm">
          Click to inspect · Double-click to focus
        </div>
      )}

      {/* ── Node inspector — full-height right sidebar ── */}
      <div
        className={`absolute top-0 right-0 h-full w-80 bg-white border-l border-gray-200 shadow-2xl flex flex-col transition-transform duration-200 ease-in-out z-20 ${
          selectedNode ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selectedNode && tc && (
          <>
            {/* Header */}
            <div
              className="px-5 py-4 flex items-start justify-between gap-3 shrink-0"
              style={{ background: tc.bg, borderBottom: `2px solid ${tc.border}` }}
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 break-words leading-snug">{selectedNode.label}</p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: tc.border }} />
                  <span className="text-xs font-semibold" style={{ color: tc.border }}>
                    {selectedNode.type || "Unknown"}
                  </span>
                </div>
              </div>
            <button
              onClick={() => {
                setSelectedNode(null);
                if (nodesDSRef.current && origNodesRef.current.length) {
                  nodesDSRef.current.clear();
                  nodesDSRef.current.add(origNodesRef.current);
                }
                if (edgesDSRef.current && origEdgesRef.current.length) {
                  edgesDSRef.current.clear();
                  edgesDSRef.current.add(origEdgesRef.current);
                }
              }}
              className="text-gray-400 hover:text-gray-700 transition-colors shrink-0 mt-0.5 p-1 rounded-lg hover:bg-black/5"
            >
                <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Stats row */}
            <div className="flex divide-x divide-gray-100 border-b border-gray-100 shrink-0">
              <div className="flex-1 py-3 text-center">
                <div className="text-lg font-bold text-gray-800">{selectedNode.degree}</div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">Connections</div>
              </div>
              <div className="flex-1 py-3 text-center">
                <div className="text-sm font-bold text-gray-800 font-mono truncate px-2">{selectedNode.id.slice(0, 8)}</div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">ID prefix</div>
              </div>
            </div>

            {/* Scrollable properties — curated fields only */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {(["name", "description", "relation", "version"] as const).map((key) => {
                const raw = selectedNode.properties?.[key];
                if (raw === null || raw === undefined || raw === "") return null;
                const strVal = typeof raw === "object" ? JSON.stringify(raw, null, 2) : String(raw);
                return (
                  <div key={key}>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">
                      {key}
                    </div>
                    <div className="text-xs text-gray-700 leading-relaxed break-words whitespace-pre-wrap bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                      {strVal}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer: Explore button */}
            <div className="px-5 py-4 border-t border-gray-100 shrink-0">
              <button
                onClick={() => {
                if (nodesDSRef.current && origNodesRef.current.length) {
                  nodesDSRef.current.clear();
                  nodesDSRef.current.add(origNodesRef.current);
                }
                if (edgesDSRef.current && origEdgesRef.current.length) {
                  edgesDSRef.current.clear();
                  edgesDSRef.current.add(origEdgesRef.current);
                }
                setFocusedNodeId(selectedNode.id);
                setSelectedNode(null);
              }}
                className="w-full py-2.5 rounded-xl text-xs font-semibold transition-all hover:brightness-95"
                style={{ background: tc.bg, color: tc.border, border: `1.5px solid ${tc.border}` }}
              >
                Explore neighbourhood →
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Type legend — shifts left when inspector is open ── */}
      {data && nodeCount > 0 && (
        <TypeLegend nodes={data.nodes} hiddenTypes={hiddenTypes} inspectorOpen={!!selectedNode} />
      )}
    </div>
  );
}

// ── Type legend ────────────────────────────────────────────────────────────────

function TypeLegend({
  nodes,
  hiddenTypes,
  inspectorOpen,
}: {
  nodes: VisGraphNode[];
  hiddenTypes: Set<string>;
  inspectorOpen: boolean;
}) {
  const types = Array.from(new Set(nodes.map((n) => n.type).filter(Boolean))) as string[];
  if (types.length === 0) return null;

  return (
    <div
      className="absolute bottom-3 flex gap-2 flex-wrap justify-center px-3 py-2 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-xl shadow-sm max-w-lg transition-all duration-200"
      style={{
        left: inspectorOpen ? "calc(50% - 160px)" : "50%",
        transform: inspectorOpen ? "translateX(0)" : "translateX(-50%)",
      }}
    >
      {types.map((t) => {
        const tc     = typeColor(t);
        const hidden = hiddenTypes.has(t);
        return (
          <div key={t} className={`flex items-center gap-1 transition-opacity ${hidden ? "opacity-30" : ""}`}>
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: tc.border }} />
            <span className="text-[10px] font-medium text-gray-500">{t}</span>
          </div>
        );
      })}
    </div>
  );
}
