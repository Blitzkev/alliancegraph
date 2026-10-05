import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { byPower, formatAlliance, formatPower, formatServer, GROUP, membersOf } from "../format";

// Each server is a stack of bands, one per family (oldest first), then one per academy, then one
// for alliances in no group. A band is its hub on the left with alliances in a row to its right.
// Every alliance is drawn once, in the band of its first family (else first academy); its other
// groups reach it with a curved line.
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

const SERVER_PAD = 28;
const SERVER_GAP = 60;
const SERVER_LABEL_SPACE = 28;
const EMPTY_SERVER = { width: 220, height: 90 };

const LABEL_MAX = 28;
const truncate = (s) => (Array.from(s).length > LABEL_MAX ? Array.from(s).slice(0, LABEL_MAX - 1).join("") + "…" : s);
const keyOf = (kind, id) => `${kind}:${id}`;
const byCreated = (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "");

// Order within a band: anything the user arranged by dragging first, then the root, then strongest.
const bandOrder = (rootIds) => (a, b) => {
  const pa = a.position ?? Infinity;
  const pb = b.position ?? Infinity;
  if (pa !== pb) return pa - pb;
  if (rootIds.has(a.id) !== rootIds.has(b.id)) return rootIds.has(a.id) ? -1 : 1;
  return byPower(a, b);
};

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
          .attr("y", lines.length === 1 ? 0 : i === 0 ? -6 : 10)
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
      const serverFamilies = on(families).sort(byCreated);
      const serverAcademies = on(academies).sort(byCreated);
      const serverAlliances = on(alliances);
      const rootIds = new Set(serverFamilies.map((f) => f.rootId));

      // Bands: families (oldest first), academies, then alliances in no group.
      const bands = [
        ...serverFamilies.map((group) => ({ kind: "family", group, members: [] })),
        ...serverAcademies.map((group) => ({ kind: "academy", group, members: [] })),
      ];
      const bandOf = new Map(bands.map((b) => [keyOf(b.kind, b.group.id), b]));
      const ungrouped = { kind: "none", group: { id: "none", name: "No family or academy" }, members: [] };
      for (const a of serverAlliances) {
        const home =
          a.familyIds.map((id) => bandOf.get(keyOf("family", id))).filter(Boolean)[0] ||
          a.academyIds.map((id) => bandOf.get(keyOf("academy", id))).filter(Boolean)[0] ||
          ungrouped;
        home.members.push(a);
      }
      if (ungrouped.members.length) bands.push(ungrouped);
      bands.forEach((b) => b.members.sort(bandOrder(rootIds)));

      // Hubs first, so the hub column can be as wide as the widest hub.
      for (const band of bands) {
        const { kind, group } = band;
        const count = kind === "none" ? band.members.length : membersOf(kind, group.id, serverAlliances).length;
        band.hub = drawBox(nodeLayer, {
          kind,
          id: group.id,
          height: HUB_H,
          cls: kind === "none" ? "hub hub-none" : `hub hub-${kind}`,
          lines: [{ text: `${truncate(group.name)} (${count})`, cls: "hub-title" }],
        });
        if (kind !== "none") {
          band.hub
            .on("mouseenter mousemove", (event) => {
              const root = kind === "family" && alliances.find((a) => a.id === group.rootId);
              showTooltip(event, [
                `${GROUP[kind].label}: ${group.name}`,
                `${count} alliance(s)`,
                ...(root ? [`Root: ${formatAlliance(root)}`] : []),
              ]);
            })
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
            cls: `alliance${rootIds.has(a.id) ? " root" : ""}`,
            lines: [
              { text: formatAlliance({ ...a, name: truncate(a.name) }), cls: "box-title" },
              { text: formatPower(a.power), cls: "box-sub" },
            ],
          });
          g.on("mouseenter mousemove", (event) =>
            showTooltip(event, [
              formatAlliance(a),
              `Power: ${formatPower(a.power)}`,
              `Families: ${names(a.familyIds, familyById)}`,
              ...(a.alliedFamilyIds.length ? [`Allied with: ${names(a.alliedFamilyIds, familyById)}`] : []),
              `Academies: ${names(a.academyIds, academyById)}`,
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
      for (const a of serverAlliances) {
        const p = pos.get(a.id);
        for (const [kind, ids, link] of [
          ["family", a.familyIds, "family"],
          ["academy", a.academyIds, "academy"],
          ["family", a.alliedFamilyIds, "allied"], // allies stay in their own row: always a curve
        ]) {
          for (const id of ids) {
            const band = bandOf.get(keyOf(kind, id));
            if (!band) continue;
            const isRoot = link === "family" && familyById.get(id)?.rootId === a.id;
            const cls = isRoot ? "edge-root" : `edge-${link}`;
            if (p.band === band) {
              // Its own band: along the bus line from the hub, then down into the alliance.
              addEdge(cls, [keyOf(kind, id), keyOf("alliance", a.id)], () => {
                return `M${band.hubRight},${band.y} H${pos.get(a.id).x} V${p.y - ALLIANCE_H / 2}`;
              });
            } else {
              // Another band: a curve from this group's hub to the near edge of the alliance.
              addEdge(`${cls} edge-cross`, [keyOf(kind, id), keyOf("alliance", a.id)], () => {
                const sx = band.hubRight;
                const sy = band.y;
                const tx = pos.get(a.id).x;
                const ty = p.y < sy ? p.y + ALLIANCE_H / 2 : p.y - ALLIANCE_H / 2;
                return `M${sx},${sy} C${sx + 80},${sy} ${tx},${(sy + ty) / 2} ${tx},${ty}`;
              });
            }
          }
        }
      }
      // Family protects academy: arcs down the left margin, from hub to hub.
      let arc = 0;
      for (const academy of serverAcademies) {
        const to = bandOf.get(keyOf("academy", academy.id));
        for (const familyId of academy.familyIds) {
          const from = bandOf.get(keyOf("family", familyId));
          if (!from) continue;
          const bulge = Math.min(from.hubLeft, to.hubLeft) - 30 - ARC_STEP * arc++;
          addEdge("edge-link", [keyOf("family", familyId), keyOf("academy", academy.id)], () =>
            `M${from.hubLeft},${from.y} C${bulge},${from.y} ${bulge},${to.y} ${to.hubLeft},${to.y}`,
          );
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

      let w, h;
      if (bands.length) {
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
      <div className="legend-row">{line("edge-allied")} Allied with family</div>
      <div className="legend-row">{line("edge-academy")} Academy member</div>
      <div className="legend-row">{line("edge-link")} Family protects academy</div>
      <div className="legend-row">
        <svg width="26" height="16">
          <rect className="server-region" x="1" y="2" width="24" height="12" rx="4" />
        </svg>
        Server/Kingdom
      </div>
      <div className="legend-hint">
        Scroll to zoom · drag background to pan · drag alliances sideways to reorder within their row ·
        click anything for details
      </div>
    </div>
  );
}
