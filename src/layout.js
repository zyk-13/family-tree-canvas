/**
 * 家谱图 · 排版（全手动）
 *
 * 没有自动排版：位置由人自己拖。
 *   x   —— 横向坐标，自由拖，拖动时吸附
 *   row —— 第几排（世代），一代人只占一条基线，y 永远等于 rowY(row)，不允许中间值
 *
 * 这里只做三件事：
 *   1. 按关系算一遍「默认排」，仅在新建人物 / 首次迁移时用一次
 *   2. 把 x、row 换算成卡片矩形
 *   3. 生成连线（父母 → 子女走固定母线，每个子女一条竖线）
 */

export const PAD = 80;
/** 行距：卡片 78 高，中间留 110 走线 */
export const ROW_H = 188;
export const H_GAP = 32;
export const SPOUSE_GAP = 16;
/** 母线（横线）距父母卡片底边 */
export const BUS_OFFSET = 44;

const CJK = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/;

export function rowY(row) {
  return PAD + (Number.isFinite(row) ? row : 0) * ROW_H;
}

export function textWidth(text, size) {
  let width = 0;
  for (const ch of String(text ?? ""))
    width += CJK.test(ch) ? size : size * 0.56;
  return width;
}

export function cardSize(node, options = {}) {
  const nameSize = 15;
  const nameWidth = textWidth(node.name, nameSize);
  const width = Math.min(
    248,
    Math.max(104, Math.round(nameWidth + 44 + (node.note ? 18 : 0))),
  );
  const height = options.showDates === false ? 58 : 78;
  return { w: width, h: height };
}

// ---------- 配偶组 ----------

function spouseRank(store, members) {
  const key =
    members.length >= 2 ? "spouse:" + [...members].sort().join("|") : null;
  const list = key ? store.graph.order.spouse[key] : null;
  return (id) => {
    if (list) {
      const index = list.indexOf(id);
      return index >= 0 ? index : 900;
    }
    const node = store.getNode(id);
    if (!node) return 900;
    return node.sex === "male" ? 0 : node.sex === "female" ? 1 : 2;
  };
}

export function buildUnits(store) {
  const parent = new Map();
  const size = new Map();
  const find = (id) => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  for (const node of store.nodes) {
    parent.set(node.id, node.id);
    size.set(node.id, 1);
  }

  // 有共同子女的夫妻先合并，其次才是别的配偶关系。
  // 只把「双方都还没配对」的人并成一个单元，避免一夫多妻或数据填重时
  // 把四张卡片绑成一块、整排被带歪。
  const hasChildTogether = (a, b) => {
    const kidsOfA = new Set(store.childrenOf(a));
    return store.childrenOf(b).some((child) => kidsOfA.has(child));
  };
  const spouseEdges = store.graph.edges
    .filter((edge) => edge.type === "spouse")
    .map((edge, index) => ({
      edge,
      index,
      kids: hasChildTogether(edge.from, edge.to),
    }))
    .sort((a, b) => Number(b.kids) - Number(a.kids) || a.index - b.index);

  for (const { edge } of spouseEdges) {
    const a = find(edge.from);
    const b = find(edge.to);
    if (a === b) continue;
    if (size.get(a) > 1 || size.get(b) > 1) continue;
    parent.set(a, b);
    size.set(b, size.get(a) + size.get(b));
  }

  const groups = new Map();
  for (const node of store.nodes) {
    const root = find(node.id);
    const list = groups.get(root);
    if (list) list.push(node.id);
    else groups.set(root, [node.id]);
  }

  const indexOf = new Map(store.nodes.map((node, index) => [node.id, index]));
  const units = [];
  const unitOf = new Map();
  for (const [root, members] of groups) {
    const rank = spouseRank(store, members);
    members.sort((a, b) => {
      const delta = rank(a) - rank(b);
      if (delta) return delta;
      return (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0);
    });
    const unit = { key: root, members };
    units.push(unit);
    for (const id of members) unitOf.set(id, unit);
  }
  return { units, unitOf };
}

// ---------- 世代（只用来给新人一个默认排） ----------

function assignGenerations(store) {
  const gen = new Map();
  const hasParent = new Set();
  for (const node of store.nodes) gen.set(node.id, 0);
  for (const edge of store.graph.edges)
    if (edge.type === "parent") hasParent.add(edge.to);

  const maxPass = Math.min(400, store.nodes.length * 4 + 20);
  for (let pass = 0; pass < maxPass; pass++) {
    let changed = false;
    for (const edge of store.graph.edges) {
      if (edge.type !== "parent") continue;
      const target = (gen.get(edge.from) ?? 0) + 1;
      if ((gen.get(edge.to) ?? 0) < target) {
        gen.set(edge.to, target);
        changed = true;
      }
    }
    for (const edge of store.graph.edges) {
      if (edge.type !== "spouse") continue;
      const level = Math.max(gen.get(edge.from) ?? 0, gen.get(edge.to) ?? 0);
      if ((gen.get(edge.from) ?? 0) < level) {
        gen.set(edge.from, level);
        changed = true;
      }
      if ((gen.get(edge.to) ?? 0) < level) {
        gen.set(edge.to, level);
        changed = true;
      }
    }
    // 自己没有父母、孩子又被婚姻顶下去的人（岳父母这类），跟着往下挪一行
    for (const edge of store.graph.edges) {
      if (edge.type !== "parent") continue;
      if (hasParent.has(edge.from)) continue;
      const want = (gen.get(edge.to) ?? 0) - 1;
      if ((gen.get(edge.from) ?? 0) < want) {
        gen.set(edge.from, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return gen;
}

function compressRows(gen) {
  const values = [...new Set([...gen.values()])].sort((a, b) => a - b);
  const rank = new Map(values.map((value, index) => [value, index]));
  const out = new Map();
  for (const [id, value] of gen) out.set(id, rank.get(value) ?? 0);
  return out;
}

/** 每个人按关系应该在那一排（夫妻同排） */
export function rowsFromGraph(store) {
  const gen = compressRows(assignGenerations(store));
  const { units } = buildUnits(store);
  const rows = new Map();
  for (const unit of units) {
    let level = 0;
    for (const id of unit.members) level = Math.max(level, gen.get(id) ?? 0);
    for (const id of unit.members) rows.set(id, level);
  }
  return { rows, units };
}

// ---------- 位置 ----------

/** 行号补齐 + y 强制落在行基线上 */
export function normalizeRows(store) {
  if (!store.nodes.length) return false;
  const { rows } = rowsFromGraph(store);
  let changed = false;
  for (const node of store.nodes) {
    const row = Number.isFinite(node.row) ? node.row : (rows.get(node.id) ?? 0);
    if (node.row !== row) {
      node.row = row;
      changed = true;
    }
    const y = rowY(row);
    if (node.y !== y) {
      node.y = y;
      changed = true;
    }
  }
  return changed;
}

/** 同一排里已经有卡片占住的位置，找最近的空位 */
function avoidOverlap(store, node, wanted) {
  const width = cardSize(node).w;
  let x = wanted;
  for (let pass = 0; pass < 400; pass++) {
    const clash = store.nodes.find((other) => {
      if (other.id === node.id) return false;
      if (other.row !== node.row) return false;
      if (!Number.isFinite(other.x)) return false;
      const otherWidth = cardSize(other).w;
      return Math.abs(other.x - x) < (width + otherWidth) / 2 + H_GAP - 2;
    });
    if (!clash) return x;
    x = clash.x + (width + cardSize(clash).w) / 2 + H_GAP;
  }
  return x;
}

function nearest(node) {
  if (!node || !Number.isFinite(node.x)) return null;
  return node;
}

/** 新人该站哪：先配偶、再兄弟姐妹、再父母、再子女、最后排尾 */
export function suggestX(store, node) {
  const width = cardSize(node).w;
  const spouses = store
    .spousesOf(node.id)
    .map((id) => nearest(store.getNode(id)))
    .filter(Boolean);
  if (spouses.length) {
    const spouse = spouses[0];
    const step = cardSize(spouse).w / 2 + SPOUSE_GAP + width / 2;
    return node.sex === "female" ? spouse.x + step : spouse.x - step;
  }

  const siblingIds = new Set();
  for (const parentId of store.parentsOf(node.id))
    for (const childId of store.childrenOf(parentId)) siblingIds.add(childId);
  siblingIds.delete(node.id);
  const siblings = [...siblingIds]
    .map((id) => nearest(store.getNode(id)))
    .filter(Boolean);
  if (siblings.length) {
    const far = siblings.reduce((left, right) =>
      right.x > left.x ? right : left,
    );
    return far.x + cardSize(far).w / 2 + H_GAP + width / 2;
  }

  const parents = store
    .parentsOf(node.id)
    .map((id) => nearest(store.getNode(id)))
    .filter(Boolean);
  if (parents.length) {
    const left = Math.min(
      ...parents.map((item) => item.x - cardSize(item).w / 2),
    );
    const right = Math.max(
      ...parents.map((item) => item.x + cardSize(item).w / 2),
    );
    return (left + right) / 2;
  }

  const children = store
    .childrenOf(node.id)
    .map((id) => nearest(store.getNode(id)))
    .filter(Boolean);
  if (children.length)
    return children.reduce((sum, item) => sum + item.x, 0) / children.length;

  let right = -Infinity;
  for (const other of store.nodes) {
    if (other.id === node.id) continue;
    if (other.row !== node.row) continue;
    if (!Number.isFinite(other.x)) continue;
    right = Math.max(right, other.x + cardSize(other).w / 2);
  }
  return right === -Infinity ? 0 : right + H_GAP + width / 2;
}

/** 在 node.row 这一排里给 x 找一个不压别人的位置 */
export function freeX(store, node, x) {
  return avoidOverlap(store, node, x);
}

/** 新建人物之后调用：定排、定 x、避开已有卡片 */
export function placeNewNode(store, id) {
  const node = store.getNode(id);
  if (!node) return null;
  // 位置跟着「实际在场的人」走，而不是重新算一遍世代：
  // 这样把人手动拖过排之后，再加亲属还是贴着那个人放
  const rowOf = (otherId) => {
    const other = store.getNode(otherId);
    return other && Number.isFinite(other.row) ? other.row : null;
  };
  const spouseRows = store
    .spousesOf(id)
    .map(rowOf)
    .filter((value) => value !== null);
  const parentRows = store
    .parentsOf(id)
    .map(rowOf)
    .filter((value) => value !== null);
  const childRows = store
    .childrenOf(id)
    .map(rowOf)
    .filter((value) => value !== null);

  let row;
  if (spouseRows.length) row = Math.max(...spouseRows);
  else if (parentRows.length) row = Math.max(...parentRows) + 1;
  else if (childRows.length) row = Math.min(...childRows) - 1;
  else row = rowsFromGraph(store).rows.get(id) ?? 0;

  if (parentRows.length) row = Math.max(row, Math.max(...parentRows) + 1);
  if (childRows.length) row = Math.min(row, Math.min(...childRows) - 1);

  node.row = row;
  node.y = rowY(row);
  node.x = avoidOverlap(store, node, suggestX(store, node));
  return { row: node.row, y: node.y, x: node.x };
}

/** 首屏兜底：没坐标的人补一个，保证画得出来 */
export function ensurePositions(store) {
  if (!store.nodes.length) return false;
  let changed = normalizeRows(store);
  for (const node of store.nodes) {
    if (Number.isFinite(node.x)) continue;
    node.x = avoidOverlap(store, node, suggestX(store, node));
    changed = true;
  }
  return changed;
}

/** 首次迁移用：同一排按现有顺序压紧，消除重叠 */
export function packRows(store) {
  const rows = new Map();
  for (const node of store.nodes) {
    const list = rows.get(node.row);
    if (list) list.push(node);
    else rows.set(node.row, [node]);
  }
  let changed = false;
  for (const list of rows.values()) {
    list.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
    let edge = -Infinity;
    for (const node of list) {
      const width = cardSize(node).w;
      const minX = edge + H_GAP + width / 2;
      if (!Number.isFinite(node.x) || node.x < minX) {
        node.x = Number.isFinite(minX) ? minX : 0;
        changed = true;
      }
      edge = node.x + width / 2;
    }
  }
  return changed;
}

// ---------- 排版 ----------

export function computeLayout(store, options = {}) {
  const showDates = options.showDates !== false;
  const nodes = store.nodes.slice();
  const result = {
    boxes: [],
    parentPaths: [],
    spouseLines: [],
    otherLines: [],
    rowOf: new Map(),
    width: 0,
    height: 0,
    minX: 0,
    minY: 0,
  };
  if (!nodes.length) return result;

  const sizes = new Map();
  for (const node of nodes) sizes.set(node.id, cardSize(node, { showDates }));

  const { units, unitOf } = buildUnits(store);
  const { rows } = rowsFromGraph(store);

  // 夫妻同排：整组统一用最高的那一排
  const unitRow = new Map();
  for (const unit of units) {
    let level = 0;
    for (const id of unit.members) {
      const node = store.getNode(id);
      const value = Number.isFinite(node?.row) ? node.row : (rows.get(id) ?? 0);
      if (value > level) level = value;
    }
    unitRow.set(unit, level);
  }

  const boxes = new Map();
  for (const node of nodes) {
    const size = sizes.get(node.id);
    const unit = unitOf.get(node.id);
    const row = unit
      ? unitRow.get(unit)
      : Number.isFinite(node.row)
        ? node.row
        : (rows.get(node.id) ?? 0);
    const box = {
      id: node.id,
      node,
      x: Number.isFinite(node.x) ? node.x : 0,
      y: rowY(row),
      row,
      w: size.w,
      h: size.h,
    };
    boxes.set(node.id, box);
    result.boxes.push(box);
    result.rowOf.set(node.id, row);
  }

  // ---- 配偶连线 ----
  const spouseEdge = (a, b) =>
    store.graph.edges.find(
      (edge) =>
        edge.type === "spouse" &&
        ((edge.from === a && edge.to === b) ||
          (edge.from === b && edge.to === a)),
    ) ?? null;

  for (const unit of units) {
    if (unit.members.length < 2) continue;
    const list = unit.members
      .map((id) => boxes.get(id))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    for (let i = 0; i < list.length - 1; i++) {
      const left = list[i];
      const right = list[i + 1];
      result.spouseLines.push({
        x1: left.x + left.w / 2,
        y1: left.y,
        x2: right.x - right.w / 2,
        y2: right.y,
        // 两人之间隔着别人的卡片时，线从上方绕过去，不穿卡
        top: Math.min(left.y, right.y) - Math.max(left.h, right.h) / 2 - 22,
        from: left.id,
        to: right.id,
        edgeId: spouseEdge(left.id, right.id)?.id ?? null,
      });
    }
  }

  // ---- 亲子连线 ----
  // 每条横线占一条「车道」，同一段里两家人的横线不重叠
  const lanes = [];
  const takeLane = (row, from, to) => {
    for (let lane = 0; lane < 16; lane++) {
      const clash = lanes.some(
        (item) =>
          item.row === row &&
          item.lane === lane &&
          !(to < item.from - 10 || from > item.to + 10),
      );
      if (!clash) {
        lanes.push({ row, lane, from, to });
        return lane;
      }
    }
    return 15;
  };

  const parentEdge = (parentId, childId) =>
    store.graph.edges.find(
      (edge) =>
        edge.type === "parent" && edge.from === parentId && edge.to === childId,
    )?.id ?? null;

  for (const unit of units) {
    const members = new Set(unit.members);
    const children = new Set();
    for (const id of unit.members)
      for (const child of store.childrenOf(id))
        if (!members.has(child)) children.add(child);
    if (!children.size) continue;

    const parentBoxes = unit.members.map((id) => boxes.get(id)).filter(Boolean);
    if (!parentBoxes.length) continue;
    const childBoxes = [...children]
      .map((id) => boxes.get(id))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    if (!childBoxes.length) continue;

    const parentLeft = Math.min(...parentBoxes.map((box) => box.x - box.w / 2));
    const parentRight = Math.max(
      ...parentBoxes.map((box) => box.x + box.w / 2),
    );
    const parentX = (parentLeft + parentRight) / 2;
    const parentBottom = Math.max(
      ...parentBoxes.map((box) => box.y + box.h / 2),
    );
    const parentRow = Math.max(...parentBoxes.map((box) => box.row));

    let childTop = Math.min(...childBoxes.map((box) => box.y - box.h / 2));
    // 有人被拖到同一排（数据没拦住）时，线从卡片下方绕
    const gap = childTop - parentBottom;
    if (gap < 24) childTop = parentBottom + 46;

    const minX = Math.min(parentX, ...childBoxes.map((box) => box.x));
    const maxX = Math.max(parentX, ...childBoxes.map((box) => box.x));
    const lane = takeLane(parentRow, minX, maxX);
    // 母线固定在父母卡片下方同一高度：同排的线永远齐平，只按车道错开
    const busY = Math.min(parentBottom + BUS_OFFSET + lane * 10, childTop - 16);

    result.parentPaths.push({
      family: unit.key,
      parentIds: unit.members.slice(),
      row: parentRow,
      bus: { y: busY, from: minX, to: maxX },
      trunk: { x: parentX, from: parentBottom, to: busY },
      drops: childBoxes.map((box) => ({
        x: box.x,
        from: busY,
        to: box.y - box.h / 2,
        child: box.id,
        edges: unit.members
          .map((parentId) => parentEdge(parentId, box.id))
          .filter(Boolean),
      })),
    });
  }

  // ---- 其他关联线 ----
  for (const edge of store.graph.edges) {
    if (edge.type !== "other") continue;
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    if (!from || !to) continue;
    result.otherLines.push({ edge, from, to });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of result.boxes) {
    minX = Math.min(minX, box.x - box.w / 2);
    minY = Math.min(minY, box.y - box.h / 2);
    maxX = Math.max(maxX, box.x + box.w / 2);
    maxY = Math.max(maxY, box.y + box.h / 2);
  }
  result.minX = minX;
  result.minY = minY;
  result.width = maxX - minX + PAD * 2;
  result.height = maxY - minY + PAD * 2;
  return result;
}

// ---------- 紧缩 + 居中 ----------

/** 一排里按「单元」分组：夫妻算一个整体，免得被拆开 */
function unitsOfRow(store, rowNodes) {
  const ids = new Set(rowNodes.map((node) => node.id));
  const byId = new Map(rowNodes.map((node) => [node.id, node]));
  const { units, unitOf } = buildUnits(store);
  const out = [];
  const seen = new Set();
  for (const node of rowNodes) {
    const unit = unitOf.get(node.id);
    const key = unit ? unit.key : node.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const members = (unit ? unit.members : [node.id])
      .filter((id) => ids.has(id))
      .map((id) => byId.get(id))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    if (members.length) out.push({ key, members });
  }
  return out.sort((a, b) => a.members[0].x - b.members[0].x);
}

/** 单元想站的中心：有子女就对着子女的中间，没有就原地不动 */
function unitTarget(store, unit, positions) {
  const childXs = [];
  for (const node of unit.members)
    for (const childId of store.childrenOf(node.id)) {
      const x = positions.get(childId);
      if (Number.isFinite(x)) childXs.push(x);
    }
  if (childXs.length) return (Math.min(...childXs) + Math.max(...childXs)) / 2;
  return (
    unit.members.reduce((sum, node) => sum + node.x, 0) / unit.members.length
  );
}

/** 记一份位置快照，用于「撤销紧缩」 */
export function snapshotPositions(store) {
  return store.nodes.map((node) => ({ id: node.id, x: node.x, row: node.row }));
}

export function restorePositions(store, snapshot) {
  if (!Array.isArray(snapshot) || !snapshot.length) return false;
  const byId = new Map(snapshot.map((item) => [item.id, item]));
  let changed = false;
  for (const node of store.nodes) {
    const item = byId.get(node.id);
    if (!item) continue;
    if (node.x !== item.x || node.row !== item.row) changed = true;
    node.x = item.x;
    node.row = item.row;
    node.y = rowY(item.row ?? 0);
  }
  return changed;
}

/**
 * 紧缩空间 + 居中人物。
 *
 * 只动「位置」不动「布局」：不重排谁在左谁在右、不改谁跟谁一对、不改上下代。
 *   1. 空排压掉（中间没人站的那几排直接收起来）
 *   2. 每排按「单元」分组，夫妻像一个不可拆的积木
 *   3. 一个单元连同它整棵子树算成一块，宽度自下而上累加
 *   4. 自上而下摆积木：子女先排开，父母对着子女正中；一块挨一块，只留最小间距
 *   5. 整体平移，让整张图居中对齐
 *
 * 关键点是「整棵子树一起挪」——只按排收间距的话，
 * 没有子女的人会留在原地，中间就永远空出一大块，按多少次都不动。
 */
export function compactLayout(store) {
  const nodes = store.nodes.filter(
    (node) => Number.isFinite(node.row) && Number.isFinite(node.x),
  );
  if (!nodes.length) return { changed: false, moved: 0, rows: 0 };

  // 开动前的坐标：最后靠它判断到底有没有挪动
  const before = new Map(
    nodes.map((node) => [node.id, { x: node.x, row: node.row }]),
  );

  // 1) 空排收起来，顺序不变
  const usedRows = [...new Set(nodes.map((node) => node.row))].sort(
    (a, b) => a - b,
  );
  const rank = new Map(usedRows.map((row, index) => [row, index]));
  const byRow = new Map();
  for (const node of nodes) {
    const row = rank.get(node.row) ?? 0;
    node.row = row;
    node.y = rowY(row);
    const list = byRow.get(row);
    if (list) list.push(node);
    else byRow.set(row, [node]);
  }
  for (const list of byRow.values()) list.sort((a, b) => a.x - b.x);

  // 2) 每排按「单元」分组（夫妻不拆），顺带记下宽度
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const units = [];
  const unitOfNode = new Map();
  for (const row of rows) {
    for (const unit of unitsOfRow(store, byRow.get(row))) {
      unit.row = row;
      unit.children = [];
      unit.allChildren = [];
      unit.width =
        unit.members.reduce((sum, node) => sum + cardSize(node).w, 0) +
        SPOUSE_GAP * Math.max(0, unit.members.length - 1);
      units.push(unit);
      for (const member of unit.members) unitOfNode.set(member.id, unit);
    }
  }

  // 3) 谁是谁的子女单元。只看下面那几排，数据打结时也不会成环。
  //    一桩婚姻可能「两头都有父母」（媳妇的娘家也记了），这种单元只挂给左边那家，
  //    否则同一块积木会被摆两次，中间就空出一大块，按多少次都收不回去。
  const claimed = new Set();
  for (const unit of units) {
    const seen = new Set();
    for (const member of unit.members) {
      for (const childId of store.childrenOf(member.id)) {
        const child = unitOfNode.get(childId);
        if (!child || child === unit || seen.has(child.key)) continue;
        if (child.row <= unit.row) continue;
        seen.add(child.key);
        // allChildren：画面上所有子女，用来把父母摆在整条母线正中
        unit.allChildren.push(child);
        if (claimed.has(child.key)) continue;
        claimed.add(child.key);
        unit.children.push(child);
      }
    }
    // 子女之间保持现在的左右顺序，不重排
    unit.children.sort((a, b) => a.members[0].x - b.members[0].x);
    unit.allChildren.sort((a, b) => a.members[0].x - b.members[0].x);
  }

  // 3.5) 每个单元在块内的「主卡」位置。主卡 = 本家人站的那张卡（本图里有父母的
  //      那个成员），用来当对齐基准：线本来就画到这个人头上，拿块中点去对会偏
  //      半张卡，落点正好骑在夫妻两张卡的缝里，看着像接错了人。
  for (const unit of units) {
    const blood = unit.members.find((node) =>
      store.parentsOf(node.id).some((parentId) => unitOfNode.has(parentId)),
    );
    const main = blood ?? unit.members[0];
    let offset = 0;
    for (const node of unit.members) {
      const width = cardSize(node).w;
      if (node.id === main.id) {
        offset += width / 2;
        break;
      }
      offset += width + SPOUSE_GAP;
    }
    unit.anchor = offset;
  }

  // 4) 一个单元连同它整棵子树占多宽
  const blockWidth = (unit) => {
    if (unit.block != null) return unit.block;
    unit.block = unit.width; // 先占位，防数据成环时无限递归
    if (unit.children.length) {
      const kids =
        unit.children.reduce((sum, kid) => sum + blockWidth(kid), 0) +
        H_GAP * (unit.children.length - 1);
      unit.block = Math.max(unit.width, kids);
    }
    return unit.block;
  };

  /**
   * 子女单元里「本家那个孩子」站的 x。亲家那头（媳妇/女婿）不参与对中——
   * 母线只落到自己孩子头上，拿单元中点去对会偏半张卡。
   *
   * 注意 parentsOf 给的是 id，members 里放的是对象，集合里必须装 id，
   * 否则 has() 永远 false，会静默退回块内主卡（那可能是亲家那位），
   * 父母就整体偏出去一个卡位。
   */
  const anchorFor = (parentUnit, kidUnit) => {
    const parents = new Set(parentUnit.members.map((node) => node.id));
    const index = kidUnit.members.findIndex((node) =>
      store.parentsOf(node.id).some((id) => parents.has(id)),
    );
    if (index >= 0) {
      let offset = 0;
      for (let i = 0; i < index; i++)
        offset += cardSize(kidUnit.members[i]).w + SPOUSE_GAP;
      const node = kidUnit.members[index];
      return kidUnit.left + offset + cardSize(node).w / 2;
    }
    // 认不出是谁的孩子（两边的亲子关系都没记全）时，退回块内的默认锚点
    return kidUnit.left + kidUnit.anchor;
  };

  // 5) 把子树当积木排：子女先占位，父母的「结合点」（两张卡的外框中点）
  //    对准子女主卡的中点。
  //
  // 这里不能把父母硬塞回自己的块宽里：父母两边都有卡，块宽按卡算，
  // 而子女主卡在块内是偏左/偏右的（旁边还站着配偶），硬塞回去就又会
  // 拐出一个台阶。所以允许父母块探出一点，把实际占用的左右边界返回给
  // 上面，邻居按「实际边界」错开，绝不会叠在一起。
  const place = (unit, left) => {
    const width = blockWidth(unit);
    if (!unit.children.length) {
      unit.left = left + (width - unit.width) / 2;
      return { min: unit.left, max: unit.left + unit.width };
    }
    const kidsWidth =
      unit.children.reduce((sum, kid) => sum + blockWidth(kid), 0) +
      H_GAP * (unit.children.length - 1);
    let cursor = left + (width - kidsWidth) / 2;
    let minEdge = Infinity;
    let maxEdge = -Infinity;
    for (const kid of unit.children) {
      const span = place(kid, cursor);
      minEdge = Math.min(minEdge, span.min);
      maxEdge = Math.max(maxEdge, span.max);
      cursor += blockWidth(kid) + H_GAP;
    }
    // 对着「第一个子女的主卡 ~ 最后一个子女的主卡」取中，跟画线的算法一致：
    // 母线是落到子女本人头顶的，配偶那张卡不参与对中，否则线会拐一个台阶。
    const placedKids = unit.allChildren.filter((kid) => kid.left != null);
    const pool = placedKids.length ? placedKids : unit.children;
    const first = pool[0];
    const last = pool[pool.length - 1];
    const center =
      (anchorFor(unit, first) + anchorFor(unit, last)) / 2;
    // 允许探出自己的块（差半张卡的宽度就够），但不能被异常数据拖到天边
    const wanted = center - unit.width / 2;
    unit.left = Math.min(
      Math.max(wanted, left - unit.width),
      left + width,
    );
    return {
      min: Math.min(minEdge, unit.left),
      max: Math.max(maxEdge, unit.left + unit.width),
    };
  };

  // 6) 没有父母的当根，按现在的左右顺序依次排开
  const hasParent = new Set();
  for (const unit of units)
    for (const kid of unit.children) hasParent.add(kid.key);
  const roots = units
    .filter((unit) => !hasParent.has(unit.key))
    .sort((a, b) => a.row - b.row || a.members[0].x - b.members[0].x);
  let cursor = 0;
  for (const root of roots) {
    const span = place(root, cursor);
    cursor = Math.max(cursor + blockWidth(root), span.max) + H_GAP;
  }
  // 兜底：数据打结导致有人没被排上，自成一块接在最后，绝不让谁被丢掉
  for (const unit of units) {
    if (unit.left != null) continue;
    const span = place(unit, cursor);
    cursor = Math.max(cursor + blockWidth(unit), span.max) + H_GAP;
  }

  // 7) 单元坐标落回每个人身上
  for (const unit of units) {
    let x = unit.left;
    for (const member of unit.members) {
      const width = cardSize(member).w;
      member.x = x + width / 2;
      x += width + SPOUSE_GAP;
    }
  }

  // 8) 整体横向居中到 0
  let minX = Infinity;
  let maxX = -Infinity;
  for (const node of nodes) {
    const width = cardSize(node).w;
    minX = Math.min(minX, node.x - width / 2);
    maxX = Math.max(maxX, node.x + width / 2);
  }
  const shift = Number.isFinite(minX) ? -(minX + maxX) / 2 : 0;
  for (const node of nodes) node.x += shift;

  let moved = 0;
  for (const node of nodes) {
    const old = before.get(node.id);
    if (!old || Math.abs(old.x - node.x) > 0.001 || old.row !== node.row)
      moved++;
  }
  return { changed: moved > 0, moved, rows: rows.length };
}

/** 折线转角圆角 */
export function roundedPath(points, radius = 10) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const current = points[i];
    const next = points[i + 1];
    const inLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outLength = Math.hypot(next.x - current.x, next.y - current.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r < 0.5) {
      d += `L${current.x},${current.y}`;
      continue;
    }
    const startX = current.x + (previous.x - current.x) * (r / inLength);
    const startY = current.y + (previous.y - current.y) * (r / inLength);
    const endX = current.x + (next.x - current.x) * (r / outLength);
    const endY = current.y + (next.y - current.y) * (r / outLength);
    d += `L${startX},${startY}Q${current.x},${current.y} ${endX},${endY}`;
  }
  const last = points[points.length - 1];
  d += `L${last.x},${last.y}`;
  return d;
}
