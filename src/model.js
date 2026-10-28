/**
 * 家谱图 · 数据层（v4：人物库 + 多布局）
 *
 * 为什么要拆成两层：
 *   - 人是**同一个人**，不该因为出现在两张图里就变成两份资料。
 *     所以姓名、性别、生卒、笔记链接、备注都存在「人物库」people 里，全局唯一。
 *   - 位置和关系是**这张图**的事：同一个人在「父系」和「母系」两张图里可以站不同排、
 *     跟不同的人连线。所以它们存在布局 layouts[i] 里。
 *
 * 文件结构（graph.json）：
 *   {
 *     version: 4,
 *     active:  "<当前布局 id>",
 *     people:  [{ id, name, sex, birth, death, note, remark }],
 *     layouts: [{ id, name, remark, nodes: [{ pid, x, row, y }], edges: [{ id, from, to, type, label }] }]
 *   }
 *
 * GraphStore 对外仍然像「一张图」：store.nodes / getNode / parentsOf / childrenOf ...
 * 内部把人物字段与布局位置拼成一个带 getter/setter 的视图对象，
 * 改 name 落到 people，改 x 落到 layouts[i].nodes，所以老的调用代码不用改。
 */
import { TFile } from "obsidian";
import { ensurePositions, packRows } from "./layout.js";

/** 4 = 人物库 + 多布局；3 及以前是「一张图」 */
export const GRAPH_VERSION = 4;
export const EDGE_PARENT = "parent";
export const EDGE_SPOUSE = "spouse";
export const EDGE_OTHER = "other";

/** 存在人物库里的字段：跨布局共享 */
const SHARED = ["name", "sex", "birth", "death", "note", "remark"];
/** 存在布局里的字段：每张图各一份 */
const LOCAL = ["x", "row", "y"];

let seq = 0;
export function makeId(prefix) {
  seq += 1;
  return prefix + Date.now().toString(36).slice(-5) + seq.toString(36);
}

/** 有去世日期就算已故 */
export function isDeceased(node) {
  return Boolean(String(node?.death ?? "").trim());
}

export function newLayout(name = "家族图") {
  return {
    id: makeId("l"),
    name: String(name || "家族图"),
    remark: "",
    nodes: [],
    edges: [],
  };
}

export function emptyGraph() {
  const layout = newLayout("家族图");
  return {
    version: GRAPH_VERSION,
    active: layout.id,
    people: [],
    layouts: [layout],
  };
}

function normalizeSex(value) {
  return ["male", "female"].includes(value) ? value : "unknown";
}

function numberOrNull(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function edgeKey(type, from, to) {
  return type === EDGE_SPOUSE
    ? "s:" + [from, to].sort().join("|")
    : type + ":" + from + ">" + to;
}

/**
 * 任何形状的旧数据都吃进来：
 *   v4（people + layouts）原样规整
 *   v3/v2（nodes + edges，一张图）迁移成「一个人物库 + 一张布局」
 */
export function normalizeGraph(raw) {
  const graph = { version: GRAPH_VERSION, active: "", people: [], layouts: [] };
  if (!raw || typeof raw !== "object") return withDefaultLayout(graph);

  const people = [];
  const seenPeople = new Set();
  const addPerson = (data) => {
    if (!data || typeof data !== "object") return null;
    const id = String(data.id ?? "");
    if (!id || seenPeople.has(id)) return null;
    seenPeople.add(id);
    const person = {
      id,
      name: String(data.name ?? "未命名"),
      sex: normalizeSex(data.sex),
      birth: String(data.birth ?? ""),
      death: String(data.death ?? ""),
      note: typeof data.note === "string" ? data.note : "",
      remark: String(data.remark ?? ""),
    };
    people.push(person);
    return person;
  };

  // ---- 人物库 ----
  if (Array.isArray(raw.people)) {
    for (const item of raw.people) addPerson(item);
  } else if (Array.isArray(raw.nodes)) {
    // 老格式：节点自己就带着人物字段
    for (const item of raw.nodes) addPerson(item);
  }
  graph.people = people;

  // ---- 布局 ----
  const cleanLayout = (source, fallbackName) => {
    const layout = {
      id: String(source?.id ?? "") || makeId("l"),
      name: String(source?.name ?? "").trim() || fallbackName,
      remark: String(source?.remark ?? ""),
      nodes: [],
      edges: [],
    };
    const seenNodes = new Set();
    const rawNodes = Array.isArray(source?.nodes) ? source.nodes : [];
    for (const item of rawNodes) {
      const pid = String(item?.pid ?? item?.id ?? "");
      if (!seenPeople.has(pid) || seenNodes.has(pid)) continue;
      seenNodes.add(pid);
      layout.nodes.push({
        pid,
        x: numberOrNull(item?.x),
        y: numberOrNull(item?.y),
        row: numberOrNull(item?.row),
      });
    }
    const seenEdges = new Set();
    const rawEdges = Array.isArray(source?.edges) ? source.edges : [];
    for (const item of rawEdges) {
      const from = String(item?.from ?? "");
      const to = String(item?.to ?? "");
      if (from === to) continue;
      if (!seenNodes.has(from) || !seenNodes.has(to)) continue;
      const type = [EDGE_PARENT, EDGE_SPOUSE, EDGE_OTHER].includes(item?.type)
        ? item.type
        : EDGE_PARENT;
      const key = edgeKey(type, from, to);
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      layout.edges.push({
        id: String(item?.id ?? "") || makeId("e"),
        from,
        to,
        type,
        label: String(item?.label ?? ""),
      });
    }
    return layout;
  };

  if (Array.isArray(raw.layouts) && raw.layouts.length) {
    for (const item of raw.layouts)
      graph.layouts.push(
        cleanLayout(item, `家族图 ${graph.layouts.length + 1}`),
      );
  } else if (Array.isArray(raw.nodes) && raw.nodes.length) {
    // 老格式：整张图就是一个布局
    graph.layouts.push(
      cleanLayout(
        { name: "家族图", nodes: raw.nodes, edges: raw.edges },
        "家族图",
      ),
    );
  }

  graph.active = String(raw.active ?? "");
  return withDefaultLayout(graph);
}

function withDefaultLayout(graph) {
  if (!graph.layouts.length) graph.layouts.push(newLayout("家族图"));
  if (!graph.layouts.some((layout) => layout.id === graph.active))
    graph.active = graph.layouts[0].id;
  graph.version = GRAPH_VERSION;
  return graph;
}

/** 人物字段 + 布局位置的合体视图：读谁写谁，两边都是真身 */
function makeNodeView(person, entry) {
  const view = { id: person.id };
  for (const field of SHARED) {
    Object.defineProperty(view, field, {
      enumerable: true,
      configurable: true,
      get: () => person[field],
      set: (value) => {
        person[field] =
          field === "sex" ? normalizeSex(value) : String(value ?? "");
      },
    });
  }
  for (const field of LOCAL) {
    Object.defineProperty(view, field, {
      enumerable: true,
      configurable: true,
      get: () => numberOrNull(entry[field]),
      set: (value) => {
        entry[field] = numberOrNull(value);
      },
    });
  }
  return view;
}

function linkName(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^\[\[([^\]|#]+)/);
  return (match ? match[1] : text).trim();
}

export class GraphStore {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this._data = emptyGraph();
    this._facade = { nodes: [], edges: [], order: { sibling: {}, spouse: {} } };
    this._views = new Map();
    this._people = new Map();
    this._index = null;
    this.dirty = false;
    this.saveTimer = null;
    this.listeners = new Set();
    this.rebuild();
  }

  // ---------- 布局 ----------

  get layouts() {
    return this._data.layouts;
  }

  get activeId() {
    return this._data.active;
  }

  get activeLayout() {
    let found = this._data.layouts.find(
      (item) => item.id === this._data.active,
    );
    if (!found) {
      if (!this._data.layouts.length)
        this._data.layouts.push(newLayout("家族图"));
      found = this._data.layouts[0];
      this._data.active = found.id;
    }
    return found;
  }

  getLayout(id) {
    return this._data.layouts.find((item) => item.id === id) ?? null;
  }

  activateLayout(id) {
    if (!this.getLayout(id) || this._data.active === id) return false;
    this._data.active = id;
    this.rebuild();
    this.emit();
    this.queueSave();
    return true;
  }

  createLayout(name, people = []) {
    const layout = newLayout(name || `家族图 ${this._data.layouts.length + 1}`);
    for (const pid of people)
      if (this._people.has(pid))
        layout.nodes.push({ pid, x: null, y: null, row: null });
    this._data.layouts.push(layout);
    this._data.active = layout.id;
    this.rebuild();
    this.emit();
    this.queueSave();
    return layout;
  }

  renameLayout(id, name) {
    const layout = this.getLayout(id);
    if (!layout) return false;
    const next = String(name ?? "").trim();
    if (!next || next === layout.name) return false;
    layout.name = next;
    this.emit();
    this.queueSave();
    return true;
  }

  setLayoutRemark(id, remark) {
    const layout = this.getLayout(id);
    if (!layout) return false;
    layout.remark = String(remark ?? "");
    this.emit();
    this.queueSave();
    return true;
  }

  duplicateLayout(id) {
    const source = this.getLayout(id);
    if (!source) return null;
    const copy = {
      id: makeId("l"),
      name: source.name + " 副本",
      remark: source.remark,
      nodes: source.nodes.map((node) => ({ ...node })),
      edges: source.edges.map((edge) => ({ ...edge, id: makeId("e") })),
    };
    const index = this._data.layouts.findIndex((item) => item.id === id);
    this._data.layouts.splice(index + 1, 0, copy);
    this.emit();
    this.queueSave();
    return copy;
  }

  moveLayout(id, delta) {
    const index = this._data.layouts.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const target = index + delta;
    if (target < 0 || target >= this._data.layouts.length) return false;
    const [item] = this._data.layouts.splice(index, 1);
    this._data.layouts.splice(target, 0, item);
    this.emit();
    this.queueSave();
    return true;
  }

  sortLayoutsByName() {
    this._data.layouts.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    this.emit();
    this.queueSave();
  }

  removeLayout(id) {
    if (this._data.layouts.length <= 1) return false;
    const index = this._data.layouts.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this._data.layouts.splice(index, 1);
    if (this._data.active === id)
      this._data.active = this._data.layouts[Math.max(0, index - 1)].id;
    this.collectPeople();
    this.rebuild();
    this.emit();
    this.queueSave();
    return true;
  }

  /** 没有任何布局用到的人物，从人物库里清掉（笔记不受影响） */
  collectPeople() {
    const used = new Set();
    for (const layout of this._data.layouts)
      for (const node of layout.nodes) used.add(node.pid);
    const before = this._data.people.length;
    this._data.people = this._data.people.filter((person) =>
      used.has(person.id),
    );
    return before - this._data.people.length;
  }

  // ---------- 人物库 ----------

  get people() {
    return this._data.people;
  }

  personById(id) {
    return (
      this._people.get(id) ??
      this._data.people.find((item) => item.id === id) ??
      null
    );
  }

  layoutCountOf(pid) {
    return this._data.layouts.filter((layout) =>
      layout.nodes.some((node) => node.pid === pid),
    ).length;
  }

  /** 人物库里还没进这张图的人 */
  peopleNotInLayout() {
    const here = new Set(this.activeLayout.nodes.map((node) => node.pid));
    return this._data.people.filter((person) => !here.has(person.id));
  }

  /** 把人物库里的人加进当前布局（不带关系，位置由调用方定） */
  addPeopleToLayout(pids) {
    const layout = this.activeLayout;
    const here = new Set(layout.nodes.map((node) => node.pid));
    const added = [];
    for (const pid of pids) {
      if (here.has(pid) || !this._people.has(pid)) continue;
      here.add(pid);
      layout.nodes.push({ pid, x: null, y: null, row: null });
      added.push(pid);
    }
    if (!added.length) return [];
    this.rebuild();
    this.emit();
    this.queueSave();
    return added;
  }

  // ---------- 读写 ----------

  get filePath() {
    const dir = this.plugin.manifest?.dir;
    return dir ? dir + "/graph.json" : null;
  }

  /** 对外的「当前这张图」：nodes 是合体视图，edges 就是布局自己的数组 */
  get graph() {
    return this._facade;
  }

  set graph(value) {
    this._data = normalizeGraph(value);
    this.rebuild();
  }

  rebuild() {
    this._index = null;
    const layout = this.activeLayout;
    this._people = new Map(
      this._data.people.map((person) => [person.id, person]),
    );
    const nodes = [];
    const views = new Map();
    for (const entry of layout.nodes) {
      const person = this._people.get(entry.pid);
      if (!person) continue;
      const view = makeNodeView(person, entry);
      nodes.push(view);
      views.set(person.id, view);
    }
    this._views = views;
    this._facade = {
      nodes,
      edges: layout.edges,
      order: { sibling: {}, spouse: {} },
    };
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this._index = null;
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch (error) {
        console.error("[Family Tree] 监听器出错", error);
      }
    }
  }

  async load() {
    const path = this.filePath;
    if (!path) return this.graph;
    const adapter = this.app.vault.adapter;
    let rawVersion = GRAPH_VERSION;
    try {
      if (await adapter.exists(path)) {
        const text = await adapter.read(path);
        const raw = JSON.parse(text);
        rawVersion = Number(raw?.version ?? 0);
        this._data = normalizeGraph(raw);
        this.rebuild();
      }
    } catch (error) {
      console.error("[Family Tree] 读取数据失败，已用空图代替", error);
      this._data = emptyGraph();
      this.rebuild();
    }
    // 2/3 及以前是自动排版算出来的坐标，一次性转成「行 + 横向位置」并压紧，
    // 之后完全交给人自己拖
    if (rawVersion < GRAPH_VERSION && this.nodes.length) {
      ensurePositions(this);
      packRows(this);
      await this.save();
    }
    this.emit();
    return this.graph;
  }

  /** 深拷贝当前全部数据（备份用）：拿到的是纯 JSON，改它不影响内存里的真身 */
  snapshot() {
    return JSON.parse(JSON.stringify(this._data));
  }

  async save() {
    this.dirty = false;
    const path = this.filePath;
    if (!path) return;
    try {
      await this.app.vault.adapter.write(
        path,
        JSON.stringify(this._data, null, 2),
      );
    } catch (error) {
      console.error("[Family Tree] 保存失败", error);
      this.dirty = true;
    }
  }

  queueSave() {
    this.dirty = true;
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 250);
  }

  async flush() {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.dirty) await this.save();
  }

  replaceGraph(graph) {
    this._data = normalizeGraph(graph);
    this.rebuild();
    this.emit();
    this.queueSave();
  }

  /** 把一张图并成一个新布局，不动已有的 */
  addGraphAsLayout(graph, name) {
    const incoming = normalizeGraph(graph);
    const people = incoming.people;
    const source = incoming.layouts[0];
    const byId = new Map();
    for (const person of people) {
      const existing = this._data.people.find(
        (item) => item.name === person.name && item.birth === person.birth,
      );
      if (existing) {
        if (!existing.note && person.note) existing.note = person.note;
        byId.set(person.id, existing.id);
      } else {
        this._data.people.push({ ...person });
        byId.set(person.id, person.id);
      }
    }
    const layout = newLayout(name || "导入的家族图");
    for (const node of source?.nodes ?? []) {
      const pid = byId.get(node.pid);
      if (pid) layout.nodes.push({ pid, x: node.x, y: node.y, row: node.row });
    }
    for (const edge of source?.edges ?? []) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (from && to)
        layout.edges.push({
          id: makeId("e"),
          from,
          to,
          type: edge.type,
          label: edge.label,
        });
    }
    this._data.layouts.push(layout);
    this._data.active = layout.id;
    this.rebuild();
    this.emit();
    this.queueSave();
    return layout;
  }

  // ---------- 索引 ----------

  index() {
    if (this._index) return this._index;
    const byId = new Map();
    const parentOf = new Map();
    const childOf = new Map();
    const spouseOf = new Map();
    const otherOf = new Map();
    const push = (map, key, value) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    for (const node of this._facade.nodes) byId.set(node.id, node);
    for (const edge of this.activeLayout.edges) {
      if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
      if (edge.type === EDGE_PARENT) {
        push(parentOf, edge.to, edge.from);
        push(childOf, edge.from, edge.to);
      } else if (edge.type === EDGE_SPOUSE) {
        push(spouseOf, edge.from, edge.to);
        push(spouseOf, edge.to, edge.from);
      } else {
        push(otherOf, edge.from, edge.to);
        push(otherOf, edge.to, edge.from);
      }
    }
    this._index = { byId, parentOf, childOf, spouseOf, otherOf };
    return this._index;
  }

  get nodes() {
    return this._facade.nodes;
  }

  getNode(id) {
    return this._views.get(id) ?? null;
  }

  parentsOf(id) {
    return this.index().parentOf.get(id) ?? [];
  }

  childrenOf(id) {
    return this.index().childOf.get(id) ?? [];
  }

  spousesOf(id) {
    return this.index().spouseOf.get(id) ?? [];
  }

  siblingsOf(id) {
    const parents = this.parentsOf(id);
    if (!parents.length) return [];
    const result = new Set();
    for (const parent of parents)
      for (const child of this.childrenOf(parent))
        if (child !== id) result.add(child);
    return [...result];
  }

  edgeBetween(from, to, type) {
    return (
      this.activeLayout.edges.find((edge) =>
        type
          ? edge.type === type &&
            ((edge.from === from && edge.to === to) ||
              (edge.type === EDGE_SPOUSE &&
                edge.from === to &&
                edge.to === from))
          : (edge.from === from && edge.to === to) ||
            (edge.from === to && edge.to === from),
      ) ?? null
    );
  }

  // ---------- 改动 ----------

  addNode(data = {}) {
    const person = {
      id: makeId("n"),
      name: String(data.name ?? "新人物"),
      sex: normalizeSex(data.sex),
      birth: String(data.birth ?? ""),
      death: String(data.death ?? ""),
      note: String(data.note ?? ""),
      remark: String(data.remark ?? ""),
    };
    this._data.people.push(person);
    this.activeLayout.nodes.push({
      pid: person.id,
      x: numberOrNull(data.x),
      y: numberOrNull(data.y),
      row: numberOrNull(data.row),
    });
    this.rebuild();
    this.emit();
    this.queueSave();
    return this.getNode(person.id);
  }

  updateNode(id, patch) {
    const node = this.getNode(id);
    if (!node) return null;
    Object.assign(node, patch);
    this.emit();
    this.queueSave();
    return node;
  }

  /** 只从这张图移除；如果别的布局还在用这个人，人物库里的资料和笔记都留着 */
  removeNode(id) {
    const layout = this.activeLayout;
    layout.nodes = layout.nodes.filter((node) => node.pid !== id);
    layout.edges = layout.edges.filter(
      (edge) => edge.from !== id && edge.to !== id,
    );
    if (this.layoutCountOf(id) === 0)
      this._data.people = this._data.people.filter(
        (person) => person.id !== id,
      );
    this.rebuild();
    this.emit();
    this.queueSave();
  }

  /**
   * 批量从当前布局移除（一次 rebuild，不会删一次重绘一次）。
   * 返回 { removed, forgotten }：forgotten 是「人物库里也没别人用了，资料被清掉」的人数。
   */
  removeNodes(ids) {
    const set = new Set((ids ?? []).map(String));
    if (!set.size) return { removed: 0, forgotten: 0 };
    const layout = this.activeLayout;
    const before = layout.nodes.length;
    layout.nodes = layout.nodes.filter((node) => !set.has(node.pid));
    layout.edges = layout.edges.filter(
      (edge) => !set.has(edge.from) && !set.has(edge.to),
    );
    const removed = before - layout.nodes.length;
    if (!removed) return { removed: 0, forgotten: 0 };
    const used = new Set();
    for (const item of this._data.layouts)
      for (const node of item.nodes) used.add(node.pid);
    const peopleBefore = this._data.people.length;
    this._data.people = this._data.people.filter((person) =>
      used.has(person.id),
    );
    const forgotten = peopleBefore - this._data.people.length;
    this.rebuild();
    this.emit();
    this.queueSave();
    return { removed, forgotten };
  }

  addEdge(from, to, type = EDGE_PARENT) {
    if (!from || !to || from === to) return null;
    if (!this.getNode(from) || !this.getNode(to)) return null;
    const existing = this.edgeBetween(from, to, type);
    if (existing) return existing;
    if (type === EDGE_PARENT) {
      const parents = this.parentsOf(to);
      if (parents.includes(from)) return null;
      if (parents.length >= 2) return null;
      if (this.wouldCycle(from, to)) return null;
    }
    const edge = { id: makeId("e"), from, to, type, label: "" };
    this.activeLayout.edges.push(edge);
    this.emit();
    this.queueSave();
    return edge;
  }

  wouldCycle(parent, child) {
    const seen = new Set();
    const stack = [parent];
    while (stack.length) {
      const current = stack.pop();
      if (current === child) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of this.parentsOf(current)) stack.push(next);
    }
    return false;
  }

  removeEdge(id) {
    const layout = this.activeLayout;
    layout.edges = layout.edges.filter((edge) => edge.id !== id);
    this.emit();
    this.queueSave();
  }

  compareByBirth(a, b) {
    const left = this.getNode(a);
    const right = this.getNode(b);
    if (!left || !right) return 0;
    const lb = left.birth || "9999";
    const rb = right.birth || "9999";
    if (lb !== rb) return lb < rb ? -1 : 1;
    return left.name.localeCompare(right.name, "zh");
  }

  // ---------- 节点上的笔记链接 ----------

  resolveNote(notePath) {
    if (!notePath) return null;
    const clean = linkName(notePath);
    const direct = this.app.metadataCache.getFirstLinkpathDest(clean, "");
    if (direct) return direct;
    const file = this.app.vault.getAbstractFileByPath(clean);
    return file instanceof TFile ? file : null;
  }

  /** 记录被重命名/移动的笔记，保持链接有效（人物库全局生效，所有布局一起改） */
  handleRename(file, oldPath) {
    let changed = false;
    for (const person of this._data.people) {
      if (!person.note) continue;
      if (linkName(person.note) === oldPath) {
        person.note = file.path;
        changed = true;
      }
    }
    if (changed) {
      this.emit();
      this.queueSave();
    }
  }
}

// ---------- 从笔记一次性导入 ----------

const FIELD_ALIASES = {
  name: ["姓名", "name", "名字"],
  sex: ["性别", "gender", "sex"],
  father: ["父亲", "父", "father", "爸爸"],
  mother: ["母亲", "母", "mother", "妈妈"],
  parents: ["父母", "parents", "双亲"],
  spouse: ["配偶", "spouse", "妻子", "丈夫", "妻", "夫", "爱人"],
  children: ["子女", "孩子", "children", "儿女"],
  birth: ["生日", "出生", "birth", "出生日期"],
  death: ["去世", "death", "逝世"],
};

function aliasOf(key) {
  const lower = key.toLowerCase().trim();
  for (const [field, list] of Object.entries(FIELD_ALIASES))
    if (list.some((item) => item.toLowerCase() === lower)) return field;
  return null;
}

function splitValues(raw) {
  if (raw == null) return [];
  const text = String(raw).trim();
  if (!text) return [];
  const out = [];
  // 先按分隔符切开，再逐段取链接；混着写（[[张三]], 李四）也不会漏
  for (const rawPart of text.split(/[,，、;；\n]/)) {
    const part = rawPart.trim();
    if (!part) continue;
    const links = [...part.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map(
      (match) => match[1].trim(),
    );
    if (links.length) {
      for (const link of links) if (link) out.push(link);
      continue;
    }
    const clean = part.replace(/^["'“”]|["'“”]$/g, "").trim();
    if (clean) out.push(clean);
  }
  return [...new Set(out)];
}

function parseNote(text) {
  const fields = {};
  const lines = text.split(/\r?\n/);
  let index = 0;

  if (lines[0]?.trim() === "---") {
    index = 1;
    let currentKey = null;
    for (; index < lines.length; index++) {
      const line = lines[index];
      if (line.trim() === "---") {
        index += 1;
        break;
      }
      const listItem = line.match(/^\s*-\s+(.*)$/);
      if (listItem && currentKey) {
        (fields[currentKey] ??= []).push(listItem[1].trim());
        continue;
      }
      const pair = line.match(/^([^:\s][^:]*):\s*(.*)$/);
      if (pair) {
        currentKey = pair[1].trim();
        const value = pair[2].trim();
        fields[currentKey] = value ? [value] : [];
      }
    }
  }

  for (; index < lines.length; index++) {
    const match = lines[index].match(/^\s*\*\*([^*]+)\*\*\s*[:：]\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!value) continue;
    fields[key] = [...(fields[key] ?? []), value];
  }

  const pick = (field) => {
    for (const [key, values] of Object.entries(fields))
      if (aliasOf(key) === field) return values;
    return [];
  };

  const nameField = pick("name");
  return {
    name: nameField.length ? splitValues(nameField[0])[0] : null,
    sex: splitValues(pick("sex")[0] ?? "")[0] ?? "",
    father: splitValues(pick("father").join(",")),
    mother: splitValues(pick("mother").join(",")),
    parents: splitValues(pick("parents").join(",")),
    spouse: splitValues(pick("spouse").join(",")),
    children: splitValues(pick("children").join(",")),
    birth: splitValues(pick("birth")[0] ?? "")[0] ?? "",
    death: splitValues(pick("death")[0] ?? "")[0] ?? "",
  };
}

function normalizeSexText(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["male", "m", "男", "男性", "1"].includes(text)) return "male";
  if (["female", "f", "女", "女性", "0"].includes(text)) return "female";
  return "";
}

/**
 * 扫描文件夹里的笔记，生成一张独立的图（v4 结构）。
 * 只在用户明确点「从笔记导入」时执行一次。
 */
export async function importFromNotes(app, folder) {
  const prefix = (folder ?? "").replace(/\/+$/, "");
  const files = app.vault
    .getMarkdownFiles()
    .filter((file) => !prefix || file.path.startsWith(prefix + "/"));

  const graph = emptyGraph();
  const layout = graph.layouts[0];
  const byName = new Map();

  const ensure = (rawName) => {
    const name = linkName(rawName);
    if (!name) return null;
    let person = byName.get(name);
    if (!person) {
      person = {
        id: makeId("n"),
        name,
        sex: "unknown",
        birth: "",
        death: "",
        note: "",
        remark: "",
      };
      byName.set(name, person);
      graph.people.push(person);
      layout.nodes.push({ pid: person.id, x: null, y: null, row: null });
    }
    return person;
  };

  const relationPairs = [];

  for (const file of files) {
    let text = "";
    try {
      text = await app.vault.cachedRead(file);
    } catch {
      continue;
    }
    const parsed = parseNote(text);
    const selfName = parsed.name || file.basename;
    const self = ensure(selfName);
    if (!self) continue;
    self.note = file.path;
    if (!self.birth && parsed.birth) self.birth = parsed.birth;
    if (!self.death && parsed.death) self.death = parsed.death;
    const sex = normalizeSexText(parsed.sex);
    if (sex) self.sex = sex;

    const fathers = [...parsed.father];
    const mothers = [...parsed.mother];
    for (const parent of parsed.parents) {
      const guess = byName.get(parent)?.sex ?? "";
      if (guess === "female") mothers.push(parent);
      else fathers.push(parent);
    }
    for (const father of fathers) {
      const node = ensure(father);
      if (!node) continue;
      if (node.sex === "unknown") node.sex = "male";
      relationPairs.push([node, self, EDGE_PARENT]);
    }
    for (const mother of mothers) {
      const node = ensure(mother);
      if (!node) continue;
      if (node.sex === "unknown") node.sex = "female";
      relationPairs.push([node, self, EDGE_PARENT]);
    }
    for (const spouse of parsed.spouse) {
      const node = ensure(spouse);
      if (!node) continue;
      relationPairs.push([self, node, EDGE_SPOUSE]);
    }
    for (const child of parsed.children) {
      const node = ensure(child);
      if (!node) continue;
      relationPairs.push([self, node, EDGE_PARENT]);
    }
  }

  const keys = new Set();
  for (const [from, to, type] of relationPairs) {
    if (!from || !to || from.id === to.id) continue;
    const key = edgeKey(type, from.id, to.id);
    if (keys.has(key)) continue;
    keys.add(key);
    layout.edges.push({
      id: makeId("e"),
      from: from.id,
      to: to.id,
      type,
      label: "",
    });
  }

  return graph;
}
