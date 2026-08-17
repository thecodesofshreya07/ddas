import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ReactFlow, { Background, Controls, MarkerType } from "reactflow";
import "reactflow/dist/style.css";
import EmptyState from "./ui/EmptyState";
import SimilarityBreakdown from "./SimilarityBreakdown";

const TYPE_COLORS = {
  exact_duplicate: "#E11D48",
  new_version: "#F59E0B",
  subset: "#F59E0B",
  superset: "#F59E0B",
  related: "#14B8A6",
};

export default function LineageGraph({ currentVersionId, relationships }) {
  const [selected, setSelected] = useState(null);

  const { nodes, edges } = useMemo(() => {
    const nodeIds = new Set([currentVersionId]);
    relationships.forEach((r) => {
      nodeIds.add(r.version_a_id);
      nodeIds.add(r.version_b_id);
    });

    const idList = [...nodeIds];
    const nodes = idList.map((id, i) => ({
      id,
      position: { x: (i % 4) * 220, y: Math.floor(i / 4) * 140 },
      data: { label: id === currentVersionId ? "This version" : id.slice(0, 8) },
      style: {
        background: id === currentVersionId ? "#0D1526" : "#fff",
        color: id === currentVersionId ? "#F5F7FA" : "#0F172A",
        border: `1.5px solid ${id === currentVersionId ? "#14B8A6" : "#DDE3EC"}`,
        borderRadius: 3,
        fontSize: 12,
        fontFamily: "JetBrains Mono, monospace",
        padding: 8,
        width: 180,
        cursor: "pointer",
      },
    }));

    const edges = relationships.map((r, i) => ({
      id: `e${i}`,
      source: r.version_a_id,
      target: r.version_b_id,
      label: `${r.relationship_type.replace(/_/g, " ")} · ${parseFloat(r.similarity_score).toFixed(0)}%`,
      labelStyle: { fontSize: 10, fontFamily: "JetBrains Mono, monospace" },
      style: { stroke: TYPE_COLORS[r.relationship_type] || "#94A3B8" },
      markerEnd: { type: MarkerType.ArrowClosed, color: TYPE_COLORS[r.relationship_type] || "#94A3B8" },
    }));

    return { nodes, edges };
  }, [currentVersionId, relationships]);

  function handleNodeClick(_, node) {
    const rel = relationships.find(
      (r) => r.version_a_id === node.id || r.version_b_id === node.id
    );
    setSelected({ nodeId: node.id, relationship: rel });
  }

  if (relationships.length === 0) {
    return (
      <EmptyState
        title="No related versions detected"
        description="This dataset hasn't matched any other version in the registry by content, structure, or metadata."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div style={{ height: 320 }} className="lg:col-span-2 bg-white border border-ink-200 rounded-sm">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          onNodeClick={handleNodeClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#DDE3EC" gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="bg-white border border-ink-200 rounded-sm p-4">
        <div className="text-xs uppercase tracking-wide text-ink-600 font-medium mb-3">
          Node detail
        </div>
        {!selected ? (
          <p className="text-xs text-ink-500">Click a node in the graph to see relationship evidence.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-[11px] text-ink-600">Version</div>
              <div className="tag-mono text-xs text-ink-900">{selected.nodeId}</div>
            </div>
            {selected.relationship && (
              <>
                <SimilarityBreakdown
                  compact
                  breakdown={selected.relationship.score_breakdown}
                  totalScore={parseFloat(selected.relationship.similarity_score)}
                  relationshipType={selected.relationship.relationship_type}
                />
                <Link
                  to={`/alerts/${selected.relationship.id}`}
                  className="inline-block text-xs font-medium text-verify-700 hover:text-verify-600"
                >
                  Open investigation →
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
