import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import {
  byPower,
  familyAcademies,
  familyLeader,
  familyMembers,
  formatAlliance,
  formatFamily,
  formatPower,
  formatServer,
  sortFamilies,
} from "../format";

// The selected kingdom (server) is drawn as a stack of bands: each family (oldest first) followed by
// a band of its academies, then independent alliances. A band is a hub on the left with alliances in
// a row to its right. Every alliance appears exactly once; allied links are dashed curves from a
// family's hub to the alliance.
const COLORS = {
  family: "#2563eb",
  academy: "#16a34a",
  root: "#d97706",
  link: "#7c3aed", // academy protected by family
  allianceBorder: "#94a3b8",
};

const ALLIANCE_H = 40;
const HUB_H = 30;
const NODE_GAP = 18; // horizontal space between alliances in a band
const NODE_PAD_X = 12;
const MEMBERS_INDENT = 36; // gap between the hub column and the first alliance
const DROP = 44; // from a band's bus line down to its alliances' centres
const BAND_GAP = 30; // vertical space between bands
const ARC_STEP = 14; // spacing between "protects" arcs in the left margin


const LABEL_MAX = 28;
const truncate = (s) => (Array.from(s).length > LABEL_MAX ? Array.from(s).slice(0, LABEL_MAX - 1).join("") + "…" : s);
const keyOf = (kind, id) => `${kind}:${id}`;

// Order within a band: anything the user arranged by dragging first, then strongest (so a family's
// leader comes first).
const bandOrder = (a, b) => {
  const pa = a.position ?? Infinity;
  const pb = b.position ?? Infinity;
  if (pa !== pb) return pa - pb;
  return byPower(a, b);
};

export default function AllianceGraph({ server, families, alliances, selected, onSelect, onReorder }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const zoomTransform = useRef(null); // null until the user zooms/pans; until then we auto-fit
  const shownServer = useRef(server);
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

    const showTooltip = (event, lines) => {
      const [x, y] = d3.pointer(event, wrapRef.current);
      setTooltip({ x, y, lines });
    };
    const hideTooltip = () => setTooltip(null);
    const familyNames = (ids) => ids.map((id) => formatFamily(id, alliances)).join(", ");

    const nodes = []; // every drawn node: { kind, id, g } for highlighting
    const edges = []; // every drawn edge: { path, ends: [key, key], d }

    // A rounded box with up to two lines of text, sized to the text. Returns the group.
    const drawBox = (parent, { kind, id, lines, height, cls }) => {
      const g = parent.append("g").attr("class", `gnode ${cls}`).datum({ kind, id });
      const rect = g.append("rect").attr("height", height).attr("y", -height / 2);
      const texts = lines.map((line, i) =>
        g
          .append("text")
          .attr("class", line.cls)
          .attr("text-anchor", "middle")
          .attr("y", lines.length === 1 ? 0 : i === 0 ? -7 : 11)
          .attr("dy", "0.35em")
          .text(line.text),
      );
      const width = Math.max(...texts.map((t) => t.node().getComputedTextLength())) + 2 * NODE_PAD_X;
      rect.attr("width", width).attr("x", -width / 2).attr("rx", kind === "alliance" ? 8 : height / 2);
      if (kind !== "none") {
        g.on("click", (event) => {
          event.stopPropagation();
          callbacks.current.onSelect({ kind, id });
        });
        nodes.push({ kind, id, g });
      }
      return Object.assign(g, { width });
    };

    // Switching kingdom starts from a fresh fit rather than the previous kingdom's zoom.
    if (shownServer.current !== server) {
      shownServer.current = server;
      zoomTransform.current = null;
    }

    if (server) {
      const content = viewport.append("g");
      const edgeLayer = content.append("g");
      const nodeLayer = content.append("g");

      const on = (items) => items.filter((x) => x.server === server);
      const serverAlliances = on(alliances);
      const leaderIds = new Set();

      // Bands: each family, then its academies (if any), then independent alliances.
      const bands = [];
      for (const family of sortFamilies(on(families))) {
        const leader = familyLeader(family.id, alliances);
        if (leader) leaderIds.add(leader.id);
        const label = leader ? truncate(leader.name) : "Family";
        const members = familyMembers(family.id, serverAlliances).sort(bandOrder);
        bands.push({ kind: "family", family, members, label: `${label} family (${members.length})` });
        const academies = familyAcademies(family.id, serverAlliances).sort(bandOrder);
        if (academies.length)
          bands.push({ kind: "academy", family, members: academies, label: `${label} academies (${academies.length})` });
      }
      const independents = serverAlliances.filter((a) => !a.familyId && !a.academyOf).sort(bandOrder);
      if (independents.length)
        bands.push({ kind: "none", members: independents, label: `Independent (${independents.length})` });
      const familyBand = new Map(bands.filter((b) => b.kind === "family").map((b) => [b.family.id, b]));

      // Hubs first, so the hub column can be as wide as the widest hub. Both of a family's hubs
      // select the family.
      for (const band of bands) {
        band.hub = drawBox(nodeLayer, {
          kind: band.kind === "none" ? "none" : "family",
          id: band.family?.id,
          height: HUB_H,
          cls: `hub hub-${band.kind}`,
          lines: [{ text: band.label, cls: "hub-title" }],
        });
        if (band.family) {
          const { id } = band.family;
          band.hub
            .on("mouseenter mousemove", (event) =>
              showTooltip(event, [
                formatFamily(id, alliances),
                `${familyMembers(id, alliances).length} member(s), ${familyAcademies(id, alliances).length} academy alliance(s)`,
                "Led by its strongest member",
              ]),
            )
            .on("mouseleave", hideTooltip);
        }
      }
      const hubColumn = Math.max(0, ...bands.map((b) => b.hub.width));
      const membersX = hubColumn + MEMBERS_INDENT;

      // Lay out the bands top to bottom.
      const pos = new Map(); // alliance id -> { x, y, width, g, band }
      let y = 0;
      for (const band of bands) {
        band.y = y; // the bus line, level with the hub
        band.hubRight = hubColumn;
        band.hub.attr("transform", `translate(${hubColumn - band.hub.width / 2},${y})`);
        band.hubLeft = hubColumn - band.hub.width;
        let x = membersX;
        for (const a of band.members) {
          const g = drawBox(nodeLayer, {
            kind: "alliance",
            id: a.id,
            height: ALLIANCE_H,
            cls: `alliance${leaderIds.has(a.id) ? " root" : ""}`,
            lines: [
              { text: a.tag, cls: "box-title" },
              { text: `Power: ${formatPower(a.power)}`, cls: "box-sub" },
            ],
          });
          const relationship = a.familyId
            ? `${leaderIds.has(a.id) ? "Leads" : "Member of"} ${formatFamily(a.familyId, alliances)}`
            : a.academyOf
              ? `Academy of ${formatFamily(a.academyOf, alliances)}`
              : "Independent";
          g.on("mouseenter mousemove", (event) =>
            showTooltip(event, [
              formatAlliance(a),
              `Power: ${formatPower(a.power)}`,
              relationship,
              ...(a.alliedFamilyIds.length ? [`Allied with: ${familyNames(a.alliedFamilyIds)}`] : []),
            ]),
          ).on("mouseleave", hideTooltip);
          const p = { x: x + g.width / 2, y: y + DROP, width: g.width, g, band };
          g.attr("transform", `translate(${p.x},${p.y})`);
          pos.set(a.id, p);
          x += g.width + NODE_GAP;
        }
        y += (band.members.length ? DROP + ALLIANCE_H / 2 : HUB_H / 2) + BAND_GAP + HUB_H / 2;
      }

      // Edges. Alliance ends are read from `pos` so they follow an alliance being dragged.
      const addEdge = (cls, ends, d) => {
        const path = edgeLayer.append("path").attr("class", `edge ${cls}`);
        edges.push({ path, ends, d });
      };
      for (const band of bands) {
        if (band.kind === "none") continue;
        const familyKey = keyOf("family", band.family.id);
        for (const a of band.members) {
          // Along the band's bus line from the hub, then down into the alliance.
          const cls = band.kind === "academy" ? "edge-academy" : leaderIds.has(a.id) ? "edge-root" : "edge-family";
          addEdge(cls, [familyKey, keyOf("alliance", a.id)], () => {
            const p = pos.get(a.id);
            return `M${band.hubRight},${band.y} H${p.x} V${p.y - ALLIANCE_H / 2}`;
          });
        }
        // A family's academies hang off the family: a short arc down the left margin.
        if (band.kind === "academy") {
          const from = familyBand.get(band.family.id);
          const bulge = Math.min(from.hubLeft, band.hubLeft) - 24;
          addEdge("edge-link", [familyKey], () =>
            `M${from.hubLeft},${from.y} C${bulge},${from.y} ${bulge},${band.y} ${band.hubLeft},${band.y}`,
          );
        }
      }
      // Allied: a dashed curve from the family's hub to the near edge of the alliance.
      for (const a of serverAlliances) {
        for (const familyId of a.alliedFamilyIds) {
          const band = familyBand.get(familyId);
          if (!band) continue;
          addEdge("edge-allied", [keyOf("family", familyId), keyOf("alliance", a.id)], () => {
            const p = pos.get(a.id);
            const sx = band.hubRight;
            const sy = band.y;
            const ty = p.y < sy ? p.y + ALLIANCE_H / 2 : p.y - ALLIANCE_H / 2;
            return `M${sx},${sy} C${sx + 80},${sy} ${p.x},${(sy + ty) / 2} ${p.x},${ty}`;
          });
        }
      }
      const redrawEdges = () => edges.forEach((e) => e.path.attr("d", e.d()));
      redrawEdges();

      // Drag an alliance sideways to reorder its band; the new order is saved on release.
      for (const band of bands) {
        if (band.members.length < 2) continue;
        const slot = (i) =>
          band.members.slice(0, i).reduce((sum, m) => sum + pos.get(m.id).width + NODE_GAP, membersX) +
          pos.get(band.members[i].id).width / 2;
        band.members.forEach((a, i) => {
          const p = pos.get(a.id);
          let moved = false;
          p.g.classed("draggable", true).call(
            d3
              .drag()
              // Explicit subject: d3 would otherwise use the node's datum.
              .subject(() => ({ x: p.x, y: p.y }))
              .on("drag", (event) => {
                if (!moved) {
                  moved = true;
                  p.g.raise().classed("dragging", true);
                }
                hideTooltip();
                p.x = Math.max(membersX + p.width / 2, event.x);
                p.g.attr("transform", `translate(${p.x},${p.y})`);
                redrawEdges();
              })
              .on("end", () => {
                p.g.classed("dragging", false);
                if (!moved) return;
                moved = false;
                const ids = [...band.members].sort((m, n) => pos.get(m.id).x - pos.get(n.id).x).map((m) => m.id);
                if (ids.some((id, j) => id !== band.members[j].id)) callbacks.current.onReorder(ids);
                else {
                  p.x = slot(i); // same order: snap back
                  p.g.attr("transform", `translate(${p.x},${p.y})`);
                  redrawEdges();
                }
              }),
          );
        });
      }

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
  }, [server, families, alliances, size]);

  useEffect(() => {
    highlightRef.current?.(selected);
  }, [selected]);

  const isEmpty = !alliances.some((x) => x.server === server);

  return (
    <div className="graph" ref={wrapRef}>
      <svg ref={svgRef} />
      {!server && <p className="graph-empty">No kingdoms yet. Create a Server/Kingdom to get started.</p>}
      {server && isEmpty && (
        <p className="graph-empty">
          Nothing in {formatServer(server)} yet. Create an alliance to get started.
        </p>
      )}
      <Legend />
      {server && !isEmpty && (
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
      <div className="legend-row">{swatch(COLORS.academy, COLORS.academy, 6)} A family's academies</div>
      <div className="legend-row">{swatch("#e2e8f0", "#94a3b8", 6)} Independent</div>
      <div className="legend-row">{swatch("#fff", COLORS.allianceBorder, 3)} Alliance</div>
      <div className="legend-row">{swatch("#fff7ed", COLORS.root, 3)} Family leader (strongest)</div>
      <div className="legend-row">{line("edge-family")} Family member</div>
      <div className="legend-row">{line("edge-root")} Family leader</div>
      <div className="legend-row">{line("edge-academy")} Academy</div>
      <div className="legend-row">{line("edge-link")} Family's academies</div>
      <div className="legend-row">{line("edge-allied")} Allied with family</div>
      <div className="legend-hint">
        Scroll to zoom · drag background to pan · drag alliances sideways to reorder within their row ·
        click anything for details
      </div>
    </div>
  );
}
