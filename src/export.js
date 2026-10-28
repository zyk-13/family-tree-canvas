/**
 * 家谱图 · 导出成 Markdown
 *
 * 目的不只是「给人看」：结构化的表格能让 AI 直接读懂这是谁家的谁。
 * 所以除了人物表，还额外给一张「人物 | 关系 | 相关人」的三元组表，
 * 一行一条事实，不需要解析自然语言。
 *
 * 界面是英文时整份文件也出英文（含 frontmatter 的键），
 * 这样 AI 读到的是一份语言一致的文档，而不是半中半英。
 */
import { isDeceased } from "./model.js";
import { t } from "./i18n.js";

function sexText(sex) {
  return t(sex === "male" ? "男" : sex === "female" ? "女" : "未知");
}

function cell(text) {
  return String(text ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function normalizeNotePath(note) {
  const text = String(note ?? "").trim();
  const match = text.match(/^\[\[([^\]|#]+)/);
  const path = (match ? match[1] : text).replace(/\.md$/i, "").trim();
  return path;
}

function linkOf(person) {
  const path = normalizeNotePath(person.note);
  if (!path) return "";
  return person.name && person.name !== path.split("/").pop()
    ? `[[${path}|${person.name}]]`
    : `[[${path}]]`;
}

function lifeSpan(person) {
  const birth = String(person.birth ?? "").trim();
  const death = String(person.death ?? "").trim();
  if (birth && death) return `${birth} — ${death}`;
  return birth || death;
}

function dateStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 把一张布局拼成「看得懂 + 机器也读得懂」的视图 */
function readLayout(store, layout) {
  const people = new Map(store.people.map((person) => [person.id, person]));
  const nodes = new Map();
  for (const entry of layout.nodes) {
    const person = people.get(entry.pid);
    if (!person) continue;
    nodes.set(entry.pid, {
      ...person,
      x: Number.isFinite(entry.x) ? entry.x : 0,
      row: Number.isFinite(entry.row) ? entry.row : 0,
    });
  }
  const parents = new Map();
  const children = new Map();
  const spouses = new Map();
  const push = (map, key, value) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const edge of layout.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    if (edge.type === "parent") {
      push(parents, edge.to, edge.from);
      push(children, edge.from, edge.to);
    } else if (edge.type === "spouse") {
      push(spouses, edge.from, edge.to);
      push(spouses, edge.to, edge.from);
    }
  }
  return { nodes, parents, children, spouses };
}

/**
 * 生成一个布局的 Markdown 全文
 */
export function buildLayoutMarkdown(store, layout, options = {}) {
  const now = options.now ?? new Date();
  const { nodes, parents, children, spouses } = readLayout(store, layout);
  const nameOf = (id) =>
    nodes.get(id)?.name ?? store.personById(id)?.name ?? id;
  const list = [...nodes.values()];
  const rows = [...new Set(list.map((node) => node.row))].sort((a, b) => a - b);
  const x = (node) => node.x ?? 0;
  const join = t("、");

  const lines = [];
  lines.push("---");
  lines.push("tags:");
  lines.push("  - " + t("家谱"));
  lines.push(`${t("家谱布局")}: ${layout.name}`);
  if (layout.remark) lines.push(`${t("布局备注")}: ${layout.remark}`);
  lines.push(`${t("生成时间")}: ${dateStamp(now)}`);
  lines.push(`${t("人数")}: ${list.length}`);
  lines.push(
    `${t("关系数")}: ${Array.isArray(layout.edges) ? layout.edges.length : 0}`,
  );
  lines.push("---");
  lines.push("");
  lines.push(`# ${t("家谱")} · ${layout.name}`);
  lines.push("");
  if (layout.remark) {
    lines.push(`> ${layout.remark}`);
    lines.push("");
  }
  lines.push(
    "> " +
      t(
        "本文件由「家谱图」插件导出，是一次性快照——改这里不会回流到图里；要改请在 Obsidian 里打开家谱图拖动或编辑。人物的笔记链接在同一个 vault 内全局共用，同一个人出现在几张布局里都指向同一篇笔记。",
      ),
  );
  lines.push("");

  // ---- 人物表 ----
  lines.push(`## ${t("一、人物")}（${list.length}）`);
  lines.push("");
  lines.push(
    `| ${t("姓名")} | ${t("性别")} | ${t("出生")} | ${t("去世")} | ${t("状态")} | ${t("第几代")} | ${t("笔记")} | ${t("备注")} |`,
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  const ordered = list.slice().sort((a, b) => a.row - b.row || x(a) - x(b));
  for (const person of ordered) {
    lines.push(
      "| " +
        [
          cell(person.name),
          sexText(person.sex),
          cell(person.birth) || "",
          cell(person.death) || "",
          isDeceased(person) ? t("已故") : t("在世"),
          String(person.row + 1),
          linkOf(person),
          cell(person.remark),
        ].join(" | ") +
        " |",
    );
  }
  lines.push("");

  // ---- 世代 ----
  lines.push(`## ${t("二、按世代")}`);
  lines.push("");
  for (const row of rows) {
    const members = list
      .filter((node) => node.row === row)
      .sort((a, b) => x(a) - x(b));
    lines.push(
      `### ${t("第 {n} 代（{count} 人）", { n: row + 1, count: members.length })}`,
    );
    lines.push("");
    for (const person of members) {
      const bits = [sexText(person.sex)];
      const span = lifeSpan(person);
      if (span) bits.push(span);
      if (isDeceased(person)) bits.push(t("已故"));
      const note = linkOf(person);
      lines.push(
        `- **${person.name}**（${bits.join(t("，"))}）${note ? " · " + note : ""}` +
          (person.remark ? ` — ${cell(person.remark)}` : ""),
      );
    }
    lines.push("");
  }

  // ---- 家庭 ----
  const families = [];
  const seen = new Set();
  for (const [childId, parentIds] of parents) {
    const key = parentIds.slice().sort().join("|");
    if (seen.has(key)) {
      const family = families.find((item) => item.key === key);
      if (family && !family.children.includes(childId))
        family.children.push(childId);
      continue;
    }
    seen.add(key);
    families.push({ key, parents: parentIds.slice(), children: [childId] });
  }
  lines.push(`## ${t("三、家庭（父母 → 子女）")}`);
  lines.push("");
  if (!families.length) lines.push(`_${t("这张图里还没有父子关系。")}_`);
  for (const family of families) {
    const parentsText = family.parents
      .map((id) => nodes.get(id))
      .filter(Boolean)
      .sort((a, b) => x(a) - x(b))
      .map((node) => node.name)
      .join(join);
    const childrenText = family.children.map(nameOf).join(join);
    lines.push(`- **${parentsText}** → ${childrenText}`);
  }
  lines.push("");

  // ---- 婚姻 ----
  const couples = [];
  const coupleSeen = new Set();
  for (const [id, partnerIds] of spouses) {
    for (const partnerId of partnerIds) {
      const key = [id, partnerId].sort().join("|");
      if (coupleSeen.has(key)) continue;
      coupleSeen.add(key);
      couples.push([id, partnerId]);
    }
  }
  lines.push(`## ${t("四、婚姻")}`);
  lines.push("");
  if (!couples.length) lines.push(`_${t("这张图里还没有配偶关系。")}_`);
  for (const [a, b] of couples) {
    const left = nodes.get(a);
    const right = nodes.get(b);
    const order =
      (left?.x ?? 0) <= (right?.x ?? 0) ? [left, right] : [right, left];
    lines.push(`- ${order[0]?.name ?? a} — ${order[1]?.name ?? b}`);
  }
  lines.push("");

  // ---- 关系三元组 ----
  lines.push(`## ${t("五、关系明细（机器可读）")}`);
  lines.push("");
  lines.push(t("每行读作：**主体** 的 **关系** 是 **相关人**。"));
  lines.push("");
  lines.push(
    `| ${t("主体")} | ${t("关系")} | ${t("相关人")} |`,
  );
  lines.push("| --- | --- | --- |");
  for (const person of ordered) {
    for (const parentId of parents.get(person.id) ?? [])
      lines.push(
        `| ${cell(person.name)} | ${t(
          nodes.get(parentId)?.sex === "female" ? "母亲" : "父亲",
        )} | ${cell(nameOf(parentId))} |`,
      );
    for (const childId of children.get(person.id) ?? [])
      lines.push(
        `| ${cell(person.name)} | ${t("子女")} | ${cell(nameOf(childId))} |`,
      );
    for (const spouseId of spouses.get(person.id) ?? [])
      lines.push(
        `| ${cell(person.name)} | ${t("配偶")} | ${cell(nameOf(spouseId))} |`,
      );
  }
  lines.push("");

  if (options.alsoLayouts?.length) {
    lines.push(`## ${t("附：本库的其他家谱布局")}`);
    lines.push("");
    for (const item of options.alsoLayouts)
      lines.push(`- ${item.name}${item.remark ? " — " + item.remark : ""}`);
    lines.push("");
  }

  lines.push(`<!-- ${t("由家谱图插件生成")}（${t("布局 id")}: ${layout.id}） -->`);
  lines.push("");
  return lines.join("\n");
}

/** 导出文件名：去掉路径非法字符 */
export function exportFileName(layout) {
  const safe = String(layout?.name ?? t("家谱"))
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return `${t("家谱")}-${safe || t("未命名")}.md`;
}
