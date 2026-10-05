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
  formatTag,
  sortFamilies,
} from "../format";

// The selected kingdom (server) is drawn top to bottom: each family (oldest first) as a light blue
// bubble around its alliances, with a light green bubble of its academies just below and connected to
// it; independent alliances in a row at the bottom. Every alliance appears exactly once; allied links
// are dashed curves from a family's bubble to the alliance.
const COLORS = {
  family: "#2563eb",
  academy: "#16a34a",
  root: "#d97706",
  link: "#7c3aed", // academy protected by family
  allianceBorder: "#94a3b8",
};

const ALLIANCE_H = 40;
const NODE_PAD_X = 12;
const CELL_GAP = 14; // space between alliances inside a bubble (and in the independent row)
const BUBBLE_PAD = 14; // extra room between the alliances and the bubble's edge
const ACADEMY_GAP = 36; // between a family's bubble and its academies' bubble
const FAMILY_GAP = 56; // between one family (with its academies) and the next

const keyOf = (kind, id) => `${kind}:${id}`;

// Order within a bubble: anything the user arranged by dragging first, then strongest (so a family's
// leader comes first).
const bandOrder = (a, b) => {
  const pa = a.position ?? Infinity;
  const pb = b.position ?? Infinity;
  if (pa !== pb) return pa - pb;
  return byPower(a, b);
};

export default function AllianceGraph({ server, families, alliances, selected, onSelect, onReorder, onMove, onResetLayout }) {
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
  callbacks.current = { onSelect, onReorder, onMove };
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
      const groupLayer = content.append("g");

      const on = (items) => items.filter((x) => x.server === server);
      const serverAlliances = on(alliances);
      const leaderIds = new Set();
      const pos = new Map(); // alliance id -> { x, y, width, g, group } in content coordinates

      const addEdge = (cls, ends, d) => {
        const path = edgeLayer.append("path").attr("class", `edge ${cls}`);
        edges.push({ path, ends, d });
      };

      const describe = (a) => {
        const relationship = a.familyId
          ? `${leaderIds.has(a.id) ? "Leads" : "Member of"} ${formatFamily(a.familyId, alliances)}`
          : a.academyOf
            ? `Academy of ${formatFamily(a.academyOf, alliances)}`
            : "Independent";
        return [
          formatAlliance(a),
          `Power: ${formatPower(a.power)}`,
          relationship,
          ...(a.alliedFamilyIds.length ? [`Allied with: ${familyNames(a.alliedFamilyIds)}`] : []),
        ];
      };

      // A group of alliance boxes laid out in a compact grid around (0, 0) inside `parent`, which is
      // later moved to (cx, cy). Returns the slot layout so boxes can be dragged between slots.
      const drawGroup = (parent, members) => {
        const boxes = members.map((a) => {
          const g = drawBox(parent, {
            kind: "alliance",
            id: a.id,
            height: ALLIANCE_H,
            cls: `alliance${leaderIds.has(a.id) ? " root" : ""}`,
            lines: [
              { text: formatTag(a.tag), cls: "box-title" },
              { text: `Power: ${formatPower(a.power)}`, cls: "box-sub" },
            ],
          });
          g.on("mouseenter mousemove", (event) => showTooltip(event, describe(a))).on("mouseleave", hideTooltip);
          return g;
        });
        const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
        const rows = Math.ceil(members.length / cols);
        const cellW = Math.max(0, ...boxes.map((b) => b.width));
        const width = cols * cellW + (cols - 1) * CELL_GAP;
        const height = rows * ALLIANCE_H + (rows - 1) * CELL_GAP;
        const slots = members.map((_, i) => ({
          x: -width / 2 + (i % cols) * (cellW + CELL_GAP) + cellW / 2,
          y: -height / 2 + Math.floor(i / cols) * (ALLIANCE_H + CELL_GAP) + ALLIANCE_H / 2,
        }));
        boxes.forEach((g, i) => g.attr("transform", `translate(${slots[i].x},${slots[i].y})`));
        return { boxes, slots, width, height };
      };

      // Drag an alliance onto another slot of its group to reorder; saved on release.
      const makeDraggable = (group, members, layout) => {
        if (members.length < 2) return;
        members.forEach((a, from) => {
          const g = layout.boxes[from];
          const local = { ...layout.slots[from] };
          let moved = false;
          g.classed("draggable", true).call(
            d3
              .drag()
              // Explicit subject: d3 would otherwise use the node's datum.
              .subject(() => ({ x: local.x, y: local.y }))
              .on("drag", (event) => {
                if (!moved) {
                  moved = true;
                  g.raise().classed("dragging", true);
                }
                hideTooltip();
                local.x = event.x;
                local.y = event.y;
                g.attr("transform", `translate(${local.x},${local.y})`);
                const p = pos.get(a.id);
                p.x = group.cx + local.x;
                p.y = group.cy + local.y;
                redrawEdges();
              })
              .on("end", () => {
                g.classed("dragging", false);
                if (!moved) return;
                moved = false;
                const to = d3.minIndex(layout.slots, (s) => (s.x - local.x) ** 2 + (s.y - local.y) ** 2);
                if (to !== from) {
                  const ids = members.map((m) => m.id);
                  ids.splice(to, 0, ids.splice(from, 1)[0]);
                  callbacks.current.onReorder(ids);
                } else {
                  Object.assign(local, layout.slots[from]); // same slot: snap back
                  g.attr("transform", `translate(${local.x},${local.y})`);
                  Object.assign(pos.get(a.id), { x: group.cx + local.x, y: group.cy + local.y });
                  redrawEdges();
                }
              }),
          );
        });
      };

      // A tinted ellipse around a group's alliances; clicking it selects the family.
      const drawBubble = (members, kind, familyId) => {
        const g = groupLayer.append("g").attr("class", `bubble bubble-${kind}`);
        const shape = g.append("ellipse");
        const layout = drawGroup(g, members);
        // An ellipse with these radii passes through the corners of the grid's bounding box.
        const rx = (layout.width / 2) * Math.SQRT2 + BUBBLE_PAD;
        const ry = (layout.height / 2) * Math.SQRT2 + BUBBLE_PAD;
        shape.attr("rx", rx).attr("ry", ry);
        g.datum({ kind: "family", id: familyId });
        shape
          .on("click", (event) => {
            event.stopPropagation();
            callbacks.current.onSelect({ kind: "family", id: familyId });
          })
          .on("mouseenter mousemove", (event) =>
            showTooltip(event, [
              kind === "family" ? formatFamily(familyId, alliances) : `Academies of ${formatFamily(familyId, alliances)}`,
              `${members.length} alliance(s)`,
            ]),
          )
          .on("mouseleave", hideTooltip);
        nodes.push({ kind: "family", id: familyId, g });
        return { g, shape, layout, rx, ry, members };
      };

      const place = (group, cx, cy) => {
        Object.assign(group, { cx, cy });
        group.g.attr("transform", `translate(${cx},${cy})`);
        group.members.forEach((a, i) =>
          pos.set(a.id, { x: cx + group.layout.slots[i].x, y: cy + group.layout.slots[i].y, group }),
        );
      };

      // Drag something to a new spot (no physics: it stays where it's dropped); saved on release.
      // `onMove(x, y)` repositions it while dragging.
      const freeDrag = (handle, start, onMove, save) => {
        let moved = false;
        handle.classed("draggable", true).call(
          d3
            .drag()
            .container(() => groupLayer.node())
            // Explicit subject: d3 would otherwise use the node's datum.
            .subject(() => start())
            .on("drag", (event) => {
              moved = true;
              hideTooltip();
              onMove(event.x, event.y);
              redrawEdges();
            })
            .on("end", (event) => {
              if (moved) save(event.x, event.y);
              moved = false;
            }),
        );
      };
      const saveSpot = (kind, id) => (x, y) => callbacks.current.onMove([{ kind, id, x, y }]);

      // Families top to bottom (unless dragged elsewhere), each with its academies' bubble below it.
      const familyBubbles = new Map();
      let y = 0;
      for (const family of sortFamilies(on(families))) {
        const leader = familyLeader(family.id, alliances);
        if (leader) leaderIds.add(leader.id);
        const members = familyMembers(family.id, serverAlliances).sort(bandOrder);
        const fam = drawBubble(members, "family", family.id);
        const famSpot = family.layout ?? { x: 0, y: y + fam.ry };
        place(fam, famSpot.x, famSpot.y);
        familyBubbles.set(family.id, fam);
        makeDraggable(fam, members, fam.layout);
        if (!family.layout) y += 2 * fam.ry;

        const academies = familyAcademies(family.id, serverAlliances).sort(bandOrder);
        let aca = null;
        // Until dragged on its own, the academies' bubble sits under its family and follows it.
        const academyOffset = (a) => ({ x: 0, y: fam.ry + ACADEMY_GAP + a.ry });
        if (academies.length) {
          aca = drawBubble(academies, "academy", family.id);
          const offset = academyOffset(aca);
          const acaSpot = family.academyLayout ?? { x: fam.cx + offset.x, y: fam.cy + offset.y };
          place(aca, acaSpot.x, acaSpot.y);
          makeDraggable(aca, academies, aca.layout);
          const academy = aca;
          addEdge("edge-link", [keyOf("family", family.id)], () => {
            const top = fam.cy + fam.ry;
            const bottom = academy.cy - academy.ry;
            const mid = (top + bottom) / 2;
            return `M${fam.cx},${top} C${fam.cx},${mid} ${academy.cx},${mid} ${academy.cx},${bottom}`;
          });
          freeDrag(
            aca.shape,
            () => ({ x: aca.cx, y: aca.cy }),
            (x, y) => place(academy, x, y),
            saveSpot("academy", family.id),
          );
          if (!family.layout && !family.academyLayout) y += ACADEMY_GAP + 2 * aca.ry;
        }
        const follows = aca && !family.academyLayout;
        freeDrag(
          fam.shape,
          () => ({ x: fam.cx, y: fam.cy }),
          (x, y) => {
            place(fam, x, y);
            if (follows) place(aca, x + academyOffset(aca).x, y + academyOffset(aca).y);
          },
          saveSpot("family", family.id),
        );
        if (!family.layout) y += FAMILY_GAP;
      }

      // Independent alliances: a row at the bottom, centred under the families, unless dragged.
      const independents = serverAlliances.filter((a) => !a.familyId && !a.academyOf).sort(bandOrder);
      if (independents.length) {
        const boxes = independents.map((a) => {
          const box = drawBox(groupLayer, {
            kind: "alliance",
            id: a.id,
            height: ALLIANCE_H,
            cls: "alliance independent",
            lines: [
              { text: formatTag(a.tag), cls: "box-title" },
              { text: `Power: ${formatPower(a.power)}`, cls: "box-sub" },
            ],
          });
          box.on("mouseenter mousemove", (event) => showTooltip(event, describe(a))).on("mouseleave", hideTooltip);
          return box;
        });
        const width = boxes.reduce((sum, b) => sum + b.width, 0) + (boxes.length - 1) * CELL_GAP;
        let x = -width / 2;
        independents.forEach((a, i) => {
          const box = boxes[i];
          const spot = a.layout ?? { x: x + box.width / 2, y: y + ALLIANCE_H / 2 };
          x += box.width + CELL_GAP;
          const p = { x: spot.x, y: spot.y, width: box.width, g: box };
          box.attr("transform", `translate(${p.x},${p.y})`);
          pos.set(a.id, p);
          freeDrag(
            box,
            () => ({ x: p.x, y: p.y }),
            (nx, ny) => {
              Object.assign(p, { x: nx, y: ny });
              box.attr("transform", `translate(${nx},${ny})`);
            },
            saveSpot("alliance", a.id),
          );
        });
      }

      // Allied: a dashed curve from the side of the family's bubble to the near edge of the alliance.
      for (const a of serverAlliances) {
        for (const familyId of a.alliedFamilyIds) {
          const fam = familyBubbles.get(familyId);
          if (!fam) continue;
          addEdge("edge-allied", [keyOf("family", familyId), keyOf("alliance", a.id)], () => {
            const p = pos.get(a.id);
            const sx = fam.cx + fam.rx;
            const sy = fam.cy;
            const ty = p.y < sy ? p.y + ALLIANCE_H / 2 : p.y - ALLIANCE_H / 2;
            return `M${sx},${sy} C${sx + 90},${sy} ${p.x + 60},${(sy + ty) / 2} ${p.x},${ty}`;
          });
        }
      }

      const redrawEdges = () => edges.forEach((e) => e.path.attr("d", e.d()));
      redrawEdges();
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
  const hasDragged =
    families.some((f) => f.server === server && (f.layout || f.academyLayout)) ||
    alliances.some((a) => a.server === server && a.layout);

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
        <div className="graph-buttons">
          <button className="btn btn-secondary" onClick={() => fitRef.current?.()}>
            Fit
          </button>
          {hasDragged && (
            <button className="btn btn-secondary" onClick={onResetLayout} title="Put everything back in its automatic place">
              Reset layout
            </button>
          )}
        </div>
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

const bubble = (cls) => (
  <svg width="26" height="16">
    <ellipse className={cls} cx="13" cy="8" rx="12" ry="7" />
  </svg>
);

function LegendBody() {
  return (
    <div className="legend-body">
      <div className="legend-row">{bubble("legend-family")} Family</div>
      <div className="legend-row">{bubble("legend-academy")} A family's academies</div>
      <div className="legend-row">{swatch("#fff", COLORS.allianceBorder, 3)} Alliance</div>
      <div className="legend-row">{swatch("#fff7ed", COLORS.root, 3)} Family leader (strongest)</div>
      <div className="legend-row">{line("edge-link")} Academies of the family above</div>
      <div className="legend-row">{line("edge-allied")} Allied with a family</div>
      <div className="legend-hint">
        Scroll to zoom · drag background to pan · drag bubbles and independent alliances to move them ·
        drag an alliance inside a bubble to reorder · click a bubble or alliance for details
      </div>
    </div>
  );
}
