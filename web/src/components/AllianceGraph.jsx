import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { byPower, formatAlliance, formatPower, formatServer, GROUP, membersOf, sortByName } from "../format";

// Each server is drawn as three rows: family hubs on top, alliances in the middle, academy hubs
// below. Every alliance appears once and connects to each family and academy it belongs to.
const COLORS = {
  family: "#2563eb",
  academy: "#16a34a",
  root: "#d97706",
  link: "#7c3aed", // academy protected by family
  allianceBorder: "#94a3b8",
};

const ROW_GAP = 130; // vertical distance between the hub rows and the alliance row
const ALLIANCE_H = 40;
const HUB_H = 30;
const NODE_GAP = 18; // horizontal space between neighbours in a row
const NODE_PAD_X = 12;

const SERVER_PAD = 28;
const SERVER_GAP = 60;
const SERVER_LABEL_SPACE = 28;
const EMPTY_SERVER = { width: 220, height: 90 };

const LABEL_MAX = 28;
const truncate = (s) => (Array.from(s).length > LABEL_MAX ? Array.from(s).slice(0, LABEL_MAX - 1).join("") + "…" : s);
const keyOf = (kind, id) => `${kind}:${id}`;

// Default left-to-right order of a server's alliances: anything the user arranged by dragging
// first, then grouped by first family (root first), then by first academy, strongest first.
function orderAlliances(alliances, families, academies) {
  const familyIndex = new Map(families.map((f, i) => [f.id, i]));
  const academyIndex = new Map(academies.map((a, i) => [a.id, families.length + i]));
  const rootIds = new Set(families.map((f) => f.rootId));
  const groupOf = (a) =>
    Math.min(
      Infinity,
      ...a.familyIds.map((id) => familyIndex.get(id) ?? Infinity),
      ...(a.familyIds.length ? [] : a.academyIds.map((id) => academyIndex.get(id) ?? Infinity)),
    );
  return [...alliances].sort((a, b) => {
    const pa = a.position ?? Infinity;
    const pb = b.position ?? Infinity;
    if (pa !== pb) return pa - pb;
    const ga = groupOf(a);
    const gb = groupOf(b);
    if (ga !== gb) return ga - gb;
    if (rootIds.has(a.id) !== rootIds.has(b.id)) return rootIds.has(a.id) ? -1 : 1;
    return byPower(a, b);
  });
}

// Place hubs over the average position of their members, then push apart any that overlap.
function placeHubs(hubs, rowRight) {
  const desired = hubs.map((h) => ({ h, x: h.memberXs.length ? d3.mean(h.memberXs) : null }));
  const placed = desired.filter((d) => d.x !== null).sort((a, b) => a.x - b.x);
  const empty = desired.filter((d) => d.x === null);
  let prev = null;
  for (const d of placed) {
    if (prev) d.x = Math.max(d.x, prev.x + (prev.h.width + d.h.width) / 2 + NODE_GAP);
    prev = d;
  }
  // Pushing apart drifts right; shift back so the row stays centred over its members.
  if (placed.length) {
    const shift = d3.mean(placed, (d) => d.h.memberXs.length && d3.mean(d.h.memberXs)) - d3.mean(placed, (d) => d.x);
    placed.forEach((d) => (d.x += shift));
  }
  // Groups with no members yet go to the right of everything else.
  let x = Math.max(rowRight, prev ? prev.x + prev.h.width / 2 : 0) + NODE_GAP;
  for (const d of empty) {
    d.x = x + d.h.width / 2;
    x += d.h.width + NODE_GAP;
  }
  desired.forEach((d) => (d.h.x = d.x));
}

export default function AllianceGraph({ servers, families, academies, alliances, selected, onSelect, onReorder }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const zoomTransform = useRef(null); // null until the user zooms/pans; until then we auto-fit
  const fitRef = useRef(null);
  const highlightRef = useRef(null);
  // Refs so the drawing effect always calls the latest callbacks without redrawing for them.
  const selectedRef = useRef(selected);
  const callbacks = useRef({});
  selectedRef.current = selected;
  callbacks.current = { onSelect, onReorder };
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

    const svg = d3.select(svgRef.current).attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    const viewport = svg.append("g");
    const familyById = new Map(families.map((f) => [f.id, f]));
    const academyById = new Map(academies.map((a) => [a.id, a]));

    const showTooltip = (event, lines) => {
      const [x, y] = d3.pointer(event, wrapRef.current);
      setTooltip({ x, y, lines });
    };
    const hideTooltip = () => setTooltip(null);
    const names = (ids, byId) => ids.map((id) => byId.get(id)?.name).filter(Boolean).join(", ") || "none";

    const nodes = []; // every drawn node: { kind, id, g } for highlighting
    const edges = []; // every drawn edge: { path, ends: [key, key] }

    // A rounded box with up to two lines of text, sized to the text. Returns the group.
    const drawBox = (parent, { kind, id, lines, height, cls }) => {
      const g = parent.append("g").attr("class", `gnode ${cls}`).datum({ kind, id });
      const rect = g.append("rect").attr("height", height).attr("y", -height / 2);
      const texts = lines.map((line, i) =>
        g
          .append("text")
          .attr("class", line.cls)
          .attr("text-anchor", "middle")
          .attr("y", lines.length === 1 ? 0 : i === 0 ? -6 : 10)
          .attr("dy", "0.35em")
          .text(line.text),
      );
      const width = Math.max(...texts.map((t) => t.node().getComputedTextLength())) + 2 * NODE_PAD_X;
      rect.attr("width", width).attr("x", -width / 2).attr("rx", kind === "alliance" ? 8 : height / 2);
      g.on("click", (event) => {
        event.stopPropagation();
        callbacks.current.onSelect({ kind, id });
      });
      nodes.push({ kind, id, g });
      return Object.assign(g, { width });
    };

    let cursorX = 0;
    let cursorY = SERVER_LABEL_SPACE;
    let rowHeight = 0;

    for (const server of servers) {
      const sg = viewport.append("g").attr("class", "server");
      const serverBox = sg.append("rect").attr("class", "server-region").attr("rx", 18);
      const content = sg.append("g");
      const edgeLayer = content.append("g");
      const nodeLayer = content.append("g");

      const on = (items) => items.filter((x) => x.server === server);
      const serverFamilies = sortByName(on(families));
      const serverAcademies = sortByName(on(academies));
      const rootIds = new Set(serverFamilies.map((f) => f.rootId));
      const row = orderAlliances(on(alliances), serverFamilies, serverAcademies);

      // Middle row: alliances, side by side.
      const pos = new Map(); // alliance id -> { x, width, g }
      let x = 0;
      for (const a of row) {
        const g = drawBox(nodeLayer, {
          kind: "alliance",
          id: a.id,
          height: ALLIANCE_H,
          cls: `alliance${rootIds.has(a.id) ? " root" : ""}`,
          lines: [
            { text: formatAlliance({ ...a, name: truncate(a.name) }), cls: "box-title" },
            { text: formatPower(a.power), cls: "box-sub" },
          ],
        });
        pos.set(a.id, { x: x + g.width / 2, width: g.width, g });
        g.attr("transform", `translate(${x + g.width / 2},0)`);
        g.on("mouseenter mousemove", (event) =>
          showTooltip(event, [
            formatAlliance(a),
            `Power: ${formatPower(a.power)}`,
            `Families: ${names(a.familyIds, familyById)}`,
            `Academies: ${names(a.academyIds, academyById)}`,
          ]),
        ).on("mouseleave", hideTooltip);
        x += g.width + NODE_GAP;
      }
      const rowRight = Math.max(0, x - NODE_GAP);

      // Hub rows: families above, academies below (only drawn when the server has any).
      const hubs = {};
      for (const [kind, groups, y] of [
        ["family", serverFamilies, -ROW_GAP],
        ["academy", serverAcademies, ROW_GAP],
      ]) {
        hubs[kind] = new Map();
        for (const group of groups) {
          const members = membersOf(kind, group.id, row);
          const g = drawBox(nodeLayer, {
            kind,
            id: group.id,
            height: HUB_H,
            cls: `hub hub-${kind}`,
            lines: [{ text: `${truncate(group.name)} (${members.length})`, cls: "hub-title" }],
          });
          g.on("mouseenter mousemove", (event) => {
            const root = kind === "family" && alliances.find((a) => a.id === group.rootId);
            showTooltip(event, [
              `${GROUP[kind].label}: ${group.name}`,
              `${members.length} alliance(s)`,
              ...(root ? [`Root: ${formatAlliance(root)}`] : []),
            ]);
          }).on("mouseleave", hideTooltip);
          hubs[kind].set(group.id, { g, width: g.width, y, memberXs: members.map((m) => pos.get(m.id).x) });
        }
        placeHubs([...hubs[kind].values()], rowRight);
        hubs[kind].forEach((h) => h.g.attr("transform", `translate(${h.x},${h.y})`));
      }

      // Edges. Alliance ends are read from `pos` so they can follow an alliance being dragged.
      const addEdge = (cls, ends, d) => {
        const path = edgeLayer.append("path").attr("class", `edge ${cls}`);
        const edge = { path, ends, d };
        edges.push(edge);
        return edge;
      };
      const vertical = d3.linkVertical();
      for (const a of row) {
        for (const id of a.familyIds) {
          const hub = hubs.family.get(id);
          if (!hub) continue;
          const isRoot = familyById.get(id)?.rootId === a.id;
          addEdge(isRoot ? "edge-root" : "edge-family", [keyOf("family", id), keyOf("alliance", a.id)], () =>
            vertical({ source: [hub.x, hub.y + HUB_H / 2], target: [pos.get(a.id).x, -ALLIANCE_H / 2] }),
          );
        }
        for (const id of a.academyIds) {
          const hub = hubs.academy.get(id);
          if (!hub) continue;
          addEdge("edge-academy", [keyOf("academy", id), keyOf("alliance", a.id)], () =>
            vertical({ source: [pos.get(a.id).x, ALLIANCE_H / 2], target: [hub.x, hub.y - HUB_H / 2] }),
          );
        }
      }
      // Academy protected by a family: an arc from the family hub around the side to the academy.
      for (const academy of serverAcademies) {
        const to = hubs.academy.get(academy.id);
        for (const familyId of academy.familyIds) {
          const from = hubs.family.get(familyId);
          if (!from) continue;
          const left = Math.min(from.x - from.width / 2, to.x - to.width / 2);
          const bulge = Math.min(left, -20) - 40 - 14 * edges.filter((e) => e.path.classed("edge-link")).length;
          addEdge("edge-link", [keyOf("family", familyId), keyOf("academy", academy.id)], () =>
            `M${from.x - from.width / 2},${from.y} C${bulge},${from.y} ${bulge},${to.y} ${to.x - to.width / 2},${to.y}`,
          );
        }
      }
      const redrawEdges = () => edges.forEach((e) => e.path.attr("d", e.d()));
      redrawEdges();

      // Drag an alliance sideways to reorder the row; the new order is saved on release.
      if (row.length > 1) {
        for (const a of row) {
          const p = pos.get(a.id);
          let moved = false;
          p.g.classed("draggable", true).call(
            d3
              .drag()
              // Explicit subject: d3 would otherwise use the node's datum.
              .subject(() => ({ x: p.x, y: 0 }))
              .on("drag", (event) => {
                if (!moved) {
                  moved = true;
                  p.g.raise().classed("dragging", true);
                }
                hideTooltip();
                p.x = event.x;
                p.g.attr("transform", `translate(${p.x},0)`);
                redrawEdges();
              })
              .on("end", () => {
                p.g.classed("dragging", false);
                if (!moved) return;
                moved = false;
                const ids = [...row].sort((m, n) => pos.get(m.id).x - pos.get(n.id).x).map((m) => m.id);
                if (ids.some((id, i) => id !== row[i].id)) callbacks.current.onReorder(ids);
                else {
                  // Same order: snap back to the slot.
                  const i = row.indexOf(a);
                  p.x = row.slice(0, i).reduce((sum, m) => sum + pos.get(m.id).width + NODE_GAP, p.width / 2);
                  p.g.attr("transform", `translate(${p.x},0)`);
                  redrawEdges();
                }
              }),
          );
        }
      }

      let w, h;
      if (row.length || serverFamilies.length || serverAcademies.length) {
        const b = content.node().getBBox();
        w = b.width + 2 * SERVER_PAD;
        h = b.height + 2 * SERVER_PAD;
        content.attr("transform", `translate(${SERVER_PAD - b.x},${SERVER_PAD - b.y})`);
      } else {
        ({ width: w, height: h } = EMPTY_SERVER);
        content
          .append("text")
          .attr("class", "server-empty")
          .attr("x", w / 2)
          .attr("y", h / 2)
          .attr("dy", "0.35em")
          .attr("text-anchor", "middle")
          .text("No alliances yet");
      }
      serverBox.attr("width", w).attr("height", h);
      sg.append("text")
        .attr("class", "server-label")
        .attr("x", w / 2)
        .attr("y", -10)
        .attr("text-anchor", "middle")
        .text(formatServer(server));

      if (cursorX > 0 && cursorX + w > width - 40) {
        cursorX = 0;
        cursorY += rowHeight + SERVER_GAP;
        rowHeight = 0;
      }
      sg.attr("transform", `translate(${cursorX},${cursorY})`);
      cursorX += w + SERVER_GAP;
      rowHeight = Math.max(rowHeight, h);
    }

    // The selected node gets a bold outline and its connections are emphasised; nothing fades.
    const highlight = (sel) => {
      const key = sel && keyOf(sel.kind, sel.id);
      nodes.forEach((n) => n.g.classed("selected", keyOf(n.kind, n.id) === key));
      edges.forEach((e) => e.path.classed("emphasis", Boolean(key) && e.ends.includes(key)));
    };
    highlightRef.current = highlight;
    highlight(selectedRef.current);
    svg.on("click", () => callbacks.current.onSelect(null));

    const zoom = d3
      .zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        viewport.attr("transform", event.transform);
        if (event.sourceEvent) zoomTransform.current = event.transform; // user zoomed/panned
      });
    svg.call(zoom).on("dblclick.zoom", null);

    const fit = () => {
      const b = viewport.node().getBBox();
      if (!b.width) return;
      const scale = Math.min(1, (width - 40) / b.width, (height - 40) / b.height);
      const tx = (width - b.width * scale) / 2 - b.x * scale;
      const ty = 20 - b.y * scale;
      zoomTransform.current = null;
      svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    };
    fitRef.current = fit;
    if (zoomTransform.current) svg.call(zoom.transform, zoomTransform.current);
    else fit();
  }, [servers, families, academies, alliances, size]);

  useEffect(() => {
    highlightRef.current?.(selected);
  }, [selected]);

  return (
    <div className="graph" ref={wrapRef}>
      <svg ref={svgRef} />
      {servers.length === 0 && (
        <p className="graph-empty">No servers yet. Create a Server/Kingdom to get started.</p>
      )}
      <Legend />
      {servers.length > 0 && (
        <button className="btn btn-secondary fit-btn" onClick={() => fitRef.current?.()}>
          Fit
        </button>
      )}
      {tooltip && (
        <div className="tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
          <strong>{tooltip.lines[0]}</strong>
          {tooltip.lines.slice(1).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Collapsed state is remembered per browser; storage may be unavailable, which is fine.
const LEGEND_KEY = "allygraph.legendCollapsed";

function Legend() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(LEGEND_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(LEGEND_KEY, c ? "0" : "1");
      } catch {
        // Not remembering is fine.
      }
      return !c;
    });
  };

  return (
    <div className={`legend${collapsed ? " collapsed" : ""}`}>
      <button className="legend-toggle" onClick={toggle} aria-expanded={!collapsed}>
        <span className="chevron" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        Legend
      </button>
      {!collapsed && <LegendBody />}
    </div>
  );
}

const swatch = (fill, stroke, rx) => (
  <svg width="26" height="16">
    <rect x="1" y="2" width="24" height="12" rx={rx} fill={fill} stroke={stroke} strokeWidth="1.5" />
  </svg>
);
const line = (cls) => (
  <svg width="26" height="16">
    <path className={`edge ${cls}`} d="M1,8 H25" />
  </svg>
);

function LegendBody() {
  return (
    <div className="legend-body">
      <div className="legend-row">{swatch(COLORS.family, COLORS.family, 6)} Family</div>
      <div className="legend-row">{swatch(COLORS.academy, COLORS.academy, 6)} Academy</div>
      <div className="legend-row">{swatch("#fff", COLORS.allianceBorder, 3)} Alliance</div>
      <div className="legend-row">{swatch("#fff7ed", COLORS.root, 3)} Root of a family</div>
      <div className="legend-row">{line("edge-family")} Family member</div>
      <div className="legend-row">{line("edge-root")} Family root</div>
      <div className="legend-row">{line("edge-academy")} Academy member</div>
      <div className="legend-row">{line("edge-link")} Family protects academy</div>
      <div className="legend-row">
        <svg width="26" height="16">
          <rect className="server-region" x="1" y="2" width="24" height="12" rx="4" />
        </svg>
        Server/Kingdom
      </div>
      <div className="legend-hint">
        Scroll to zoom · drag background to pan · drag alliances sideways to reorder · click anything for
        details
      </div>
    </div>
  );
}
