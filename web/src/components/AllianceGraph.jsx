import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import {
  familyMembers,
  formatAlliance,
  formatFamily,
  formatPower,
  formatServer,
  sortFamilies,
  TYPE_LABELS,
} from "../format";

// Node styles; the root is a family alliance drawn in its own color.
const NODE = {
  root: { r: 22, color: "#d97706", label: "Root (family alliance)" },
  family: { r: 15, color: "#2563eb", label: "Family alliance" },
  academy: { r: 11, color: "#16a34a", label: "Academy alliance" },
};
const styleOf = (a) => NODE[a.isRoot ? "root" : a.type];

const LINE = {
  family: { label: "family", color: "#2563eb", width: 2.5, dash: null },
  academy: { label: "academies", color: "#16a34a", width: 2, dash: "6 4" },
};

// Family geometry, relative to the root node's center. Family alliances form the top row with
// labels above; a bus joins them, a trunk drops to the academy bus, and academies hang below.
const FAMILY_BUS_Y = 48;
const ACADEMY_BUS_Y = 100;
const ACADEMY_Y = 140;
const MIN_SLOT = 100; // minimum spacing between nodes in a row
const SLOT_PAD = 22; // extra space beside the widest label

// Spacing between the boxes.
const FAMILY_PAD = 18;
const FAMILY_GAP = 28;
const SERVER_PAD = 24;
const SERVER_GAP = 60;
const SERVER_LABEL_SPACE = 28;
const EMPTY_SERVER = { width: 220, height: 90 };

// Tints for family boxes; kept away from the node colors.
const FAMILY_TINTS = ["#8b5cf6", "#ec4899", "#64748b", "#a16207", "#0d9488", "#be123c"];

const LABEL_MAX = 28;
const truncate = (s) => (Array.from(s).length > LABEL_MAX ? Array.from(s).slice(0, LABEL_MAX - 1).join("") + "…" : s);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Move the item at `from` to `to`, returning the new id order.
function moved(items, from, to) {
  const ids = items.map((a) => a.id);
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  return ids;
}

// Drag a node sideways along its row. Siblings slide out of the way; on release the new order
// is reported and the graph redraws with every node snapped to its slot.
function rowDrag(nodes, list, slotX, y, onReorder, hideTooltip) {
  return (from) => {
    let to = from;
    return d3
      .drag()
      // Explicit subject: nodes inherit their family's datum (an id), which d3 would otherwise use.
      .subject(() => ({ x: slotX(from), y }))
      .on("drag", function (event) {
        // Raise on first move, not on press: re-inserting the element on mousedown can swallow the click.
        if (!this.classList.contains("dragging")) d3.select(this).raise().classed("dragging", true);
        hideTooltip();
        const x = clamp(event.x, slotX(0), slotX(list.length - 1));
        d3.select(this).attr("transform", `translate(${x},${y})`);
        const step = list.length > 1 ? slotX(1) - slotX(0) : 1;
        const next = clamp(Math.round((x - slotX(0)) / step), 0, list.length - 1);
        if (next === to) return;
        to = next;
        nodes.forEach((other, j) => {
          if (j === from) return;
          let k = j;
          if (from < to && j > from && j <= to) k = j - 1;
          else if (from > to && j >= to && j < from) k = j + 1;
          other.transition().duration(120).attr("transform", `translate(${slotX(k)},${y})`);
        });
      })
      .on("end", function () {
        d3.select(this).classed("dragging", false);
        if (to !== from) onReorder(moved(list, from, to));
        else d3.select(this).attr("transform", `translate(${slotX(from)},${y})`);
      });
  };
}

// Draw one family with its root at (0, 0). Returns the root node (used to drag the family).
function drawFamily(g, members, tint, showTooltip, hideTooltip, onReorder) {
  const { root, families, academies } = members;
  const box = g.append("rect").attr("class", "umbrella").attr("fill", tint).attr("stroke", tint);
  const lines = g.append("g");
  const familyRow = [root, ...families].filter(Boolean);

  // Nodes first (at the origin) so their labels can be measured for spacing.
  const drawNode = (a, labelAbove, stubTo) => {
    const { r, color } = styleOf(a);
    const node = g
      .append("g")
      .attr("class", "node")
      .on("mouseenter", (event) => showTooltip(event, a))
      .on("mousemove", (event) => showTooltip(event, a))
      .on("mouseleave", hideTooltip);
    // The connector to the row's bus is part of the node, so it follows the node while dragging.
    if (stubTo !== null) {
      const style = LINE[a.type === "academy" ? "academy" : "family"];
      node
        .append("line")
        .attr("class", "stub")
        .attr("y1", labelAbove ? r : -r)
        .attr("y2", stubTo)
        .attr("stroke", style.color)
        .attr("stroke-width", style.width)
        .attr("stroke-dasharray", style.dash);
    }
    node.append("circle").attr("r", r).attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 2);
    node
      .append("text")
      .attr("class", `label label-${a.isRoot ? "root" : a.type}`)
      .attr("text-anchor", "middle")
      .attr("y", labelAbove ? -r - 9 : r + 15)
      .text(formatAlliance({ ...a, name: truncate(a.name) }));
    return node;
  };
  const slotWidth = (nodes) =>
    Math.max(MIN_SLOT, ...nodes.map((n) => n.select("text").node().getComputedTextLength() + SLOT_PAD));

  const hasBus = familyRow.length > 1 || academies.length > 0;
  const familyNodes = familyRow.map((a) => drawNode(a, true, hasBus ? FAMILY_BUS_Y : null));
  const fw = slotWidth(familyNodes);
  const familyX = (i) => i * fw;
  familyNodes.forEach((n, i) => n.attr("transform", `translate(${familyX(i)},0)`));
  const lastFamilyX = familyX(familyRow.length - 1);

  if (hasBus) {
    lines
      .append("path")
      .attr("d", `M${familyX(0)},${FAMILY_BUS_Y} H${lastFamilyX}`)
      .attr("class", "branch")
      .attr("stroke", LINE.family.color)
      .attr("stroke-width", LINE.family.width);
  }
  if (familyRow.length > 1) {
    lines
      .append("text")
      .attr("class", "link-label")
      .attr("x", (familyX(0) + familyX(1)) / 2)
      .attr("y", FAMILY_BUS_Y - 4)
      .attr("text-anchor", "middle")
      .attr("fill", LINE.family.color)
      .text(LINE.family.label);
  }

  // Non-root family alliances can be reordered along the row; the root stays first.
  if (families.length > 1) {
    const drag = rowDrag(familyNodes.slice(1), families, (i) => familyX(i + 1), 0, onReorder, hideTooltip);
    familyNodes.slice(1).forEach((n, i) => n.classed("draggable", true).call(drag(i)));
  }

  if (academies.length) {
    const trunkX = lastFamilyX / 2;
    const academyNodes = academies.map((a) => drawNode(a, false, ACADEMY_BUS_Y - ACADEMY_Y));
    const aw = slotWidth(academyNodes);
    const academyX = (i) => trunkX - ((academies.length - 1) * aw) / 2 + i * aw;
    academyNodes.forEach((n, i) => n.attr("transform", `translate(${academyX(i)},${ACADEMY_Y})`));

    const academyStyle = (sel) =>
      sel
        .attr("class", "branch")
        .attr("stroke", LINE.academy.color)
        .attr("stroke-width", LINE.academy.width)
        .attr("stroke-dasharray", LINE.academy.dash);
    academyStyle(lines.append("path").attr("d", `M${trunkX},${FAMILY_BUS_Y} V${ACADEMY_BUS_Y}`));
    const busFrom = Math.min(academyX(0), trunkX);
    const busTo = Math.max(academyX(academies.length - 1), trunkX);
    academyStyle(lines.append("path").attr("d", `M${busFrom},${ACADEMY_BUS_Y} H${busTo}`));
    lines
      .append("text")
      .attr("class", "link-label")
      .attr("x", trunkX + 6)
      .attr("y", (FAMILY_BUS_Y + ACADEMY_BUS_Y) / 2)
      .attr("dy", "0.35em")
      .attr("fill", LINE.academy.color)
      .text(LINE.academy.label);

    if (academies.length > 1) {
      const drag = rowDrag(academyNodes, academies, academyX, ACADEMY_Y, onReorder, hideTooltip);
      academyNodes.forEach((n, i) => n.classed("draggable", true).call(drag(i)));
    }
  }

  // Size the tinted box to whatever was drawn.
  const b = g.node().getBBox();
  box
    .attr("x", b.x - FAMILY_PAD)
    .attr("y", b.y - FAMILY_PAD)
    .attr("width", b.width + 2 * FAMILY_PAD)
    .attr("height", b.height + 2 * FAMILY_PAD)
    .attr("rx", 14);
  return familyNodes[0];
}

// Drag a root sideways to move its whole family among the others on the server.
function familyDrag(boxes, content, onReorder, hideTooltip) {
  return (from) => {
    const u = boxes[from];
    let dx = 0;
    let started = false;
    return d3
      .drag()
      .container(() => content.node()) // the family itself moves, so measure in server space
      .subject(() => ({ x: 0, y: 0 })) // so event.x is the horizontal offset from the start
      .on("drag", (event) => {
        if (!started) {
          started = true;
          u.g.raise().classed("dragging", true);
        }
        hideTooltip();
        dx = event.x;
        u.g.attr("transform", `translate(${u.x + dx},${u.y})`);
      })
      .on("end", () => {
        u.g.classed("dragging", false);
        const center = (v, i) => v.x + v.width / 2 + (i === from ? dx : 0);
        const order = boxes
          .map((v, i) => ({ i, c: center(v, i) }))
          .sort((a, b) => a.c - b.c)
          .map((e) => e.i);
        const to = order.indexOf(from);
        if (started && to !== from) onReorder(moved(boxes.map((v) => v.family), from, to));
        else u.g.attr("transform", `translate(${u.x},${u.y})`);
        started = false;
        dx = 0;
      });
  };
}

export default function AllianceGraph({
  servers,
  families,
  alliances,
  selectedFamily,
  onSelectFamily,
  onReorder,
  onReorderFamilies,
}) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const zoomTransform = useRef(null); // null until the user zooms/pans; until then we auto-fit
  const fitRef = useRef(null);
  const highlightRef = useRef(null);
  // Refs so the drawing effect always calls the latest callbacks without redrawing for them.
  const selectedRef = useRef(selectedFamily);
  const callbacks = useRef({});
  selectedRef.current = selectedFamily;
  callbacks.current = { onSelectFamily, onReorder, onReorderFamilies };
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

    const showTooltip = (event, a) => {
      const [x, y] = d3.pointer(event, wrapRef.current);
      setTooltip({
        x,
        y,
        title: formatAlliance(a),
        type: a.isRoot ? "Root family alliance" : `${TYPE_LABELS[a.type]} alliance`,
        power: formatPower(a.power),
        family: a.isRoot ? null : formatFamily(a.familyId, alliances),
      });
    };
    const hideTooltip = () => setTooltip(null);
    const reorder = (ids) => callbacks.current.onReorder(ids);
    const reorderFamilies = (ids) => callbacks.current.onReorderFamilies(ids);

    // Lay out servers left to right, wrapping to a new row when the view is full.
    let cursorX = 0;
    let cursorY = SERVER_LABEL_SPACE;
    let rowHeight = 0;
    let tintIndex = 0;
    const familyGroups = [];

    for (const server of servers) {
      const sg = viewport.append("g").attr("class", "server");
      const serverBox = sg.append("rect").attr("class", "server-region").attr("rx", 18);
      const content = sg.append("g");

      // Families side by side inside the server, tops aligned.
      const serverFamilies = sortFamilies(
        families.filter((f) => f.server === server),
        alliances,
      );
      const boxes = [];
      let x = 0;
      for (const family of serverFamilies) {
        const fg = content
          .append("g")
          .attr("class", "umbrella-group")
          .datum(family.id)
          .on("click", (event) => {
            event.stopPropagation();
            callbacks.current.onSelectFamily(family.id);
          });
        const tint = FAMILY_TINTS[tintIndex++ % FAMILY_TINTS.length];
        const rootNode = drawFamily(fg, familyMembers(family.id, alliances), tint, showTooltip, hideTooltip, reorder);
        const b = fg.node().getBBox();
        const u = { family, g: fg, rootNode, x: x - b.x, y: -b.y, width: b.width };
        fg.attr("transform", `translate(${u.x},${u.y})`);
        boxes.push(u);
        familyGroups.push(fg);
        x += b.width + FAMILY_GAP;
      }
      if (boxes.length > 1) {
        const drag = familyDrag(boxes, content, reorderFamilies, hideTooltip);
        boxes.forEach((u, i) => u.rootNode?.classed("draggable", true).call(drag(i)));
      }

      let w, h;
      if (boxes.length) {
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

    // Selected family gets a bold outline; nothing else changes.
    const highlight = (id) =>
      d3.selectAll(familyGroups.map((g) => g.node())).classed("selected", (d) => d === id);
    highlightRef.current = highlight;
    highlight(selectedRef.current);
    svg.on("click", () => callbacks.current.onSelectFamily(null));

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
  }, [servers, families, alliances, size]);

  useEffect(() => {
    highlightRef.current?.(selectedFamily);
  }, [selectedFamily]);

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
          <strong>{tooltip.title}</strong>
          <div>{tooltip.type}</div>
          <div>Power: {tooltip.power}</div>
          {tooltip.family && <div>Family: {tooltip.family}</div>}
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

function LegendBody() {
  return (
    <div className="legend-body">
      {Object.entries(NODE).map(([type, { color, label }]) => (
        <div key={type} className="legend-row">
          <svg width="22" height="16">
            <circle cx="11" cy="8" r="6" fill={color} />
          </svg>
          {label}
        </div>
      ))}
      {[
        ["family", "Family alliances (top row)"],
        ["academy", "Academies (bottom row)"],
      ].map(([type, text]) => (
        <div key={type} className="legend-row">
          <svg width="22" height="16">
            <line
              x1="1"
              y1="8"
              x2="21"
              y2="8"
              stroke={LINE[type].color}
              strokeWidth={LINE[type].width}
              strokeDasharray={LINE[type].dash}
            />
          </svg>
          {text}
        </div>
      ))}
      <div className="legend-row">
        <svg width="22" height="16">
          <rect x="1" y="2" width="20" height="12" rx="4" fill="#8b5cf6" fillOpacity="0.15" stroke="#8b5cf6" strokeOpacity="0.5" />
        </svg>
        Family
      </div>
      <div className="legend-row">
        <svg width="22" height="16">
          <rect className="server-region" x="1" y="2" width="20" height="12" rx="4" />
        </svg>
        Server/Kingdom
      </div>
      <div className="legend-hint">
        Scroll to zoom · drag background to pan · drag nodes to reorder (drag a root to move its
        family) · click a family for details
      </div>
    </div>
  );
}
