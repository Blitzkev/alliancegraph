import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { formatAlliance, TYPE_LABELS } from "../format";

const NODE = {
  root: { r: 22, color: "#d97706" },
  family: { r: 15, color: "#2563eb" },
  academy: { r: 11, color: "#16a34a" },
};

const LINK = {
  "root-family": { color: "#2563eb", width: 2.5, dash: null, opacity: 0.9, distance: 110 },
  "root-academy": { color: "#16a34a", width: 2, dash: "6 4", opacity: 0.9, distance: 150 },
  "family-family": { color: "#2563eb", width: 1.2, dash: null, opacity: 0.35, distance: 120 },
  "academy-academy": { color: "#16a34a", width: 1, dash: "3 3", opacity: 0.3, distance: 90 },
};

// Tints for root "umbrella" regions; kept away from the node type colors.
const UMBRELLA_TINTS = ["#8b5cf6", "#ec4899", "#64748b", "#a16207", "#0d9488", "#be123c"];

const LABEL_MAX = 28;
const truncate = (s) => (Array.from(s).length > LABEL_MAX ? Array.from(s).slice(0, LABEL_MAX - 1).join("") + "…" : s);

function buildGraph(alliances) {
  const nodes = alliances.map((a) => ({ ...a, umbrella: a.rootId || a.id }));
  const links = [];
  for (const root of nodes.filter((n) => n.type === "root")) {
    const families = nodes.filter((n) => n.rootId === root.id && n.type === "family");
    const academies = nodes.filter((n) => n.rootId === root.id && n.type === "academy");
    families.forEach((f) => links.push({ source: root.id, target: f.id, kind: "root-family" }));
    academies.forEach((a) => links.push({ source: root.id, target: a.id, kind: "root-academy" }));
    // Members at the same level are all linked to each other.
    for (const [group, kind] of [[families, "family-family"], [academies, "academy-academy"]]) {
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++)
          links.push({ source: group[i].id, target: group[j].id, kind });
    }
  }
  return { nodes, links };
}

// Hull around a set of circles: sample points on each padded circle, then take the convex hull.
// Works for 1 or 2 nodes too, where a plain point hull would be degenerate.
function umbrellaPath(members) {
  const pts = [];
  for (const n of members) {
    const pad = NODE[n.type].r + 26;
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * 2 * Math.PI;
      pts.push([n.x + pad * Math.cos(t), n.y + pad * Math.sin(t)]);
    }
  }
  const hull = d3.polygonHull(pts);
  return hull ? d3.line().curve(d3.curveCatmullRomClosed.alpha(0.5))(hull) : null;
}

export default function AllianceGraph({ alliances }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const positions = useRef(new Map()); // id -> {x, y}, kept across re-renders
  const zoomTransform = useRef(d3.zoomIdentity);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState(null);

  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const { width, height } = size;
    if (!width || !height) return;

    const byId = new Map(alliances.map((a) => [a.id, a]));
    const { nodes, links } = buildGraph(alliances);
    for (const n of nodes) {
      const p = positions.current.get(n.id);
      if (p) Object.assign(n, p);
      else {
        // Start new members next to their root so they don't fly in from the corner.
        const anchor = positions.current.get(n.rootId);
        n.x = (anchor ? anchor.x : width / 2) + (Math.random() - 0.5) * 60;
        n.y = (anchor ? anchor.y : height / 2) + (Math.random() - 0.5) * 60;
      }
    }

    const svg = d3.select(svgRef.current).attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    const viewport = svg.append("g");

    const zoom = d3
      .zoom()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        zoomTransform.current = event.transform;
        viewport.attr("transform", event.transform);
      });
    svg.call(zoom).call(zoom.transform, zoomTransform.current).on("dblclick.zoom", null);

    const umbrellas = d3.groups(nodes, (n) => n.umbrella).map(([id, members], i) => ({
      id,
      members,
      tint: UMBRELLA_TINTS[i % UMBRELLA_TINTS.length],
    }));

    const hull = viewport
      .append("g")
      .selectAll("path")
      .data(umbrellas)
      .join("path")
      .attr("class", "umbrella")
      .attr("fill", (u) => u.tint)
      .attr("fill-opacity", 0.1)
      .attr("stroke", (u) => u.tint)
      .attr("stroke-opacity", 0.45)
      .attr("stroke-width", 1.5);

    const link = viewport
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (l) => LINK[l.kind].color)
      .attr("stroke-width", (l) => LINK[l.kind].width)
      .attr("stroke-dasharray", (l) => LINK[l.kind].dash)
      .attr("stroke-opacity", (l) => LINK[l.kind].opacity);

    const node = viewport
      .append("g")
      .selectAll("g")
      .data(nodes, (n) => n.id)
      .join("g")
      .attr("class", "node");

    node
      .append("circle")
      .attr("r", (n) => NODE[n.type].r)
      .attr("fill", (n) => NODE[n.type].color)
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);

    node
      .append("text")
      .attr("class", (n) => `label label-${n.type}`)
      .attr("text-anchor", "middle")
      .attr("dy", (n) => NODE[n.type].r + 15)
      .text((n) => formatAlliance({ ...n, name: truncate(n.name) }));

    // Hover tooltip with full details.
    node
      .on("mouseenter", (event, n) => {
        const root = byId.get(n.rootId);
        const [x, y] = d3.pointer(event, wrapRef.current);
        setTooltip({
          x,
          y,
          title: formatAlliance(n),
          type: TYPE_LABELS[n.type],
          root: root ? formatAlliance(root) : null,
          members: n.type === "root" ? alliances.filter((a) => a.rootId === n.id).length : null,
        });
      })
      .on("mousemove", (event) => {
        const [x, y] = d3.pointer(event, wrapRef.current);
        setTooltip((t) => t && { ...t, x, y });
      })
      .on("mouseleave", () => setTooltip(null));

    // Click a node to spotlight its umbrella; click the background to clear.
    const spotlight = (umbrellaId) => {
      const dim = (d) => umbrellaId && d !== umbrellaId;
      node.classed("dimmed", (n) => dim(n.umbrella));
      link.classed("dimmed", (l) => dim(l.source.umbrella));
      hull.classed("dimmed", (u) => dim(u.id));
    };
    node.on("click", (event, n) => {
      event.stopPropagation();
      spotlight(n.umbrella);
    });
    svg.on("click", () => spotlight(null));

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((n) => n.id)
          .distance((l) => LINK[l.kind].distance)
          .strength((l) => (l.kind.startsWith("root") ? 0.7 : 0.15)),
      )
      .force("charge", d3.forceManyBody().strength((n) => (n.type === "root" ? -900 : -300)))
      .force("collide", d3.forceCollide((n) => NODE[n.type].r + 40))
      .force("x", d3.forceX(width / 2).strength(0.04))
      .force("y", d3.forceY(height / 2).strength(0.04));

    // Settled graphs re-render without a big jolt; new graphs get a full layout.
    if (nodes.every((n) => positions.current.has(n.id))) simulation.alpha(0.3);

    simulation.on("tick", () => {
      link
        .attr("x1", (l) => l.source.x)
        .attr("y1", (l) => l.source.y)
        .attr("x2", (l) => l.target.x)
        .attr("y2", (l) => l.target.y);
      node.attr("transform", (n) => `translate(${n.x},${n.y})`);
      hull.attr("d", (u) => umbrellaPath(u.members));
      for (const n of nodes) positions.current.set(n.id, { x: n.x, y: n.y });
    });

    node.call(
      d3
        .drag()
        .on("start", (event, n) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          n.fx = n.x;
          n.fy = n.y;
        })
        .on("drag", (event, n) => {
          n.fx = event.x;
          n.fy = event.y;
        })
        .on("end", (event, n) => {
          if (!event.active) simulation.alphaTarget(0);
          n.fx = null;
          n.fy = null;
        }),
    );

    return () => simulation.stop();
  }, [alliances, size]);

  return (
    <div className="graph" ref={wrapRef}>
      <svg ref={svgRef} />
      {alliances.length === 0 && (
        <p className="graph-empty">No alliances yet. Create a Root Alliance to get started.</p>
      )}
      <Legend />
      {tooltip && (
        <div className="tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
          <strong>{tooltip.title}</strong>
          <div>{tooltip.type} alliance</div>
          {tooltip.root && <div>Under: {tooltip.root}</div>}
          {tooltip.members !== null && <div>Members: {tooltip.members}</div>}
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      {Object.entries(NODE).map(([type, { color }]) => (
        <div key={type} className="legend-row">
          <svg width="22" height="16">
            <circle cx="11" cy="8" r="6" fill={color} />
          </svg>
          {TYPE_LABELS[type]} alliance
        </div>
      ))}
      {[
        ["root-family", "Root ↔ Family"],
        ["root-academy", "Root ↔ Academy"],
        ["family-family", "Family ↔ Family"],
        ["academy-academy", "Academy ↔ Academy"],
      ].map(([kind, label]) => (
        <div key={kind} className="legend-row">
          <svg width="22" height="16">
            <line
              x1="1" y1="8" x2="21" y2="8"
              stroke={LINK[kind].color}
              strokeWidth={Math.max(LINK[kind].width, 1.5)}
              strokeDasharray={LINK[kind].dash}
              strokeOpacity={Math.max(LINK[kind].opacity, 0.6)}
            />
          </svg>
          {label}
        </div>
      ))}
      <div className="legend-row">
        <svg width="22" height="16">
          <rect x="1" y="2" width="20" height="12" rx="6" fill="#8b5cf6" fillOpacity="0.15" stroke="#8b5cf6" strokeOpacity="0.5" />
        </svg>
        Root umbrella
      </div>
      <div className="legend-hint">Drag nodes · scroll to zoom · click to highlight</div>
    </div>
  );
}
