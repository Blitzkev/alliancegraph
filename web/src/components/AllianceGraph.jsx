import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { byOrder, formatAlliance, formatPower, formatServer, TYPE_LABELS } from "../format";

const NODE = {
  root: { r: 22, color: "#d97706" },
  family: { r: 15, color: "#2563eb" },
  academy: { r: 11, color: "#16a34a" },
};

// Families hang off the left branch of their root, academies off the right.
const BRANCH = {
  family: { side: -1, label: "family", color: "#2563eb", width: 2.5, dash: null },
  academy: { side: 1, label: "academy", color: "#16a34a", width: 2, dash: "6 4" },
};

// Tree geometry, relative to the root node's center.
const BRANCH_X = 80; // horizontal distance from root to each branch
const ELBOW_Y = 52; // where the branch turns from vertical to horizontal
const FIRST_Y = 100; // first member
const STEP_Y = 54; // spacing between members

// Spacing between the boxes.
const UMBRELLA_PAD = 18;
const UMBRELLA_GAP = 28;
const SERVER_PAD = 24;
const SERVER_GAP = 60;
const SERVER_LABEL_SPACE = 28;
const EMPTY_SERVER = { width: 220, height: 90 };

// Tints for root umbrella boxes; kept away from the node type colors.
const UMBRELLA_TINTS = ["#8b5cf6", "#ec4899", "#64748b", "#a16207", "#0d9488", "#be123c"];

const LABEL_MAX = 28;
const truncate = (s) => (Array.from(s).length > LABEL_MAX ? Array.from(s).slice(0, LABEL_MAX - 1).join("") + "…" : s);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const slotY = (i) => FIRST_Y + i * STEP_Y;

// Move the item at `from` to `to`, returning the new id order.
function moved(items, from, to) {
  const ids = items.map((a) => a.id);
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  return ids;
}

// Drag a member up/down its branch. Siblings slide out of the way; on release the new order
// is reported and the graph redraws with every node snapped to its slot.
function branchDrag(nodes, list, x, onReorder, hideTooltip) {
  return (from) => {
    let to = from;
    return d3
      .drag()
      // Explicit subject: nodes inherit their umbrella's datum (an id), which d3 would otherwise use.
      .subject(() => ({ x, y: slotY(from) }))
      .on("drag", function (event) {
        // Raise on first move, not on press: re-inserting the element on mousedown can swallow the click.
        if (!this.classList.contains("dragging")) d3.select(this).raise().classed("dragging", true);
        hideTooltip();
        const y = clamp(event.y, slotY(0), slotY(list.length - 1));
        d3.select(this).attr("transform", `translate(${x},${y})`);
        const next = Math.round((y - FIRST_Y) / STEP_Y);
        if (next === to) return;
        to = next;
        nodes.forEach((other, j) => {
          if (j === from) return;
          let k = j;
          if (from < to && j > from && j <= to) k = j - 1;
          else if (from > to && j >= to && j < from) k = j + 1;
          other.transition().duration(120).attr("transform", `translate(${x},${slotY(k)})`);
        });
      })
      .on("end", function () {
        d3.select(this).classed("dragging", false);
        if (to !== from) onReorder(moved(list, from, to));
        else d3.select(this).attr("transform", `translate(${x},${slotY(from)})`);
      });
  };
}

// Draw one root umbrella as a tree with its root at (0, 0). Returns the root node.
function drawUmbrella(g, root, members, tint, showTooltip, hideTooltip, onReorder) {
  const box = g.append("rect").attr("class", "umbrella").attr("fill", tint).attr("stroke", tint);

  for (const type of ["family", "academy"]) {
    const branch = BRANCH[type];
    const list = members.filter((m) => m.type === type).sort(byOrder);
    if (!list.length) continue;
    const x = branch.side * BRANCH_X;
    const lastY = slotY(list.length - 1);

    g.append("path")
      .attr("class", "branch")
      .attr("d", `M0,${NODE.root.r} V${ELBOW_Y} H${x} V${lastY}`)
      .attr("stroke", branch.color)
      .attr("stroke-width", branch.width)
      .attr("stroke-dasharray", branch.dash);

    g.append("text")
      .attr("class", "link-label")
      .attr("x", x / 2)
      .attr("y", ELBOW_Y - 4)
      .attr("text-anchor", "middle")
      .attr("fill", branch.color)
      .text(branch.label);

    const nodes = list.map((m, i) => drawNode(g, m, x, slotY(i), branch.side));
    if (nodes.length > 1) {
      const drag = branchDrag(nodes, list, x, onReorder, hideTooltip);
      nodes.forEach((node, i) => node.classed("draggable", true).call(drag(i)));
    }
  }
  const rootNode = drawNode(g, root, 0, 0, 0);

  function drawNode(parent, a, x, y, side) {
    const { r, color } = NODE[a.type];
    const node = parent
      .append("g")
      .attr("class", "node")
      .attr("transform", `translate(${x},${y})`)
      .on("mouseenter", (event) => showTooltip(event, a))
      .on("mousemove", (event) => showTooltip(event, a))
      .on("mouseleave", hideTooltip);
    node.append("circle").attr("r", r).attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 2);
    // Root label above the root; member labels on the outside of their branch.
    const label = node
      .append("text")
      .attr("class", `label label-${a.type}`)
      .text(formatAlliance({ ...a, name: truncate(a.name) }));
    if (side === 0) label.attr("text-anchor", "middle").attr("y", -r - 10);
    else
      label
        .attr("text-anchor", side < 0 ? "end" : "start")
        .attr("x", side * (r + 8))
        .attr("dy", "0.35em");
    return node;
  }

  // Size the tinted box to whatever was drawn.
  const b = g.node().getBBox();
  box
    .attr("x", b.x - UMBRELLA_PAD)
    .attr("y", b.y - UMBRELLA_PAD)
    .attr("width", b.width + 2 * UMBRELLA_PAD)
    .attr("height", b.height + 2 * UMBRELLA_PAD)
    .attr("rx", 14);
  return rootNode;
}

// Drag a root sideways to move its whole umbrella among the others on the server.
function umbrellaDrag(umbrellas, content, onReorder, hideTooltip) {
  return (from) => {
    const u = umbrellas[from];
    let dx = 0;
    let started = false;
    return d3
      .drag()
      .container(() => content.node()) // the umbrella itself moves, so measure in server space
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
        const order = umbrellas
          .map((v, i) => ({ v, i, c: center(v, i) }))
          .sort((a, b) => a.c - b.c)
          .map((e) => e.i);
        const to = order.indexOf(from);
        if (started && to !== from) onReorder(moved(umbrellas.map((v) => v.root), from, to));
        else u.g.attr("transform", `translate(${u.x},${u.y})`);
        started = false;
        dx = 0;
      });
  };
}

export default function AllianceGraph({ servers, alliances, selectedUmbrella, onSelectUmbrella, onReorder }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const zoomTransform = useRef(null); // null until the user zooms/pans; until then we auto-fit
  const fitRef = useRef(null);
  const highlightRef = useRef(null);
  const selectedRef = useRef(selectedUmbrella);
  const onSelectRef = useRef(onSelectUmbrella);
  const onReorderRef = useRef(onReorder);
  selectedRef.current = selectedUmbrella;
  onSelectRef.current = onSelectUmbrella;
  onReorderRef.current = onReorder;
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
    const svg = d3.select(svgRef.current).attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    const viewport = svg.append("g");

    const showTooltip = (event, a) => {
      const [x, y] = d3.pointer(event, wrapRef.current);
      const root = byId.get(a.rootId);
      setTooltip({
        x,
        y,
        title: formatAlliance(a),
        type: TYPE_LABELS[a.type],
        power: formatPower(a.power),
        root: root ? formatAlliance(root) : null,
        members: a.type === "root" ? alliances.filter((m) => m.rootId === a.id).length : null,
      });
    };
    const hideTooltip = () => setTooltip(null);
    const reorder = (ids) => onReorderRef.current(ids);

    // Lay out servers left to right, wrapping to a new row when the view is full.
    let cursorX = 0;
    let cursorY = SERVER_LABEL_SPACE;
    let rowHeight = 0;
    let tintIndex = 0;
    const umbrellaBoxes = [];

    for (const server of servers) {
      const sg = viewport.append("g").attr("class", "server");
      const serverBox = sg.append("rect").attr("class", "server-region").attr("rx", 18);
      const content = sg.append("g");

      // Root umbrellas side by side inside the server, tops aligned.
      const roots = alliances.filter((a) => a.type === "root" && a.server === server).sort(byOrder);
      const umbrellas = [];
      let x = 0;
      for (const root of roots) {
        const ug = content
          .append("g")
          .attr("class", "umbrella-group")
          .datum(root.id)
          .on("click", (event) => {
            event.stopPropagation();
            onSelectRef.current(root.id);
          });
        const members = alliances.filter((a) => a.rootId === root.id);
        const tint = UMBRELLA_TINTS[tintIndex++ % UMBRELLA_TINTS.length];
        const rootNode = drawUmbrella(ug, root, members, tint, showTooltip, hideTooltip, reorder);
        const b = ug.node().getBBox();
        const u = { root, g: ug, rootNode, x: x - b.x, y: -b.y, width: b.width };
        ug.attr("transform", `translate(${u.x},${u.y})`);
        umbrellas.push(u);
        umbrellaBoxes.push(ug);
        x += b.width + UMBRELLA_GAP;
      }
      if (umbrellas.length > 1) {
        const drag = umbrellaDrag(umbrellas, content, reorder, hideTooltip);
        umbrellas.forEach((u, i) => u.rootNode.classed("draggable", true).call(drag(i)));
      }

      let w, h;
      if (roots.length) {
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

    // Selected umbrella gets a bold outline; nothing else changes.
    const highlight = (id) =>
      d3.selectAll(umbrellaBoxes.map((g) => g.node())).classed("selected", (d) => d === id);
    highlightRef.current = highlight;
    highlight(selectedRef.current);
    svg.on("click", () => onSelectRef.current(null));

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
  }, [servers, alliances, size]);

  useEffect(() => {
    highlightRef.current?.(selectedUmbrella);
  }, [selectedUmbrella]);

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
          <div>{tooltip.type} alliance</div>
          <div>Power: {tooltip.power}</div>
          {tooltip.root && <div>Under: {tooltip.root}</div>}
          {tooltip.members !== null && <div>Members: {tooltip.members}</div>}
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
      {Object.entries(NODE).map(([type, { color }]) => (
        <div key={type} className="legend-row">
          <svg width="22" height="16">
            <circle cx="11" cy="8" r="6" fill={color} />
          </svg>
          {TYPE_LABELS[type]} alliance
        </div>
      ))}
      {Object.entries(BRANCH).map(([type, b]) => (
        <div key={type} className="legend-row">
          <svg width="22" height="16">
            <line x1="1" y1="8" x2="21" y2="8" stroke={b.color} strokeWidth={b.width} strokeDasharray={b.dash} />
          </svg>
          {TYPE_LABELS[type]} branch ({b.side < 0 ? "left" : "right"})
        </div>
      ))}
      <div className="legend-row">
        <svg width="22" height="16">
          <rect x="1" y="2" width="20" height="12" rx="4" fill="#8b5cf6" fillOpacity="0.15" stroke="#8b5cf6" strokeOpacity="0.5" />
        </svg>
        Root umbrella
      </div>
      <div className="legend-row">
        <svg width="22" height="16">
          <rect className="server-region" x="1" y="2" width="20" height="12" rx="4" />
        </svg>
        Server/Kingdom
      </div>
      <div className="legend-hint">
        Scroll to zoom · drag background to pan · drag nodes to reorder · click a root umbrella for
        details
      </div>
    </div>
  );
}
