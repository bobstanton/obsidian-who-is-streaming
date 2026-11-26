import { BasesAllOptions, BasesView, Keymap, QueryController } from "obsidian";
import { Simulation, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { getFrontmatterString, getFrontmatterStringArray } from "./frontmatterUtils";
import { resolvePosterUrl } from "./posterUtils";
import { POSTER_PROPERTY, TMDB_ID_PROPERTY } from "./properties";
import { getFrontmatter } from "./vaultTitles";
import { GraphLink, GraphNode, GraphTitle, POSTER_HEIGHT, POSTER_WIDTH, buildCastGraph, focusOpacity, graphDistances } from "./castGraphModel";

export const CastGraphViewType = "cast-graph";

const LABEL_FONT_SIZE = 11;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const CLICK_TOLERANCE_PX = 4;
const TOUCH_TOLERANCE_PX = 10;
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DISTANCE_PX = 30;
const NARROW_VIEW_PX = 600;
const NARROW_VIEW_MIN_FIT = 0.6;
const DIM_ALPHA = 0.05;
const SELECTED_POSTER_SCALE = 1.3;

interface Palette {
  text: string;
  muted: string;
  link: string;
  background: string;
  surface: string;
  cast: string;
  director: string;
}

type DragState =
  | { mode: "pan"; startX: number; startY: number; originX: number; originY: number; moved: boolean }
  | { mode: "node"; node: GraphNode; startX: number; startY: number; moved: boolean };

export class CastGraphBasesView extends BasesView {
  type = CastGraphViewType;
  containerEl: HTMLElement;

  private canvas: HTMLCanvasElement;
  private messageEl: HTMLElement;
  private probes: Record<keyof Palette, HTMLElement>;
  private palette: Palette;

  private nodes: GraphNode[] = [];
  private links: GraphLink[] = [];
  private neighbors = new Map<GraphNode, Set<GraphNode>>();
  private graphSignature = "";
  private simulation: Simulation<GraphNode, GraphLink> | null = null;

  private images = new Map<string, HTMLImageElement>();
  private transform = { x: 0, y: 0, k: 1 };
  private autoFit = true;
  private width = 0;
  private height = 0;

  private hovered: GraphNode | null = null;
  private selected: GraphNode | null = null;
  private focusDistances: { from: GraphNode; distances: Map<GraphNode, number> } | null = null;
  private drag: DragState | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { startDistance: number; startK: number; anchorX: number; anchorY: number } | null = null;
  private lastClick: { time: number; x: number; y: number; node: GraphNode | null } | null = null;
  private frameRequest: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(controller: QueryController, scrollEl: HTMLElement) {
    super(controller);
    this.containerEl = scrollEl.createDiv({ cls: "who-is-streaming-cast-graph" });
    this.canvas = this.containerEl.createEl("canvas");
    this.messageEl = this.containerEl.createDiv({ cls: "who-is-streaming-empty" });
    this.messageEl.hide();

    const probe = (name: string) =>
      this.containerEl.createSpan({ cls: `cast-graph-probe probe-${name}` });

    this.probes = {
      text: probe("text"),
      muted: probe("muted"),
      link: probe("link"),
      background: probe("background"),
      surface: probe("surface"),
      cast: probe("cast"),
      director: probe("director"),
    };
    this.palette = this.readPalette();
  }

  onload(): void {
    this.registerDomEvent(this.canvas, "pointerdown", (evt) => this.onPointerDown(evt));
    this.registerDomEvent(this.canvas, "pointermove", (evt) => this.onPointerMove(evt));
    this.registerDomEvent(this.canvas, "pointerup", (evt) => this.onPointerUp(evt));
    this.registerDomEvent(this.canvas, "pointercancel", (evt) => this.onPointerCancel(evt));
    this.registerDomEvent(this.canvas, "pointerleave", () => this.setHovered(null));
    this.registerDomEvent(this.canvas, "wheel", (evt) => this.onWheel(evt), { passive: false });

    this.registerEvent(this.app.workspace.on("css-change", () => {
      this.palette = this.readPalette();
      this.requestDraw();
    }));

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.containerEl);
  }

  onunload(): void {
    this.simulation?.stop();
    this.simulation = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.frameRequest !== null) {
      this.containerEl.win.cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
    }

    this.images.clear();
  }

  public onDataUpdated(): void {
    this.palette = this.readPalette();
    this.rebuildGraph();
  }

  static getViewOptions(this: void): BasesAllOptions[] {
    return [
      {
        displayName: "Minimum titles per person",
        type: "slider",
        key: "minTitles",
        min: 1,
        max: 6,
        step: 1,
        default: 2,
      },
      {
        displayName: "Include directors",
        type: "toggle",
        key: "includeDirectors",
        default: true,
      },
      {
        displayName: "Show titles with no shared people",
        type: "toggle",
        key: "showUnconnected",
        default: false,
      },
    ];
  }

  private rebuildGraph(): void {
    const configMinTitles = this.config.get("minTitles");
    const minTitles = typeof configMinTitles === "number" ? Math.max(1, Math.round(configMinTitles)) : 2;
    const includeDirectors = this.config.get("includeDirectors") !== false;
    const showUnconnected = this.config.get("showUnconnected") === true;

    const titles: GraphTitle[] = (this.data?.data ?? []).flatMap((entry) => {
      const fm = getFrontmatter(this.app, entry.file);

      if (fm[TMDB_ID_PROPERTY] == null) return [];
      const posterValue = getFrontmatterString(fm, POSTER_PROPERTY);

      return [{
        id: entry.file.path,
        label: entry.file.basename,
        file: entry.file,
        posterUrl: posterValue ? resolvePosterUrl(this.app, posterValue) : null,
        cast: getFrontmatterStringArray(fm, "Cast") ?? [],
        directors: getFrontmatterStringArray(fm, "Directors") ?? [],
      }];
    });

    if (titles.length === 0) {
      this.setGraph([], [], "empty");
      this.showMessage("No titles with a TMDB ID found.");

      return;
    }

    const graph = buildCastGraph(titles, { minTitles, includeDirectors, showUnconnected });

    if (graph.nodes.length === 0) {
      this.setGraph([], [], "none");
      this.showMessage(
        `No one appears in ${minTitles} or more of these titles. ` +
        "Lower \"Minimum titles per person\" in the view options."
      );

      return;
    }

    this.hideMessage();
    this.setGraph(graph.nodes, graph.links, graph.signature);
  }

  private setGraph(nodes: GraphNode[], links: GraphLink[], signature: string): void {
    if (signature === this.graphSignature) {
      this.requestDraw();

      return;
    }

    this.graphSignature = signature;

    const previous = new Map(this.nodes.map((node) => [node.id, node]));
    let carriedOver = 0;

    for (const node of nodes) {
      const old = previous.get(node.id);

      if (old && old.x !== undefined && old.y !== undefined) {
        node.x = old.x;
        node.y = old.y;
        carriedOver++;
      }
    }

    const selectedId = this.selected?.id;

    this.nodes = nodes;
    this.links = links;
    this.hovered = null;
    this.selected = nodes.find((node) => node.id === selectedId) ?? null;
    this.drag = null;

    this.focusDistances = null;
    this.neighbors = new Map(nodes.map((node) => [node, new Set<GraphNode>()]));

    for (const link of links) {
      this.neighbors.get(link.source)?.add(link.target);
      this.neighbors.get(link.target)?.add(link.source);
    }

    for (const node of nodes) {
      if (node.posterUrl) this.loadImage(node.posterUrl);
    }

    this.simulation?.stop();
    this.simulation = null;

    if (nodes.length === 0) {
      this.requestDraw();

      return;
    }

    this.simulation = forceSimulation<GraphNode, GraphLink>(nodes)
      .force("link", forceLink<GraphNode, GraphLink>(links).distance(80).strength(0.6))
      .force("charge", forceManyBody<GraphNode>().strength(-260).distanceMax(600))
      .force("collide", forceCollide<GraphNode>((node) => node.radius + 6))
      .force("x", forceX<GraphNode>(0).strength(0.06))
      .force("y", forceY<GraphNode>(0).strength(0.06))
      .alpha(carriedOver > 0 ? 0.4 : 1)
      .on("tick", () => {
        if (this.autoFit) this.fitView();
        this.requestDraw();
      });
  }

  private loadImage(url: string): void {
    if (this.images.has(url)) return;
    const img = createEl("img");

    img.onload = () => this.requestDraw();
    img.src = url;
    this.images.set(url, img);
  }

  private showMessage(text: string): void {
    this.messageEl.setText(text);
    this.messageEl.show();
    this.canvas.hide();
  }

  private hideMessage(): void {
    this.messageEl.hide();
    this.canvas.show();
    this.onResize();
  }

  private readPalette(): Palette {
    const read = (el: HTMLElement) => el.win.getComputedStyle(el).color;

    return {
      text: read(this.probes.text),
      muted: read(this.probes.muted),
      link: read(this.probes.link),
      background: read(this.probes.background),
      surface: read(this.probes.surface),
      cast: read(this.probes.cast),
      director: read(this.probes.director),
    };
  }

  private onResize(): void {
    const width = this.containerEl.clientWidth;
    const height = this.containerEl.clientHeight;

    if (width === 0 || height === 0) return;

    const dpr = this.containerEl.win.devicePixelRatio || 1;

    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);

    if (this.autoFit) this.fitView();
    this.requestDraw();
  }

  private fitView(): void {
    if (this.nodes.length === 0 || this.width === 0 || this.height === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const node of this.nodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      minX = Math.min(minX, x - node.radius);
      maxX = Math.max(maxX, x + node.radius);
      minY = Math.min(minY, y - node.radius);
      maxY = Math.max(maxY, y + node.radius);
    }

    const padding = 40;
    const graphWidth = Math.max(maxX - minX, 1);
    const graphHeight = Math.max(maxY - minY, 1);
    const k = Math.min(
      (this.width - padding * 2) / graphWidth,
      (this.height - padding * 2) / graphHeight,
      1.5
    );
    const minFit = this.width < NARROW_VIEW_PX ? NARROW_VIEW_MIN_FIT : MIN_ZOOM;
    const scale = Math.max(k, minFit);

    this.transform = {
      k: scale,
      x: this.width / 2 - scale * (minX + maxX) / 2,
      y: this.height / 2 - scale * (minY + maxY) / 2,
    };
  }

  private toGraphPoint(evt: MouseEvent): { x: number; y: number; screenX: number; screenY: number } {
    const rect = this.canvas.getBoundingClientRect();
    const screenX = evt.clientX - rect.left;
    const screenY = evt.clientY - rect.top;

    return {
      screenX,
      screenY,
      x: (screenX - this.transform.x) / this.transform.k,
      y: (screenY - this.transform.y) / this.transform.k,
    };
  }

  private nodeAt(x: number, y: number): GraphNode | null {
    const minHitRadius = 8 / this.transform.k;
    let hit: GraphNode | null = null;

    for (const node of this.nodes) {
      const dx = x - (node.x ?? 0);
      const dy = y - (node.y ?? 0);

      if (node.kind === "movie") {
        if (Math.abs(dx) <= POSTER_WIDTH / 2 && Math.abs(dy) <= POSTER_HEIGHT / 2) return node;
      } else if (Math.hypot(dx, dy) <= Math.max(node.radius, minHitRadius)) {
        hit = node;
      }
    }

    return hit;
  }

  private onPointerDown(evt: PointerEvent): void {
    if (evt.button !== 0) return;
    const point = this.toGraphPoint(evt);

    this.canvas.setPointerCapture(evt.pointerId);
    this.pointers.set(evt.pointerId, { x: point.screenX, y: point.screenY });

    if (this.pointers.size === 2) {
      this.startPinch();

      return;
    }

    if (this.pointers.size > 2) return;

    const node = this.nodeAt(point.x, point.y);

    if (node) {
      this.drag = { mode: "node", node, startX: point.screenX, startY: point.screenY, moved: false };
    } else {
      this.drag = {
        mode: "pan",
        startX: point.screenX,
        startY: point.screenY,
        originX: this.transform.x,
        originY: this.transform.y,
        moved: false,
      };
    }
  }

  private onPointerMove(evt: PointerEvent): void {
    const point = this.toGraphPoint(evt);

    if (this.pointers.has(evt.pointerId)) {
      this.pointers.set(evt.pointerId, { x: point.screenX, y: point.screenY });
    }

    if (this.pinch) {
      this.updatePinch();

      return;
    }

    const drag = this.drag;

    if (!drag) {
      if (evt.pointerType !== "touch") this.setHovered(this.nodeAt(point.x, point.y));

      return;
    }

    const dx = point.screenX - drag.startX;
    const dy = point.screenY - drag.startY;

    if (!drag.moved) {
      const tolerance = evt.pointerType === "touch" ? TOUCH_TOLERANCE_PX : CLICK_TOLERANCE_PX;

      if (Math.hypot(dx, dy) < tolerance) return;
      drag.moved = true;
      this.autoFit = false;

      if (drag.mode === "node") {
        this.simulation?.alphaTarget(0.3).restart();
      } else {
        this.canvas.addClass("is-panning");
      }
    }

    if (drag.mode === "node") {
      drag.node.fx = point.x;
      drag.node.fy = point.y;
    } else {
      this.transform.x = drag.originX + dx;
      this.transform.y = drag.originY + dy;
    }

    this.requestDraw();
  }

  private onPointerUp(evt: PointerEvent): void {
    this.releasePointer(evt);
    const drag = this.drag;

    this.endDrag();
    if (!drag || drag.moved) return;

    const point = this.toGraphPoint(evt);
    const node = drag.mode === "node" ? drag.node : null;
    const last = this.lastClick;
    const isDoubleClick = last !== null
      && last.node === node
      && evt.timeStamp - last.time < DOUBLE_CLICK_MS
      && Math.hypot(point.screenX - last.x, point.screenY - last.y) < DOUBLE_CLICK_DISTANCE_PX;

    if (isDoubleClick) {
      this.lastClick = null;
      this.onDoubleClick(evt);

      return;
    }

    this.lastClick = { time: evt.timeStamp, x: point.screenX, y: point.screenY, node };
    this.selected = node;
    this.requestDraw();
  }

  private onPointerCancel(evt: PointerEvent): void {
    this.releasePointer(evt);
    this.endDrag();
  }

  private releasePointer(evt: PointerEvent): void {
    this.pointers.delete(evt.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
  }

  private startPinch(): void {
    this.endDrag();
    this.lastClick = null;

    const [a, b] = [...this.pointers.values()];
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    this.pinch = {
      startDistance: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
      startK: this.transform.k,
      anchorX: (midX - this.transform.x) / this.transform.k,
      anchorY: (midY - this.transform.y) / this.transform.k,
    };
    this.autoFit = false;
  }

  private updatePinch(): void {
    const pinch = this.pinch;

    if (!pinch || this.pointers.size < 2) return;

    const [a, b] = [...this.pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.startK * distance / pinch.startDistance));

    this.transform = {
      k,
      x: (a.x + b.x) / 2 - pinch.anchorX * k,
      y: (a.y + b.y) / 2 - pinch.anchorY * k,
    };
    this.requestDraw();
  }

  private onDoubleClick(evt: MouseEvent): void {
    const point = this.toGraphPoint(evt);
    const node = this.nodeAt(point.x, point.y);

    if (!node) {
      this.autoFit = true;
      this.fitView();
      this.requestDraw();
    } else if (node.kind === "movie" && node.file) {
      void this.app.workspace.openLinkText(node.file.path, "", Keymap.isModEvent(evt));
    }
  }

  private endDrag(): void {
    const drag = this.drag;

    if (!drag) return;
    this.drag = null;
    this.canvas.removeClass("is-panning");

    if (drag.mode === "node") {
      drag.node.fx = null;
      drag.node.fy = null;
      this.simulation?.alphaTarget(0);
    }
  }

  private onWheel(evt: WheelEvent): void {
    if (this.nodes.length === 0) return;
    evt.preventDefault();

    const point = this.toGraphPoint(evt);
    const factor = Math.exp(-evt.deltaY * (evt.deltaMode === 1 ? 0.05 : 0.0015));
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.transform.k * factor));

    this.transform = {
      k,
      x: point.screenX - point.x * k,
      y: point.screenY - point.y * k,
    };
    this.autoFit = false;
    this.requestDraw();
  }

  private setHovered(node: GraphNode | null): void {
    if (this.hovered === node) return;
    this.hovered = node;
    this.canvas.toggleClass("is-over-node", node !== null);
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.frameRequest !== null) return;
    this.frameRequest = this.containerEl.win.requestAnimationFrame(() => {
      this.frameRequest = null;
      this.draw();
    });
  }

  private draw(): void {
    const ctx = this.canvas.getContext("2d");

    if (!ctx || this.width === 0 || this.height === 0) return;

    const dpr = this.canvas.width / this.width;
    const { x, y, k } = this.transform;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(x, y);
    ctx.scale(k, k);

    const focus = this.selected ?? this.hovered;
    const distances = focus ? this.getFocusDistances(focus) : undefined;
    const dimAlpha = DIM_ALPHA;
    const alphaOf = (node: GraphNode): number => distances ? focusOpacity(distances.get(node), dimAlpha) : 1;
    const isLit = (node: GraphNode) => alphaOf(node) >= 0.5;
    const isBackground = (node: GraphNode) => distances !== undefined && alphaOf(node) <= dimAlpha;
    const baseWidth = 1 / Math.max(k, 0.5);

    const links = this.links.map((link) => {
      const reach = distances ? Math.min(alphaOf(link.source), alphaOf(link.target)) : undefined;
      const lit = reach === undefined || reach > dimAlpha;

      return { link, reach, lit };
    });

    links.sort((a, b) => (a.reach ?? Number(a.lit)) - (b.reach ?? Number(b.lit)));

    for (const { link, reach, lit } of links) {
      ctx.globalAlpha = lit ? (focus ? 0.9 * (reach ?? 1) : 0.55) : dimAlpha;
      ctx.lineWidth = baseWidth * (reach === undefined ? 1 : reach >= 1 ? 2.5 : reach >= 0.5 ? 1.5 : 1);
      ctx.strokeStyle = focus && lit
        ? (link.role === "director" ? this.palette.director : this.palette.cast)
        : this.palette.link;
      ctx.beginPath();
      ctx.moveTo(link.source.x ?? 0, link.source.y ?? 0);
      ctx.lineTo(link.target.x ?? 0, link.target.y ?? 0);
      ctx.stroke();
    }

    ctx.lineWidth = baseWidth;

    const byAlpha = [...this.nodes].sort((a, b) => alphaOf(a) - alphaOf(b));

    for (const node of byAlpha) {
      if (node.kind !== "person") continue;
      ctx.globalAlpha = alphaOf(node);
      ctx.fillStyle = isBackground(node) ? this.palette.muted : node.isCast ? this.palette.cast : this.palette.director;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, node.radius, 0, Math.PI * 2);
      ctx.fill();

      if (node.isCast && node.isDirector && !isBackground(node)) {
        ctx.strokeStyle = this.palette.director;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = baseWidth;
      }
    }

    for (const node of byAlpha) {
      if (node.kind !== "movie") continue;
      ctx.globalAlpha = alphaOf(node);
      this.drawPoster(ctx, node, node === focus, isBackground(node), node === this.selected);
    }

    ctx.font = `${LABEL_FONT_SIZE}px ${this.containerEl.win.getComputedStyle(this.containerEl).fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    const showAllPeople = !focus && k >= 0.75;

    for (const node of this.nodes) {
      const hasPoster = node.kind === "movie" && this.posterImage(node) !== null;
      const show = node === this.hovered || (focus
        ? isLit(node)
        : node.kind === "person" ? showAllPeople : !hasPoster && k >= 0.5);

      if (!show) continue;

      const posterScale = node === this.selected ? SELECTED_POSTER_SCALE : 1;
      const offset = node.kind === "movie" ? POSTER_HEIGHT * posterScale / 2 + 4 : node.radius + 3;

      ctx.globalAlpha = node === this.hovered ? 1 : alphaOf(node);
      ctx.lineWidth = 3;
      ctx.strokeStyle = this.palette.background;
      ctx.strokeText(node.label, node.x ?? 0, (node.y ?? 0) + offset);
      ctx.fillStyle = node === focus || node === this.hovered ? this.palette.text : this.palette.muted;
      ctx.fillText(node.label, node.x ?? 0, (node.y ?? 0) + offset);
    }

    ctx.globalAlpha = 1;
  }

  private getFocusDistances(focus: GraphNode): Map<GraphNode, number> {
    if (this.focusDistances?.from !== focus) {
      this.focusDistances = { from: focus, distances: graphDistances(focus, this.neighbors) };
    }

    return this.focusDistances.distances;
  }

  private posterImage(node: GraphNode): HTMLImageElement | null {
    if (!node.posterUrl) return null;
    const img = this.images.get(node.posterUrl);

    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }

  private drawPoster(ctx: CanvasRenderingContext2D, node: GraphNode, isFocus: boolean, isBackground: boolean, isSelected: boolean): void {
    const scale = isSelected ? SELECTED_POSTER_SCALE : 1;
    const width = POSTER_WIDTH * scale;
    const height = POSTER_HEIGHT * scale;
    const left = (node.x ?? 0) - width / 2;
    const top = (node.y ?? 0) - height / 2;
    const img = isBackground ? null : this.posterImage(node);

    ctx.save();

    if (isSelected) {
      ctx.shadowColor = this.palette.cast;
      ctx.shadowBlur = 18;
    }

    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 3);
    ctx.fillStyle = isBackground ? this.palette.muted : this.palette.surface;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (img) {
      ctx.clip();
      const fit = Math.max(width / img.naturalWidth, height / img.naturalHeight);
      const drawWidth = img.naturalWidth * fit;
      const drawHeight = img.naturalHeight * fit;

      ctx.drawImage(
        img,
        (node.x ?? 0) - drawWidth / 2,
        (node.y ?? 0) - drawHeight / 2,
        drawWidth,
        drawHeight
      );
    }

    ctx.restore();

    if (isBackground) return;

    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 3);
    ctx.strokeStyle = isFocus ? this.palette.cast : this.palette.link;
    ctx.lineWidth = isSelected ? 3 : isFocus ? 2 : 1;
    ctx.stroke();
  }
}
