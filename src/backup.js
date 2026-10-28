/**
 * 备份 / 恢复
 *
 * 备份就是一份完整的 JSON：把 graph.json 里那套 { version, active, people, layouts }
 * 原样装进一个信封，再补上时间、插件版本、人数这些「人一眼能看懂」的信息。
 * 恢复时信封可以拆也可以不拆——直接丢一个老的 graph.json 进来也认。
 *
 * 这里不碰 Obsidian API，纯函数，方便脱离 Obsidian 单独测。
 */

export const BACKUP_KIND = "family-tree-backup";
export const BACKUP_FORMAT = 1;

function pad2(value) {
  return String(value).padStart(2, "0");
}

/** 20261028-073205：按文件名排序就等于按时间排序 */
export function stampOf(date = new Date()) {
  return (
    date.getFullYear() +
    pad2(date.getMonth() + 1) +
    pad2(date.getDate()) +
    "-" +
    pad2(date.getHours()) +
    pad2(date.getMinutes()) +
    pad2(date.getSeconds())
  );
}

/** 2026-10-28 07:32:05：写进文件里给自己看的时间 */
export function localTimeOf(date = new Date()) {
  return (
    date.getFullYear() +
    "-" +
    pad2(date.getMonth() + 1) +
    "-" +
    pad2(date.getDate()) +
    " " +
    pad2(date.getHours()) +
    ":" +
    pad2(date.getMinutes()) +
    ":" +
    pad2(date.getSeconds())
  );
}

/**
 * 文件名带时间戳，所以永远不覆盖旧备份。
 * tag 用来区分「恢复前自动存的那一份」（before-restore）。
 */
export function backupFileName(date = new Date(), tag = "") {
  const suffix = String(tag ?? "")
    .trim()
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (
    "family-tree-backup-" + stampOf(date) + (suffix ? "-" + suffix : "") + ".json"
  );
}

/**
 * 备份里的人数/布局数。
 * v4 是 people + layouts；v3 及以前整张图就是 nodes + edges，算一个布局。
 */
export function countGraph(graph) {
  const legacy = !Array.isArray(graph?.layouts) && Array.isArray(graph?.nodes);
  if (legacy) {
    const people = graph.nodes.length;
    return {
      people,
      layouts: people ? 1 : 0,
      nodes: people,
      edges: Array.isArray(graph.edges) ? graph.edges.length : 0,
    };
  }
  const people = Array.isArray(graph?.people) ? graph.people.length : 0;
  const layouts = Array.isArray(graph?.layouts) ? graph.layouts.length : 0;
  let nodes = 0;
  let edges = 0;
  for (const layout of Array.isArray(graph?.layouts) ? graph.layouts : []) {
    nodes += Array.isArray(layout?.nodes) ? layout.nodes.length : 0;
    edges += Array.isArray(layout?.edges) ? layout.edges.length : 0;
  }
  return { people, layouts, nodes, edges };
}

/**
 * 文件名 → 排序键："20261028073205.002"（同一秒里 -2 排在 -1 后面）。
 * 用字符串而不是数字：14 位时间戳乘 1000 会超出 JS 安全整数，比不出先后。
 * 返回 null 表示不是标准备份名（手改过名的），由调用方决定怎么排。
 */
export function backupSortKey(name) {
  const match =
    /^family-tree-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d+))?/.exec(
      String(name ?? ""),
    );
  if (!match) return null;
  const stamp =
    match[1] + match[2] + match[3] + match[4] + match[5] + match[6];
  const index = match[7] ? Number(match[7]) : 1;
  return stamp + "." + String(index).padStart(3, "0");
}

export function buildBackup(graph, settings = {}, options = {}) {
  const when = options.now instanceof Date ? options.now : new Date();
  return {
    kind: BACKUP_KIND,
    format: BACKUP_FORMAT,
    plugin: "family-tree",
    pluginVersion: String(options.pluginVersion ?? ""),
    createdAt: when.toISOString(),
    createdAtLocal: localTimeOf(when),
    counts: countGraph(graph),
    // 设置只做参考信息存着，恢复时不写回——免得把备份文件夹之类的设置改乱
    settings: { ...settings },
    graph,
  };
}

/**
 * 认三种东西：
 *   1. 本插件导出的备份（有 kind 信封）
 *   2. 直接就是 graph.json 的内容
 *   3. v2/v3 老格式（nodes + edges，一张图）
 * 认不出来就返回 { error }，由调用方决定怎么提示。
 */
export function parseBackup(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { error: "shape" };

  const wrapped = raw.kind === BACKUP_KIND;
  const graph = wrapped ? raw.graph : raw;
  if (!graph || typeof graph !== "object" || Array.isArray(graph))
    return { error: "shape" };

  const hasPeople = Array.isArray(graph.people) || Array.isArray(graph.nodes);
  const hasLayouts =
    Array.isArray(graph.layouts) || Array.isArray(graph.nodes);
  if (!hasPeople || !hasLayouts) return { error: "shape" };

  const counts = countGraph(graph);
  if (!counts.people && !counts.layouts) return { error: "empty" };

  return {
    graph,
    info: {
      wrapped,
      createdAt: String(raw.createdAt ?? ""),
      createdAtLocal: String(raw.createdAtLocal ?? ""),
      pluginVersion: String(raw.pluginVersion ?? ""),
      counts,
    },
  };
}

export function formatBytes(size) {
  const value = Number(size);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  return (value / 1024 / 1024).toFixed(1) + " MB";
}

/** mtime（毫秒）→ 2026-10-28 07:32；拿不到就空串 */
export function formatWhen(mtime) {
  const value = Number(mtime);
  if (!Number.isFinite(value) || value <= 0) return "";
  return localTimeOf(new Date(value)).slice(0, 16);
}
