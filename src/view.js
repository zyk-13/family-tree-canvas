/**
 * 家谱图 · 视图与交互
 *
 * 交互约定：
 *   拖动卡片        → 横向自由拖（吸附对齐）；上下拖动＝换排，只能落在整行基线上
 *   拖动时按住 Alt  → 临时关掉横向吸附（换排限制仍然生效）
 *   卡片下边圆点    → 拖到另一人，建立亲子关系（往下拖＝我是长辈，往上拖＝对方是长辈）
 *   卡片右边圆点    → 拖到另一人，建立配偶关系
 *   双击卡片        → 打开关联笔记（没关联笔记就什么都不做）
 *   右键卡片        → 菜单（编辑、关联/更换/移除笔记、加亲属、与配偶互换左右、删除）
 *   右键连线        → 删除这条关系
 *   空白拖动        → 平移；滚轮＝缩放
 */
import { ItemView, Menu, Notice, setIcon } from "obsidian";
import {
  H_GAP,
  PAD,
  ROW_H,
  compactLayout,
  computeLayout,
  ensurePositions,
  freeX,
  placeNewNode,
  restorePositions,
  roundedPath,
  rowY,
  snapshotPositions,
  textWidth,
} from "./layout.js";
import { EDGE_PARENT, EDGE_SPOUSE, isDeceased } from "./model.js";
import {
  ConfirmModal,
  KinshipModal,
  LayoutsModal,
  NodeModal,
  PeoplePickerModal,
  PromptModal,
  RemovePeopleModal,
  iconButton,
  openNote,
  pickNote,
  textButton,
} from "./modals.js";
import { isEn, t } from "./i18n.js";
import { applyThemeTo } from "./theme.js";

export const VIEW_TYPE = "family-tree-view";

const NS = "http://www.w3.org/2000/svg";
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.6;
/** 横向吸附范围（屏幕像素） */
const SNAP_PX = 12;
/** 背景点阵间距（屏幕像素） */
const GRID_SIZE = 22;

let clipSeq = 0;

function el(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function fitText(text, maxWidth, size) {
  const source = String(text ?? "");
  if (textWidth(source, size) <= maxWidth) return source;
  let out = "";
  for (const ch of source) {
    if (textWidth(out + ch + "…", size) > maxWidth) break;
    out += ch;
  }
  return (out || source.slice(0, 1)) + "…";
}

export class JiapuView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.store = plugin.store;
    this.viewport = { zoom: 1, tx: 0, ty: 0 };
    this.layout = null;
    this.interaction = null;
    this.selected = null;
    this.ready = false;
    this.unsubscribe = null;
    this.frame = null;
    this.dragMoved = false;
    this.guides = null;
    this.hoverFamily = null;
    this.gridId = "jiapu-grid-" + ++clipSeq;
    /** 紧缩前的坐标快照，一层就够用 */
    this.undoStack = [];
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    const name = this.store?.activeLayout?.name;
    return name ? t("家谱图 · {name}", { name }) : t("家谱图");
  }

  getIcon() {
    return "network";
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("jiapu-view");
    this.buildChrome();
    this.unsubscribe = this.store.onChange(() => this.scheduleRender());
    this.ready = true;
    await this.store.load();
    this.render();
    this.updateUndoButton();
    window.setTimeout(() => this.fit(), 40);
  }

  async onClose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.store.flush();
  }

  // ---------- 骨架 ----------

  /** 主题只写 CSS 变量到视图根节点，卡片和连线全是 var()，换主题不用重画 */
  applyTheme() {
    applyThemeTo(this.contentEl, this.plugin.settings?.theme);
  }

  buildChrome() {
    this.applyTheme();
    const root = this.contentEl.createDiv({ cls: "jiapu-root" });
    this.rootEl = root;

    const bar = root.createDiv({ cls: "jiapu-toolbar" });
    textButton(bar, t("＋ 人物"), () => this.addStandalone());
    iconButton(bar, "users", t("从人物库添加（别的布局里已经有的人）"), () =>
      this.openPeoplePicker(),
    );
    iconButton(bar, "user-minus", t("批量移除卡片（多选）"), () =>
      this.openRemovePeople(),
    );
    bar.createDiv({ cls: "jiapu-toolbar-sep" });

    // 布局切换：按钮上直接写当前布局名
    const layoutButton = bar.createEl("button", {
      cls: "jiapu-tool jiapu-tool-text jiapu-layout-btn",
    });
    this.layoutLabel = layoutButton.createSpan({ cls: "jiapu-layout-label" });
    const caret = layoutButton.createSpan({ cls: "jiapu-layout-caret" });
    setIcon(caret, "chevron-down");
    layoutButton.addEventListener("click", (event) => this.layoutMenu(event));
    this.layoutButton = layoutButton;
    iconButton(bar, "layers", t("管理布局（改名、备注、排序、复制、删除）"), () =>
      this.openLayoutsModal(),
    );

    bar.createDiv({ cls: "jiapu-toolbar-sep" });
    iconButton(bar, "maximize", t("适应窗口"), () => this.fit());
    iconButton(bar, "zoom-in", t("放大"), () => this.zoomBy(1.2));
    this.zoomLabel = bar.createDiv({ cls: "jiapu-zoom", text: "100%" });
    iconButton(bar, "zoom-out", t("缩小"), () => this.zoomBy(1 / 1.2));
    bar.createDiv({ cls: "jiapu-toolbar-sep" });
    this.snapToggle = iconButton(
      bar,
      "magnet",
      t("吸附对齐（拖动时对齐别人的中线、留白和父母中点；按住 Alt 可临时关闭）"),
      () => this.toggleSnap(),
      this.plugin.settings.snap === false ? "" : "is-on",
    );
    this.datesToggle = iconButton(
      bar,
      "calendar-days",
      t("显示/隐藏生日"),
      () => this.toggleDates(),
      this.plugin.settings.showDates ? "is-on" : "",
    );
    iconButton(bar, "minimize-2", t("紧缩空间并居中（不重排、不改代际）"), () =>
      this.compactNow(),
    );
    iconButton(bar, "calculator", t("亲戚计算器"), () => this.openKinship());
    iconButton(bar, "palette", t("主题（配色、线宽）"), () => this.plugin.openTheme?.());
    bar.createDiv({ cls: "jiapu-toolbar-spacer" });
    this.undoButton = iconButton(bar, "undo-2", t("撤销上一次紧缩"), () =>
      this.undoCompact(),
    );
    this.undoButton.disabled = true;
    this.undoButton.classList.toggle("is-dim", true);

    // 备份管的是整个图谱（所有布局 + 人物库），跟「当前布局」无关，所以放最右边。
    // 图标用「往下存 / 往上取」：archive 看着像压缩包、history 看着像刚操作过，
    // 都读不出「备份 / 恢复」这层意思。
    bar.createDiv({ cls: "jiapu-toolbar-sep" });
    iconButton(
      bar,
      "download",
      t("导出备份（所有布局 + 人物库，存成一个 JSON）"),
      () => void this.plugin.exportBackup?.(),
    );
    iconButton(bar, "upload", t("从备份恢复（列表里挑一份）"), () =>
      this.plugin.openBackups?.(),
    );

    const canvas = root.createDiv({ cls: "jiapu-canvas" });
    this.canvasEl = canvas;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "jiapu-svg");
    canvas.appendChild(svg);
    this.svg = svg;

    // 背景点阵：跟着平移走，缩放时保持点的大小不变
    const defs = el("defs");
    const pattern = el("pattern", {
      id: this.gridId,
      width: GRID_SIZE,
      height: GRID_SIZE,
      patternUnits: "userSpaceOnUse",
    });
    pattern.appendChild(
      el("circle", { cx: 1, cy: 1, r: 1, class: "jiapu-grid-dot" }),
    );
    defs.appendChild(pattern);
    svg.appendChild(defs);
    svg.appendChild(
      el("rect", {
        class: "jiapu-grid",
        x: 0,
        y: 0,
        width: "100%",
        height: "100%",
        fill: `url(#${this.gridId})`,
      }),
    );
    this.gridPattern = pattern;

    this.stage = el("g", { class: "jiapu-stage" });
    svg.appendChild(this.stage);
    this.linkLayer = el("g", { class: "jiapu-links" });
    this.nodeLayer = el("g", { class: "jiapu-nodes" });
    this.overlayLayer = el("g", { class: "jiapu-overlay" });
    this.stage.append(this.linkLayer, this.nodeLayer, this.overlayLayer);

    // 鼠标停在哪条线上，就把这一家的线整条点亮，方便确认"这条线连的是谁"
    this.linkLayer.addEventListener("pointerover", (event) => {
      const family =
        event.target?.closest?.("[data-family]")?.getAttribute("data-family") ??
        null;
      this.setFamilyHover(family);
    });
    this.linkLayer.addEventListener("pointerleave", () =>
      this.setFamilyHover(null),
    );

    const hint = root.createDiv({ cls: "jiapu-hint" });
    hint.setText(
      t(
        "拖动卡片：左右挪位置、上下换排（一代人只占一行）· 双击打开笔记 · 右键改关系 · 左上角切换布局",
      ),
    );
    this.hintEl = hint;

    svg.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    svg.addEventListener("wheel", (event) => this.onWheel(event), {
      passive: false,
    });
    svg.addEventListener("dblclick", (event) => this.onDoubleClick(event));
    svg.addEventListener("contextmenu", (event) => this.onContextMenu(event));
    this.registerDomEvent(window, "resize", () => this.keepInView());

    // 笔记是否还在，每帧都要问一遍——问结果缓存起来，库里有增删改再清掉
    this.noteCache = new Map();
    const forgetNotes = () => {
      if (!this.noteCache.size) return;
      this.noteCache.clear();
      this.render();
    };
    if (typeof this.app?.vault?.on === "function") {
      this.registerEvent(this.app.vault.on("create", forgetNotes));
      this.registerEvent(this.app.vault.on("delete", forgetNotes));
      this.registerEvent(this.app.vault.on("rename", forgetNotes));
    }
    if (typeof this.app?.metadataCache?.on === "function") {
      this.registerEvent(this.app.metadataCache.on("resolved", forgetNotes));
    }
  }

  /** 这个人的笔记还在不在？返回 TFile 或 null（结果按路径缓存） */
  noteFileOf(node) {
    const path = node?.note;
    if (!path) return null;
    if (this.noteCache?.has(path)) return this.noteCache.get(path);
    let file = null;
    try {
      file = this.store.resolveNote(path) ?? null;
    } catch (error) {
      file = null;
    }
    this.noteCache?.set(path, file);
    return file;
  }

  // ---------- 布局 ----------

  updateLayoutLabel() {
    const layout = this.store.activeLayout;
    if (!layout) return;
    this.layoutLabel?.setText(layout.name);
    if (this.layoutButton) {
      const tip = layout.remark
        ? `${layout.name}：${layout.remark}`
        : t("{name}（{count} 人）", {
            name: layout.name,
            count: layout.nodes.length,
          });
      this.layoutButton.setAttribute("aria-label", t("切换布局 — {tip}", { tip }));
      this.layoutButton.setAttribute("title", tip);
    }
    // 标签页标题也跟着布局名走（老版本没有这个方法，忽略即可）
    this.leaf?.updateHeader?.();
  }

  /** Obsidian 的菜单要一个鼠标事件；没有就用固定的落点兜底 */
  showMenu(menu, event) {
    if (
      event &&
      typeof event.clientX === "number" &&
      typeof menu.showAtMouseEvent === "function"
    ) {
      menu.showAtMouseEvent(event);
      return;
    }
    if (typeof menu.showAtPosition === "function") {
      const rect = this.layoutButton?.getBoundingClientRect?.();
      menu.showAtPosition({
        x: rect ? rect.left : 160,
        y: rect ? rect.bottom + 4 : 90,
      });
    }
  }

  layoutMenu(event) {
    const menu = new Menu();
    for (const layout of this.store.layouts) {
      const active = layout.id === this.store.activeId;
      menu.addItem((item) => {
        item
          .setTitle(
            t("{name}（{count} 人）", {
              name: layout.name,
              count: layout.nodes.length,
            }),
          )
          .setIcon(active ? "check" : "square")
          .onClick(() => this.switchLayout(layout.id));
      });
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("新建布局…"))
        .setIcon("plus")
        .onClick(() => this.newLayout()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("复制当前布局"))
        .setIcon("copy")
        .onClick(() => this.duplicateLayout()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("重命名当前布局…"))
        .setIcon("pencil")
        .onClick(() => this.renameLayout()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("编辑布局备注…"))
        .setIcon("text")
        .onClick(() => this.editRemark()),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("管理布局…"))
        .setIcon("layers")
        .onClick(() => this.openLayoutsModal()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("导出当前布局为 Markdown"))
        .setIcon("file-down")
        .onClick(() => void this.plugin.exportLayout?.(this.store.activeId)),
    );
    this.showMenu(menu, event);
  }

  switchLayout(id) {
    if (!this.store.activateLayout(id)) return;
    this.selected = null;
    this.undoStack = [];
    this.updateUndoButton();
    this.render();
    this.fit();
    const layout = this.store.activeLayout;
    new Notice(
      t("已切到布局「{name}」（{count} 人）", {
        name: layout.name,
        count: layout.nodes.length,
      }),
    );
  }

  newLayout() {
    const suggested = isEn()
      ? `Family graph ${this.store.layouts.length + 1}`
      : `家族图 ${this.store.layouts.length + 1}`;
    new PromptModal(this.app, {
      title: t("新建布局"),
      label: t("布局名称"),
      value: suggested,
      placeholder: t("比如：母系、配偶家这边"),
      onSubmit: (value) => {
        const name = String(value ?? "").trim() || suggested;
        const layout = this.store.createLayout(name);
        this.switchLayout(layout.id);
      },
    }).open();
  }

  duplicateLayout() {
    const copy = this.store.duplicateLayout(this.store.activeId);
    if (!copy) return;
    new Notice(t("已复制成「{name}」", { name: copy.name }));
    this.switchLayout(copy.id);
  }

  renameLayout(id = this.store.activeId) {
    const layout = this.store.getLayout(id);
    if (!layout) return;
    new PromptModal(this.app, {
      title: t("重命名布局"),
      label: t("名称"),
      value: layout.name,
      onSubmit: (value) => {
        if (this.store.renameLayout(id, value)) {
          this.updateLayoutLabel();
          new Notice(
            t("已改名为「{name}」", { name: this.store.getLayout(id).name }),
          );
        }
      },
    }).open();
  }

  editRemark(id = this.store.activeId) {
    const layout = this.store.getLayout(id);
    if (!layout) return;
    new PromptModal(this.app, {
      title: t("布局备注"),
      label: t("备注"),
      value: layout.remark ?? "",
      multiline: true,
      placeholder: t("这张图是给谁看的、收的是哪一支…"),
      onSubmit: (value) => {
        this.store.setLayoutRemark(id, value);
        this.updateLayoutLabel();
        new Notice(t("备注已保存"));
      },
    }).open();
  }

  openLayoutsModal() {
    new LayoutsModal(this.app, {
      store: this.store,
      onOpenLayout: () => {
        this.selected = null;
        this.render();
        window.setTimeout(() => this.fit(), 30);
      },
      onExportAll: this.plugin.exportAllLayouts
        ? () => void this.plugin.exportAllLayouts()
        : null,
    }).open();
  }

  openPeoplePicker() {
    const candidates = this.store.peopleNotInLayout();
    if (!candidates.length) {
      new Notice(
        t("人物库里没有别人了——想让同一个人出现在另一张图，先新建一个布局"),
      );
      return;
    }
    new PeoplePickerModal(this.app, {
      store: this.store,
      onPick: (ids) => {
        if (!ids.length) return;
        this.store.addPeopleToLayout(ids);
        this.render();
        this.fit();
        new Notice(
          t("已把 {count} 个人加进这张图，位置可以自己拖", { count: ids.length }),
        );
      },
    }).open();
  }

  /** 批量移除：一次性把选中的卡片从这张图拿掉 */
  openRemovePeople() {
    if (!this.store.nodes.length) {
      new Notice(t("这张图上还没有人"));
      return;
    }
    new RemovePeopleModal(this.app, {
      store: this.store,
      onRemove: (ids) => this.removePeople(ids),
    }).open();
  }

  removePeople(ids) {
    if (!ids?.length) return;
    const { removed, forgotten } = this.store.removeNodes(ids);
    if (!removed) return;
    if (this.selected && ids.includes(this.selected)) this.selected = null;
    this.render();
    new Notice(
      forgotten
        ? t(
            "已从这张图移除 {count} 人；其中 {forgotten} 人在这张图之外没人用了，资料已清掉（笔记没动）",
            { count: removed, forgotten },
          )
        : t("已从这张图移除 {count} 人，人物资料和笔记都还在", {
            count: removed,
          }),
    );
  }

  // ---------- 紧缩 / 撤销 ----------

  compactNow() {
    if (!this.store.nodes.length) {
      new Notice(t("图里还没有人"));
      return;
    }
    const snapshot = snapshotPositions(this.store);
    const result = compactLayout(this.store);
    if (!result.changed) {
      new Notice(t("已经很紧凑了：该挨的都挨着了，没有能再收紧的空间"));
      return;
    }
    this.undoStack.push({ layoutId: this.store.activeId, snapshot });
    if (this.undoStack.length > 20) this.undoStack.shift();
    this.updateUndoButton();
    this.store.queueSave();
    this.store.emit();
    this.render();
    this.fit();
    new Notice(t("已去掉空排、收紧间距并居中。不想要就点工具栏的撤销。"));
  }

  undoCompact() {
    const last = this.undoStack.pop();
    this.updateUndoButton();
    if (!last) {
      new Notice(t("没有可撤销的紧缩"));
      return;
    }
    if (last.layoutId !== this.store.activeId) {
      new Notice(t("上次紧缩是在另一张布局上做的"));
      return;
    }
    restorePositions(this.store, last.snapshot);
    this.store.queueSave();
    this.store.emit();
    this.render();
    this.fit();
    new Notice(t("已还原到紧缩之前的位置"));
  }

  updateUndoButton() {
    if (!this.undoButton) return;
    const usable =
      this.undoStack.length > 0 &&
      this.undoStack[this.undoStack.length - 1].layoutId ===
        this.store.activeId;
    this.undoButton.disabled = !usable;
    this.undoButton.classList.toggle("is-dim", !usable);
  }

  // ---------- 亲戚计算器 ----------

  openKinship(fromId) {
    new KinshipModal(this.app, {
      store: this.store,
      fromId: fromId ?? this.selected ?? "",
      toId: "",
    }).open();
  }

  // ---------- 渲染 ----------

  scheduleRender() {
    if (!this.ready) return;
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  render() {
    if (!this.svg) return;
    // 新加的人还没有坐标，先补一个，保证画得出来
    if (ensurePositions(this.store)) this.store.queueSave();

    const layout = computeLayout(this.store, {
      showDates: this.plugin.settings.showDates,
    });
    this.layout = layout;
    this.hoverFamily = null;
    this.updateLayoutLabel();
    this.applyTransform();
    clearChildren(this.linkLayer);
    clearChildren(this.nodeLayer);
    clearChildren(this.overlayLayer);

    for (const path of layout.parentPaths) this.drawFamilyLinks(path);
    for (const line of layout.spouseLines) this.drawSpouseLine(line);
    for (const line of layout.otherLines) this.drawOtherLine(line);
    for (const box of layout.boxes) this.drawNode(box);

    this.drawGuides();
    if (this.interaction?.kind === "link" && this.interaction.preview)
      this.overlayLayer.appendChild(this.interaction.preview);
  }

  applyTransform() {
    const { zoom, tx, ty } = this.viewport;
    this.stage.setAttribute(
      "transform",
      `translate(${tx} ${ty}) scale(${zoom})`,
    );
    if (this.zoomLabel) this.zoomLabel.setText(Math.round(zoom * 100) + "%");
    if (this.gridPattern) {
      const step = GRID_SIZE;
      this.gridPattern.setAttribute(
        "patternTransform",
        `translate(${(((tx % step) + step) % step).toFixed(2)} ${(((ty % step) + step) % step).toFixed(2)})`,
      );
    }
  }

  /**
   * 一家人的亲子线：横线 + 主干只画一次（重复描边会发灰发虚），
   * 每个子女单独一条竖线，右键能精确定位到人。
   */
  drawFamilyLinks(path) {
    const family = path.family;
    const parentIds = path.parentIds.join(",");
    const busPath = `M${path.bus.from},${path.bus.y}H${path.bus.to}`;
    const trunkPath = `M${path.trunk.x},${path.trunk.from}V${path.trunk.to}`;

    const skeleton = el("g", {
      class: "jiapu-line parent is-family",
      "data-family": family,
      "data-parents": parentIds,
    });
    skeleton.appendChild(el("path", { class: "jiapu-hit", d: busPath }));
    skeleton.appendChild(el("path", { class: "jiapu-hit", d: trunkPath }));
    skeleton.appendChild(el("path", { class: "jiapu-seg", d: busPath }));
    skeleton.appendChild(el("path", { class: "jiapu-seg", d: trunkPath }));
    this.linkLayer.appendChild(skeleton);

    for (const drop of path.drops) {
      const d = `M${drop.x},${drop.from}V${drop.to}`;
      const group = el("g", {
        class: "jiapu-line parent is-drop",
        "data-family": family,
        "data-child": drop.child,
        "data-parents": parentIds,
      });
      group.appendChild(el("path", { class: "jiapu-hit", d }));
      group.appendChild(el("path", { class: "jiapu-seg", d }));
      this.linkLayer.appendChild(group);
    }
  }

  drawSpouseLine(line) {
    const group = el("g", {
      class: "jiapu-line spouse",
      "data-edge": line.edgeId ?? undefined,
      "data-from": line.from,
      "data-to": line.to,
    });
    // 中间没隔着别人就直连，隔着就绕到上方
    const d =
      line.x2 - line.x1 <= 34
        ? `M${line.x1 - 1},${line.y1}H${line.x2 + 1}`
        : roundedPath(
            [
              { x: line.x1, y: line.y1 },
              { x: line.x1 + 9, y: line.y1 },
              { x: line.x1 + 9, y: line.top },
              { x: line.x2 - 9, y: line.top },
              { x: line.x2 - 9, y: line.y2 },
              { x: line.x2, y: line.y2 },
            ],
            9,
          );
    group.appendChild(el("path", { class: "jiapu-hit", d }));
    group.appendChild(el("path", { class: "jiapu-seg", d }));
    group.appendChild(
      el("circle", {
        class: "jiapu-knot",
        cx: line.x1 + 3,
        cy: line.y1,
        r: 2.6,
      }),
    );
    group.appendChild(
      el("circle", {
        class: "jiapu-knot",
        cx: line.x2 - 3,
        cy: line.y2,
        r: 2.6,
      }),
    );
    // 两口子贴在一起时，线上方挂一个「⇄」：点一下两人左右对调
    if (line.edgeId && line.x2 - line.x1 <= 60 && line.x2 > line.x1) {
      const midX = (line.x1 + line.x2) / 2;
      const swap = el("g", {
        class: "jiapu-swap",
        "data-swap": `${line.from}|${line.to}`,
        transform: `translate(${midX} ${line.y1 - 46})`,
      });
      swap.appendChild(el("circle", { class: "jiapu-swap-hit", r: 11 }));
      swap.appendChild(el("circle", { class: "jiapu-swap-ring", r: 7.5 }));
      swap.appendChild(
        el("path", {
          class: "jiapu-swap-icon",
          d: "M-3.4 0H3.4M-3.4 0l1.9-1.7M-3.4 0l1.9 1.7M3.4 0l-1.9-1.7M3.4 0l-1.9 1.7",
        }),
      );
      const title = el("title");
      title.textContent = t("点一下：两人左右对调");
      swap.appendChild(title);
      group.appendChild(swap);
    }
    this.linkLayer.appendChild(group);
  }

  drawOtherLine(line) {
    const { from, to } = line;
    const x1 = from.x;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const midY = Math.max(y1, y2) + 40;
    const d = roundedPath(
      [
        { x: x1, y: y1 },
        { x: x1, y: midY },
        { x: x2, y: midY },
        { x: x2, y: y2 },
      ],
      12,
    );
    const group = el("g", {
      class: "jiapu-line other",
      "data-edge": line.edge.id,
    });
    group.appendChild(el("path", { class: "jiapu-hit", d }));
    group.appendChild(el("path", { class: "jiapu-seg", d }));
    this.linkLayer.appendChild(group);
  }

  drawNode(box) {
    const node = box.node;
    const { w, h } = box;
    const showDates = this.plugin.settings.showDates;
    const group = el("g", {
      class:
        "jiapu-node" +
        (node.sex === "male"
          ? " is-male"
          : node.sex === "female"
            ? " is-female"
            : " is-unknown") +
        (isDeceased(node) ? " is-deceased" : "") +
        (this.selected === node.id ? " is-selected" : ""),
      transform: `translate(${box.x} ${box.y})`,
      "data-id": node.id,
    });

    const clipId = "jiapu-clip-" + node.id.replace(/[^\w-]/g, "");
    const defs = el("defs");
    const clip = el("clipPath", { id: clipId });
    clip.appendChild(
      el("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: 12, ry: 12 }),
    );
    defs.appendChild(clip);
    group.appendChild(defs);

    group.appendChild(
      el("rect", {
        class: "jiapu-card",
        x: -w / 2,
        y: -h / 2,
        width: w,
        height: h,
        rx: 12,
        ry: 12,
      }),
    );
    group.appendChild(
      el("rect", {
        class: "jiapu-accent",
        x: -w / 2,
        y: -h / 2,
        width: 4,
        height: h,
        "clip-path": `url(#${clipId})`,
      }),
    );

    const nameSize = 15;
    const nameMax = w - 30;
    const hasDates = showDates && (node.birth || node.death);
    const nameY = hasDates ? -8 : 0;
    group.appendChild(
      el("text", {
        class: "jiapu-name",
        x: 0,
        y: nameY,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-size": nameSize,
      }),
    ).textContent = fitText(node.name, nameMax, nameSize);

    if (hasDates) {
      // 生卒都写全（1942-03-12 — 2019-11-02）在 104px 宽的卡片里放不下，
      // 只会被截成「1942-03-12 — …」，看着像数据坏了。放不下就退成纯年份。
      const year = (value) => (/^\d{4}/.test(String(value ?? "")) ? String(value).slice(0, 4) : null);
      let text = node.birth
        ? node.death
          ? `${node.birth} — ${node.death}`
          : node.birth
        : node.death;
      if (textWidth(text, 10.5) > nameMax + 10 && node.birth && node.death) {
        const from = year(node.birth);
        const to = year(node.death);
        if (from && to) text = `${from} — ${to}`;
      }
      group.appendChild(
        el("text", {
          class: "jiapu-dates",
          x: 0,
          y: 14,
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          "font-size": 10.5,
        }),
      ).textContent = fitText(text, nameMax + 10, 10.5);
    }

    if (isDeceased(node)) {
      const mark = el("g", {
        class: "jiapu-death-mark",
        transform: `translate(${-w / 2 + 13} ${-h / 2 + 14})`,
      });
      mark.appendChild(el("circle", { r: 8, class: "jiapu-death-dot" }));
      // 原来画的是「圆里一个细十字」，远看像「＋」（添加）按钮，老有人以为能点。
      // 直接用 † 字形，一眼就是已故标记。
      const cross = el("text", {
        class: "jiapu-death-cross",
        x: 0,
        y: 0.8,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-size": 11.5,
      });
      cross.textContent = "†";
      mark.appendChild(cross);
      const title = el("title");
      title.textContent = node.death
        ? t("已故（{date}）", { date: node.death })
        : t("已故");
      mark.appendChild(title);
      group.appendChild(mark);
    }

    // 右上角的文件标识：只有笔记确实还在库里的才画。
    // 光有 note 字符串不算——笔记被删/挪走之后链接是死的，画个图标等于骗人。
    if (this.noteFileOf(node)) {
      const badge = el("g", {
        class: "jiapu-badge",
        transform: `translate(${w / 2 - 14} ${-h / 2 + 14})`,
      });
      badge.appendChild(
        el("rect", {
          class: "jiapu-badge-tile",
          x: -8,
          y: -8,
          width: 16,
          height: 16,
          rx: 4,
          ry: 4,
        }),
      );
      badge.appendChild(
        el("path", {
          class: "jiapu-badge-icon",
          d: "M-4.2-5.2h5.2l3.2 3.2v7.2h-8.4z",
        }),
      );
      badge.appendChild(
        el("path", {
          class: "jiapu-badge-fold",
          d: "M1-5.2v3.2h3.2",
        }),
      );
      const title = el("title");
      title.textContent = t("已链接笔记，双击打开：{note}", { note: node.note });
      badge.appendChild(title);
      group.appendChild(badge);
    }

    if (node.remark) {
      const title = el("title");
      title.textContent = node.remark;
      group.appendChild(title);
    }

    // 连线把手
    const childHandle = el("g", {
      class: "jiapu-handle handle-child",
      "data-handle": "child",
      "data-from": node.id,
      transform: `translate(0 ${h / 2})`,
    });
    childHandle.appendChild(el("circle", { r: 10, class: "jiapu-handle-hit" }));
    childHandle.appendChild(
      el("circle", { r: 3.4, class: "jiapu-handle-dot" }),
    );
    group.appendChild(childHandle);

    const spouseHandle = el("g", {
      class: "jiapu-handle handle-spouse",
      "data-handle": "spouse",
      "data-from": node.id,
      transform: `translate(${w / 2} 0)`,
    });
    spouseHandle.appendChild(
      el("circle", { r: 10, class: "jiapu-handle-hit" }),
    );
    spouseHandle.appendChild(
      el("circle", { r: 3.4, class: "jiapu-handle-dot" }),
    );
    group.appendChild(spouseHandle);

    this.nodeLayer.appendChild(group);
  }

  setFamilyHover(family) {
    if (this.hoverFamily === family) return;
    this.hoverFamily = family;
    const children = this.linkLayer?.children ?? [];
    for (const child of children) {
      const match =
        family !== null && child.getAttribute?.("data-family") === family;
      child.classList?.toggle("is-hl", Boolean(match));
    }
  }

  drawGuides() {
    const guides = this.guides;
    const layout = this.layout;
    if (!guides || !layout) return;
    const top = layout.minY - 600;
    const bottom = layout.minY + layout.height + 600;
    const left = layout.minX - 600;
    const right = layout.minX + layout.width + 600;
    if (Number.isFinite(guides.x))
      this.overlayLayer.appendChild(
        el("line", {
          class: "jiapu-guide is-v",
          x1: guides.x,
          y1: top,
          x2: guides.x,
          y2: bottom,
        }),
      );
    if (Number.isFinite(guides.y))
      this.overlayLayer.appendChild(
        el("line", {
          class: "jiapu-guide is-h",
          x1: left,
          y1: guides.y,
          x2: right,
          y2: guides.y,
        }),
      );
  }

  // ---------- 坐标换算 ----------

  toGraph(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const { zoom, tx, ty } = this.viewport;
    return {
      x: (clientX - rect.left - tx) / zoom,
      y: (clientY - rect.top - ty) / zoom,
    };
  }

  boxAt(clientX, clientY) {
    const point = this.toGraph(clientX, clientY);
    if (!this.layout) return null;
    for (const box of this.layout.boxes) {
      if (
        Math.abs(point.x - box.x) <= box.w / 2 + 2 &&
        Math.abs(point.y - box.y) <= box.h / 2 + 2
      )
        return box;
    }
    return null;
  }

  nameOf(id) {
    return this.store.getNode(id)?.name ?? t("这个节点");
  }

  // ---------- 指针交互 ----------

  onPointerDown(event) {
    if (event.button === 2) return;
    const target = event.target;
    // 配偶线中间的「⇄」：按一下就换，别让它变成平移或拖卡
    const swapEl = target.closest?.("[data-swap]");
    if (swapEl) {
      event.preventDefault();
      event.stopPropagation();
      const [a, b] = String(swapEl.getAttribute("data-swap") ?? "").split("|");
      if (a && b) this.swapWithSpouse(a, b);
      return;
    }
    const handle = target.closest?.("[data-handle]");
    if (handle) {
      event.preventDefault();
      event.stopPropagation();
      this.startLink(
        event,
        handle.getAttribute("data-from"),
        handle.getAttribute("data-handle"),
      );
      return;
    }
    const nodeEl = target.closest?.("[data-id]");
    if (nodeEl && event.button === 0) {
      // 这里不能 preventDefault：会让浏览器吞掉后面的 dblclick，
      // 双击打开笔记就失灵了。选中态用 class 直接改，不重建 DOM。
      event.stopPropagation();
      this.startNodeDrag(event, nodeEl.getAttribute("data-id"), nodeEl);
      return;
    }
    if (event.button === 0 || event.button === 1) {
      event.preventDefault();
      this.startPan(event);
    }
  }

  startPan(event) {
    const start = {
      x: event.clientX,
      y: event.clientY,
      tx: this.viewport.tx,
      ty: this.viewport.ty,
    };
    this.interaction = { kind: "pan", start };
    this.selected = null;
    this.render();
    const move = (moveEvent) => {
      this.viewport.tx = start.tx + (moveEvent.clientX - start.x);
      this.viewport.ty = start.ty + (moveEvent.clientY - start.y);
      this.applyTransform();
    };
    this.capture(move, () => {
      this.interaction = null;
    });
  }

  startNodeDrag(event, id, nodeEl) {
    const box = this.layout?.boxes.find((item) => item.id === id);
    const node = this.store.getNode(id);
    if (!box || !node) return;

    const members = [id, ...this.store.spousesOf(id)];
    const snapshot = [];
    for (const memberId of members) {
      const memberBox = this.layout.boxes.find((item) => item.id === memberId);
      const memberNode = this.store.getNode(memberId);
      if (memberBox && memberNode)
        snapshot.push({ node: memberNode, x: memberBox.x, row: memberBox.row });
    }
    if (!snapshot.length) return;

    // 吸附要以「按下时的位置」为基准，否则每帧都会在上一次位移上累加
    const origin = snapshot.map((item) => ({
      id: item.node.id,
      x: item.x,
      w:
        this.layout.boxes.find((candidate) => candidate.id === item.node.id)
          ?.w ?? 104,
    }));

    // 能换到哪几排：父母下一排起，子女上一排止
    const bounds = this.rowBounds(members, box.row);
    const start = this.toGraph(event.clientX, event.clientY);
    this.dragMoved = false;
    this.selected = id;
    this.guides = null;
    this.interaction = { kind: "node", id, start, snapshot };
    // 只改选中样式，不 render：重建 DOM 会打断紧接着的 dblclick
    const selectedEl =
      nodeEl ?? this.nodeLayer?.querySelector?.(`[data-id="${id}"]`);
    if (selectedEl) {
      for (const child of this.nodeLayer?.children ?? [])
        child.classList?.remove?.("is-selected");
      selectedEl.classList?.add?.("is-selected");
    }

    const move = (moveEvent) => {
      const point = this.toGraph(moveEvent.clientX, moveEvent.clientY);
      let dx = point.x - start.x;
      const dy = point.y - start.y;
      if (!this.dragMoved && Math.hypot(dx, dy) * this.viewport.zoom < 3)
        return;
      this.dragMoved = true;

      const useSnap = this.plugin.settings.snap !== false && !moveEvent.altKey;
      let guideX = null;
      if (useSnap) {
        const snap = this.snapX(members, dx, origin);
        dx += snap.dx;
        guideX = snap.guide;
      }

      // 高低不浮动：只吸附到整行基线
      const row = this.targetRow(box, dy, bounds);
      const y = rowY(row);

      for (const item of snapshot) {
        item.node.x = item.x + dx;
        item.node.row = row;
        item.node.y = y;
      }
      this.guides = { x: guideX, y };
      this.render();
    };

    this.capture(move, () => {
      this.interaction = null;
      this.guides = null;
      if (!this.dragMoved) return;
      this.settleRow(members);
      this.store.queueSave();
      this.store.emit();
    });
  }

  /** 拖动后的落点排：四舍五入到整行，再夹在合法范围内（绝不会有半行） */
  targetRow(box, dy, bounds) {
    const desired = Math.round((box.y + dy - PAD) / ROW_H);
    return clamp(desired, bounds.min, bounds.max);
  }

  /** 这一组人最多能拖到哪一排、最少能拖到哪一排 */
  rowBounds(members, currentRow) {
    let min = -Infinity;
    let max = Infinity;
    const rowOf = (id) => this.layout?.rowOf.get(id);
    for (const id of members) {
      for (const parentId of this.store.parentsOf(id)) {
        const row = rowOf(parentId);
        if (row !== undefined) min = Math.max(min, row + 1);
      }
      for (const childId of this.store.childrenOf(id)) {
        const row = rowOf(childId);
        if (row !== undefined) max = Math.min(max, row - 1);
      }
    }
    if (min > max) return { min: currentRow, max: currentRow };
    return { min, max };
  }

  /**
   * 松手之后如果压在别人身上，推到最近的空位（只动横向，绝不改排）。
   */
  settleRow(members) {
    const boxes = this.layout?.boxes ?? [];
    const moving = new Set(members);
    const group = boxes.filter((box) => moving.has(box.id));
    if (!group.length) return;
    const row = group[0].row;
    const obstacles = boxes.filter(
      (box) => !moving.has(box.id) && box.row === row,
    );
    if (!obstacles.length) return;

    const left = Math.min(...group.map((box) => box.x - box.w / 2));
    const right = Math.max(...group.map((box) => box.x + box.w / 2));
    const width = right - left;
    const clear = (candidate) =>
      obstacles.every(
        (box) =>
          candidate + width + 6 <= box.x - box.w / 2 ||
          candidate - 6 >= box.x + box.w / 2,
      );

    let best = clear(left) ? { x: left, distance: 0 } : null;
    for (const box of obstacles) {
      for (const candidate of [
        box.x + box.w / 2 + H_GAP,
        box.x - box.w / 2 - H_GAP - width,
      ]) {
        if (!clear(candidate)) continue;
        const distance = Math.abs(candidate - left);
        if (!best || distance < best.distance)
          best = { x: candidate, distance };
      }
    }
    if (!best || best.distance === 0) return;

    const shift = best.x - left;
    for (const box of group) {
      const node = this.store.getNode(box.id);
      if (node) node.x += shift;
    }
  }

  /**
   * 横向吸附：一组人的包围盒去贴——
   * 同排卡片的中线、两卡之间的正中、卡片左右留白、父母中点、子女中点。
   */
  snapX(members, dx, origin) {
    const boxes = this.layout?.boxes ?? [];
    const moving = new Set(members);
    const group = origin ?? boxes.filter((box) => moving.has(box.id));
    if (!group.length) return { dx: 0, guide: null };

    const row = this.layout?.rowOf.get(members[0]) ?? 0;
    const left = Math.min(...group.map((box) => box.x - box.w / 2)) + dx;
    const right = Math.max(...group.map((box) => box.x + box.w / 2)) + dx;
    const center = (left + right) / 2;
    const width = right - left;
    const limit = SNAP_PX / this.viewport.zoom;
    const targets = [];

    const rowBoxes = boxes
      .filter((box) => box.row === row && !moving.has(box.id))
      .sort((a, b) => a.x - b.x);
    for (const box of rowBoxes) {
      targets.push({ value: box.x, guide: box.x });
      targets.push({
        value: box.x + box.w / 2 + H_GAP + width / 2,
        guide: box.x + box.w / 2,
      });
      targets.push({
        value: box.x - box.w / 2 - H_GAP - width / 2,
        guide: box.x - box.w / 2,
      });
    }
    for (let i = 0; i < rowBoxes.length - 1; i++) {
      const a = rowBoxes[i];
      const b = rowBoxes[i + 1];
      const middle = (a.x + a.w / 2 + (b.x - b.w / 2)) / 2;
      targets.push({ value: middle, guide: middle });
    }

    const parentPairs = new Map();
    const childBoxes = [];
    for (const id of members) {
      const parents = this.store.parentsOf(id);
      if (parents.length) {
        const key = parents.slice().sort().join("|");
        if (!parentPairs.has(key)) parentPairs.set(key, parents);
      }
      for (const childId of this.store.childrenOf(id)) {
        const found = boxes.find((box) => box.id === childId);
        if (found && !moving.has(childId)) childBoxes.push(found);
      }
    }
    for (const parents of parentPairs.values()) {
      const found = parents
        .map((parentId) => boxes.find((box) => box.id === parentId))
        .filter((box) => box && !moving.has(box.id));
      if (!found.length) continue;
      const edgeLeft = Math.min(...found.map((box) => box.x - box.w / 2));
      const edgeRight = Math.max(...found.map((box) => box.x + box.w / 2));
      const middle = (edgeLeft + edgeRight) / 2;
      targets.push({ value: middle, guide: middle });
    }
    if (childBoxes.length) {
      const edgeLeft = Math.min(...childBoxes.map((box) => box.x - box.w / 2));
      const edgeRight = Math.max(...childBoxes.map((box) => box.x + box.w / 2));
      const middle = (edgeLeft + edgeRight) / 2;
      targets.push({ value: middle, guide: middle });
    }

    let best = null;
    for (const target of targets) {
      const delta = target.value - center;
      if (Math.abs(delta) > limit) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta))
        best = { delta, guide: target.guide };
    }
    return { dx: best ? best.delta : 0, guide: best ? best.guide : null };
  }

  startLink(event, fromId, kind) {
    if (!fromId) return;
    const preview = el("path", { class: "jiapu-link-preview" });
    this.interaction = { kind: "link", fromId, handle: kind, preview };
    this.render();

    const move = (moveEvent) => {
      const box = this.boxAt(moveEvent.clientX, moveEvent.clientY);
      const from = this.layout?.boxes.find((item) => item.id === fromId);
      if (!from) return;
      const target = this.toGraph(moveEvent.clientX, moveEvent.clientY);
      const startX = kind === "spouse" ? from.x + from.w / 2 : from.x;
      const startY = kind === "spouse" ? from.y : from.y + from.h / 2;
      const endX = box
        ? kind === "spouse"
          ? box.x - box.w / 2
          : box.x
        : target.x;
      const endY = box
        ? kind === "spouse"
          ? box.y
          : box.y - box.h / 2
        : target.y;
      preview.setAttribute(
        "d",
        roundedPath(
          [
            { x: startX, y: startY },
            kind === "spouse"
              ? { x: (startX + endX) / 2, y: startY }
              : { x: startX, y: (startY + endY) / 2 },
            kind === "spouse"
              ? { x: (startX + endX) / 2, y: endY }
              : { x: endX, y: (startY + endY) / 2 },
            { x: endX, y: endY },
          ],
          10,
        ),
      );
      this.nodeLayer.classList.toggle("linking", !box);
    };
    this.capture(move, (upEvent) => {
      this.interaction = null;
      this.nodeLayer.classList.remove("linking");
      const box = this.boxAt(upEvent.clientX, upEvent.clientY);
      if (box) this.completeLink(fromId, box.id, kind);
      else this.render();
    });
  }

  completeLink(fromId, toId, kind) {
    if (fromId === toId) {
      this.render();
      return;
    }
    if (kind === "spouse") {
      const existing = this.store.edgeBetween(fromId, toId, EDGE_SPOUSE);
      if (existing) {
        new Notice(t("这两人已经是配偶关系了"));
        this.render();
        return;
      }
      this.store.addEdge(fromId, toId, EDGE_SPOUSE);
      this.placeNew(toId);
      new Notice(t("已建立配偶关系"));
      this.render();
      return;
    }
    const from = this.layout?.boxes.find((item) => item.id === fromId);
    const to = this.layout?.boxes.find((item) => item.id === toId);
    const reversed = from && to ? to.y < from.y - 24 : false;
    const parentId = reversed ? toId : fromId;
    const childId = reversed ? fromId : toId;
    const existing = this.store.edgeBetween(parentId, childId, EDGE_PARENT);
    if (existing) {
      new Notice(t("这条亲子关系已经存在"));
      this.render();
      return;
    }
    if (this.store.parentsOf(childId).length >= 2) {
      new Notice(t("这个人的父母已经两位了，先删掉一条再加"));
      this.render();
      return;
    }
    const edge = this.store.addEdge(parentId, childId, EDGE_PARENT);
    if (!edge) new Notice(t("不能建立这条关系（会绕成环）"));
    else new Notice(t("已建立亲子关系"));
    this.render();
  }

  capture(move, end) {
    const moveHandler = (event) => {
      if (event.buttons === 0 && event.type === "pointermove") {
        finish(event);
        return;
      }
      move(event);
    };
    const finish = (event) => {
      window.removeEventListener("pointermove", moveHandler);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      end?.(event);
    };
    window.addEventListener("pointermove", moveHandler);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  onWheel(event) {
    event.preventDefault();
    const rect = this.svg.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = clamp(this.viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const ratio = next / this.viewport.zoom;
    this.viewport.tx = mx - (mx - this.viewport.tx) * ratio;
    this.viewport.ty = my - (my - this.viewport.ty) * ratio;
    this.viewport.zoom = next;
    this.applyTransform();
  }

  onDoubleClick(event) {
    const nodeEl = event.target.closest?.("[data-id]");
    if (!nodeEl) return;
    // 双击只干一件事：打开挂着的笔记。没挂笔记就什么都不做，
    // 免得手快点两下就把编辑弹窗弹出来。
    const node = this.store.getNode(nodeEl.getAttribute("data-id"));
    if (!node || !node.note) return;
    event.preventDefault();
    event.stopPropagation();
    if (!openNote(this.app, node.note))
      new Notice(t("笔记找不到了，可以右键重新指定"));
  }

  onContextMenu(event) {
    event.preventDefault();
    const edgeEl = event.target.closest?.("[data-edge]");
    if (edgeEl) {
      this.edgeMenu(event, edgeEl.getAttribute("data-edge"));
      return;
    }
    const lineEl = event.target.closest?.("[data-family]");
    if (lineEl) {
      this.familyMenu(
        event,
        lineEl.getAttribute("data-family"),
        lineEl.getAttribute("data-child"),
      );
      return;
    }
    const nodeEl = event.target.closest?.("[data-id]");
    if (nodeEl) {
      this.nodeMenu(event, nodeEl.getAttribute("data-id"));
      return;
    }
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("添加人物"))
        .setIcon("user-plus")
        .onClick(() => this.addStandalone()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("从人物库添加…"))
        .setIcon("users")
        .onClick(() => this.openPeoplePicker()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("批量移除卡片…"))
        .setIcon("user-minus")
        .onClick(() => this.openRemovePeople()),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("紧缩空间并居中"))
        .setIcon("minimize-2")
        .onClick(() => this.compactNow()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("亲戚计算器…"))
        .setIcon("calculator")
        .onClick(() => this.openKinship()),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("主题…"))
        .setIcon("palette")
        .onClick(() => this.plugin.openTheme?.()),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("切换布局…"))
        .setIcon("layers")
        .onClick(() => this.layoutMenu(null)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("适应窗口"))
        .setIcon("maximize")
        .onClick(() => this.fit()),
    );
    menu.showAtMouseEvent(event);
  }

  /** 右键配偶/其他连线 */
  edgeMenu(event, edgeId) {
    const edge = this.store.graph.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    const isSpouse = edge.type === EDGE_SPOUSE;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(
          t(isSpouse ? "删除配偶连线（{a} — {b}）" : "删除关联连线（{a} — {b}）", {
            a: this.nameOf(edge.from),
            b: this.nameOf(edge.to),
          }),
        )
        .setIcon("unlink")
        .onClick(() => {
          this.store.removeEdge(edge.id);
          new Notice(t("连线已删除，人还在图上"));
        }),
    );
    menu.showAtMouseEvent(event);
  }

  /** 右键亲子连线：断一个人，或断这一家 */
  familyMenu(event, family, childId) {
    const path = this.layout?.parentPaths.find(
      (item) => item.family === family,
    );
    if (!path) return;
    const parentIds = path.parentIds;
    const menu = new Menu();
    if (childId) {
      menu.addItem((item) =>
        item
          .setTitle(
            t("断开「{name}」与父母的连线", { name: this.nameOf(childId) }),
          )
          .setIcon("unlink")
          .onClick(() => this.detachFromParents(childId, parentIds)),
      );
      menu.addSeparator();
    }
    const others = path.drops.filter((drop) => drop.child !== childId);
    if (!childId && others.length && others.length <= 8) {
      for (const drop of others)
        menu.addItem((item) =>
          item
            .setTitle(t("断开：{name}", { name: this.nameOf(drop.child) }))
            .setIcon("unlink")
            .onClick(() => this.detachFromParents(drop.child, parentIds)),
        );
      menu.addSeparator();
    }
    menu.addItem((item) =>
      item
        .setTitle(
          t("断开这一家的全部连线（{count} 条）", { count: path.drops.length }),
        )
        .setIcon("x")
        .onClick(() => {
          for (const drop of path.drops)
            this.detachFromParents(drop.child, parentIds);
          new Notice(t("这一家的亲子连线已全部断开"));
        }),
    );
    menu.showAtMouseEvent(event);
  }

  detachFromParents(childId, parentIds) {
    const parents = this.store
      .parentsOf(childId)
      .filter((id) => (parentIds ? parentIds.includes(id) : true));
    for (const parentId of parents) {
      const edge = this.store.edgeBetween(parentId, childId, EDGE_PARENT);
      if (edge) this.store.removeEdge(edge.id);
    }
    new Notice(
      t("已断开「{name}」与父母的连线", { name: this.nameOf(childId) }),
    );
  }

  nodeMenu(event, id) {
    const node = this.store.getNode(id);
    if (!node) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(t("编辑资料…"))
        .setIcon("pencil")
        .onClick(() => this.openEditor(node)),
    );

    const noteFile = this.noteFileOf(node);
    if (node.note && noteFile) {
      menu.addItem((item) =>
        item
          .setTitle(t("打开笔记"))
          .setIcon("file-text")
          .onClick(() => {
            if (!openNote(this.app, node.note))
              new Notice(t("笔记找不到了，可以重新指定"));
          }),
      );
      menu.addItem((item) =>
        item
          .setTitle(t("更换关联笔记…"))
          .setIcon("replace")
          .onClick(() => this.linkNote(node)),
      );
      menu.addItem((item) =>
        item
          .setTitle(t("移除关联笔记"))
          .setIcon("file-minus")
          .onClick(() => {
            this.store.updateNode(node.id, { note: "" });
            new Notice(
              t("已移除「{name}」的笔记链接，卡片还在图上", { name: node.name }),
            );
          }),
      );
    } else if (node.note) {
      // 链接指向的笔记已经不在了：别再假装打开得开
      menu.addItem((item) =>
        item
          .setTitle(t("笔记链接已失效，清除链接"))
          .setIcon("unlink")
          .onClick(() => {
            this.store.updateNode(node.id, { note: "" });
            new Notice(t("「{name}」的失效链接已清除", { name: node.name }));
          }),
      );
      menu.addItem((item) =>
        item
          .setTitle(t("改接到别的笔记…"))
          .setIcon("replace")
          .onClick(() => this.linkNote(node)),
      );
    } else {
      menu.addItem((item) =>
        item
          .setTitle(t("关联笔记…"))
          .setIcon("file-plus")
          .onClick(() => this.linkNote(node)),
      );
    }

    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("亲戚计算器（以 TA 为参照）…"))
        .setIcon("calculator")
        .onClick(() => this.openKinship(node.id)),
    );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("添加子女"))
        .setIcon("user-plus")
        .onClick(() => this.addChild(node)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("添加父亲"))
        .setIcon("user-plus")
        .onClick(() => this.addParent(node, "male")),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("添加母亲"))
        .setIcon("user-plus")
        .onClick(() => this.addParent(node, "female")),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("添加配偶"))
        .setIcon("heart")
        .onClick(() => this.addSpouse(node)),
    );
    menu.addItem((item) =>
      item
        .setTitle(t("添加兄弟姐妹"))
        .setIcon("users")
        .onClick(() => this.addSibling(node)),
    );
    menu.addSeparator();
    const parents = this.store.parentsOf(id);
    const spouses = this.store.spousesOf(id);
    if (spouses.length)
      for (const spouseId of spouses)
        menu.addItem((item) =>
          item
            .setTitle(
              t("与「{name}」互换左右", { name: this.nameOf(spouseId) }),
            )
            .setIcon("arrow-left-right")
            .onClick(() => this.swapWithSpouse(id, spouseId)),
        );
    if (parents.length)
      menu.addItem((item) =>
        item
          .setTitle(t("断开与父母的连线"))
          .setIcon("unlink")
          .onClick(() => this.detachFromParents(id, parents)),
      );
    if (spouses.length)
      menu.addItem((item) =>
        item
          .setTitle(t("断开配偶连线"))
          .setIcon("unlink")
          .onClick(() => {
            for (const spouseId of spouses) {
              const edge = this.store.edgeBetween(id, spouseId, EDGE_SPOUSE);
              if (edge) this.store.removeEdge(edge.id);
            }
            new Notice(t("已断开配偶连线（人还在图上）"));
          }),
      );
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(t("删除此人"))
        .setIcon("trash")
        .onClick(() => this.confirmDelete(node)),
    );
    menu.showAtMouseEvent(event);
  }

  // ---------- 操作 ----------

  /**
   * 两口子左右对调。
   *
   * 卡片是「男左女右」排出来的，入赘、招婿这类情况需要反过来。
   * 只交换这两人自己的横坐标（连同排号），顺手把这对的整体中点留住，
   * 这样父母还是居中的，别人一个都不动。
   */
  swapWithSpouse(idA, idB) {
    const a = this.store.getNode(idA);
    const b = this.store.getNode(idB);
    const boxA = this.layout?.boxes.find((box) => box.id === idA);
    const boxB = this.layout?.boxes.find((box) => box.id === idB);
    if (!a || !b || !boxA || !boxB) return;

    if (boxA.row !== boxB.row) {
      a.row = boxB.row;
      a.y = rowY(boxB.row);
      b.row = boxA.row;
      b.y = rowY(boxA.row);
    } else {
      a.row = boxA.row;
      b.row = boxB.row;
    }

    const left = Math.min(boxA.x - boxA.w / 2, boxB.x - boxB.w / 2);
    const right = Math.max(boxA.x + boxA.w / 2, boxB.x + boxB.w / 2);
    const center = (left + right) / 2;
    const spanGap =
      Math.abs(boxB.x - boxA.x) - (boxA.w + boxB.w) / 2;

    if (spanGap > 48) {
      // 两人中间隔着别人：只交换各自的站位，别把他们硬拉近
      const ax = boxA.x;
      a.x = boxB.x;
      b.x = ax;
    } else {
      // 正常贴在一起：换完仍然贴在一起，整对的中间点不动
      const gap = Math.max(16, spanGap);
      const oldIsLeft = boxA.x <= boxB.x;
      const leftBox = oldIsLeft ? boxB : boxA; // 换位后站左边的那位
      const rightBox = oldIsLeft ? boxA : boxB;
      const totalW = leftBox.w + gap + rightBox.w;
      const startX = center - totalW / 2;

      leftBox.node.x = startX + leftBox.w / 2;
      rightBox.node.x = startX + leftBox.w + gap + rightBox.w / 2;
    }

    this.store.queueSave();
    this.store.emit();
    new Notice(t("「{a}」和「{b}」已左右对调", { a: a.name, b: b.name }));
  }

  linkNote(node) {
    pickNote(this.app, (file) => {
      this.store.updateNode(node.id, { note: file.path });
      new Notice(
        t("已关联「{name}」，双击卡片即可打开", { name: file.basename }),
      );
    });
  }

  openEditor(node) {
    new NodeModal(this.app, {
      node,
      onSubmit: (draft) => {
        this.store.updateNode(node.id, draft);
      },
      onDelete: (target) => this.confirmDelete(target),
    }).open();
  }

  confirmDelete(node) {
    const others = this.store.layoutCountOf(node.id) - 1;
    const children = this.store.childrenOf(node.id).length;
    const extra =
      others > 0
        ? t(
            "这个人还出现在另外 {count} 张布局里：这次只从当前布局移除，人物资料、笔记链接和其他布局都不动。",
            { count: others },
          )
        : children
          ? t(
              "TA 下面还有 {count} 个子女，连线也会一起删掉，子女不会被删除。",
              { count: children },
            )
          : t("与 TA 相连的线会一起删掉。");
    new ConfirmModal(this.app, {
      confirmText:
        others > 0
          ? t("从这张图移除")
          : t("删除「{name}」", { name: node.name }),
      message: extra,
      onConfirm: () => {
        this.store.removeNode(node.id);
        if (this.selected === node.id) this.selected = null;
      },
    }).open();
  }

  /** 新建的人立刻定排定位置，之后就可以自己拖 */
  placeNew(id) {
    const patch = placeNewNode(this.store, id);
    if (patch) this.store.updateNode(id, patch);
  }

  addStandalone() {
    new NodeModal(this.app, {
      title: t("添加人物"),
      onSubmit: (draft) => {
        const center = this.canvasCenterInGraph();
        const row = Math.round((center.y - PAD) / ROW_H);
        const created = this.store.addNode(draft);
        created.row = row;
        created.y = rowY(row);
        created.x = freeX(this.store, created, center.x);
        this.store.updateNode(created.id, { row, y: created.y, x: created.x });
        this.selected = created.id;
        this.render();
      },
    }).open();
  }

  canvasCenterInGraph() {
    const rect = this.svg.getBoundingClientRect();
    return this.toGraph(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /**
   * 新人该连哪些家长。
   *
   * 「在配偶卡片上添加子女」就是这对夫妻的子女，所以对方（人在当前图上时）
   * 也要连一条。少连一边的话，图上会被夫妻合线掩盖住，导出成单亲才看得出来。
   */
  parentsForNewChild(node) {
    const onCanvas = new Set(this.store.nodes.map((item) => item.id));
    const partners = this.store
      .spousesOf(node.id)
      .filter((id) => onCanvas.has(id));
    return [node.id, ...partners].slice(0, 2);
  }

  /** 本人的父母；只连了一方时，把这位家长的配偶一并补上——兄弟姐妹同父母 */
  parentsForSibling(node) {
    const parents = this.store.parentsOf(node.id);
    if (parents.length !== 1) return parents;
    const onCanvas = new Set(this.store.nodes.map((item) => item.id));
    const partners = this.store
      .spousesOf(parents[0])
      .filter((id) => onCanvas.has(id));
    return partners.length === 1 ? [parents[0], partners[0]] : parents;
  }

  addChild(node) {
    new NodeModal(this.app, {
      title: t("给「{name}」添加子女", { name: node.name }),
      onSubmit: (draft) => {
        const created = this.store.addNode(draft);
        for (const parentId of this.parentsForNewChild(node))
          this.store.addEdge(parentId, created.id, EDGE_PARENT);
        this.store.ensureCoupleLinks();
        this.placeNew(created.id);
        this.selected = created.id;
        this.render();
      },
    }).open();
  }

  addParent(node, sex) {
    new NodeModal(this.app, {
      title: t(sex === "male" ? "添加父亲：{name}" : "添加母亲：{name}", {
        name: node.name,
      }),
      onSubmit: (draft) => {
        const created = this.store.addNode({
          ...draft,
          sex: draft.sex === "unknown" ? sex : draft.sex,
        });
        this.store.addEdge(created.id, node.id, EDGE_PARENT);
        const other = this.store
          .parentsOf(node.id)
          .find((id) => id !== created.id);
        if (other) {
          const otherNode = this.store.getNode(other);
          if (otherNode && !this.store.spousesOf(created.id).length)
            this.store.addEdge(created.id, other, EDGE_SPOUSE);
        }
        this.placeNew(created.id);
        this.selected = created.id;
        this.render();
      },
    }).open();
  }

  addSpouse(node) {
    new NodeModal(this.app, {
      title: t("给「{name}」添加配偶", { name: node.name }),
      onSubmit: (draft) => {
        const created = this.store.addNode(draft);
        this.store.addEdge(created.id, node.id, EDGE_SPOUSE);
        this.placeNew(created.id);
        this.selected = created.id;
        this.render();
      },
    }).open();
  }

  addSibling(node) {
    const parents = this.parentsForSibling(node);
    new NodeModal(this.app, {
      title: t("给「{name}」添加兄弟姐妹", { name: node.name }),
      onSubmit: (draft) => {
        const created = this.store.addNode(draft);
        if (parents.length) {
          for (const parentId of parents)
            this.store.addEdge(parentId, created.id, EDGE_PARENT);
          this.store.ensureCoupleLinks();
        } else {
          new Notice(t("TA 还没填父母，新人是独立节点，请自行连线"));
        }
        this.placeNew(created.id);
        this.selected = created.id;
        this.render();
      },
    }).open();
  }

  toggleSnap() {
    this.plugin.settings.snap = this.plugin.settings.snap === false;
    void this.plugin.saveSettings();
    this.snapToggle?.classList.toggle(
      "is-on",
      this.plugin.settings.snap !== false,
    );
    new Notice(
      this.plugin.settings.snap === false ? t("吸附已关闭") : t("吸附已开启"),
    );
  }

  toggleDates() {
    this.plugin.settings.showDates = !this.plugin.settings.showDates;
    void this.plugin.saveSettings();
    this.datesToggle?.classList.toggle("is-on", this.plugin.settings.showDates);
    this.render();
  }

  zoomBy(factor) {
    const rect = this.svg.getBoundingClientRect();
    const mx = rect.width / 2;
    const my = rect.height / 2;
    const next = clamp(this.viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const ratio = next / this.viewport.zoom;
    this.viewport.tx = mx - (mx - this.viewport.tx) * ratio;
    this.viewport.ty = my - (my - this.viewport.ty) * ratio;
    this.viewport.zoom = next;
    this.applyTransform();
  }

  fit() {
    if (!this.layout || !this.svg) return;
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const boxes = this.layout.boxes;
    if (!boxes.length) {
      this.viewport = { zoom: 1, tx: rect.width / 2, ty: rect.height / 2 };
      this.applyTransform();
      return;
    }
    const minX = Math.min(...boxes.map((box) => box.x - box.w / 2));
    const maxX = Math.max(...boxes.map((box) => box.x + box.w / 2));
    const minY = Math.min(...boxes.map((box) => box.y - box.h / 2));
    const maxY = Math.max(...boxes.map((box) => box.y + box.h / 2));
    const padding = 80;
    const zoom = clamp(
      Math.min(
        (rect.width - padding * 2) / Math.max(1, maxX - minX),
        (rect.height - padding * 2) / Math.max(1, maxY - minY),
      ),
      MIN_ZOOM,
      1.35,
    );
    this.viewport.zoom = zoom;
    this.viewport.tx = rect.width / 2 - ((minX + maxX) / 2) * zoom;
    this.viewport.ty = rect.height / 2 - ((minY + maxY) / 2) * zoom;
    this.applyTransform();
  }

  keepInView() {
    if (!this.layout) return;
    this.applyTransform();
  }
}
