/**
 * 家谱图 · 亲戚称谓计算
 *
 * 做法：把「甲怎么称呼乙」拆成一串最短路上的基本步：
 *   f 父亲 · m 母亲 · s 儿子 · d 女儿 · h 丈夫 · w 妻子
 *   ob 哥哥 · yb 弟弟 · oz 姐姐 · yz 妹妹 · b 兄弟 · z 姐妹
 * 用最短路搜出来（一步算一步，姻亲多一点点权重，长度相同优先走血缘），
 * 再把步串翻译成中文称谓。翻不出来时退回「你父亲的弟弟的女儿」这种描述，
 * 保证任何时候给的都是对的，不会瞎猜一个称谓。
 *
 * 英文界面下称谓走 localizeTerm()：能对上的给英文（伯父/叔父都收成 uncle，
 * 这是英文本身不分，不是漏翻），对不上就保留中文——宁可显示中文，也不瞎造词。
 */

import { getLang } from "./i18n.js";

const STEP_TEXT = {
  f: "父亲",
  m: "母亲",
  s: "儿子",
  d: "女儿",
  h: "丈夫",
  w: "妻子",
  ob: "哥哥",
  yb: "弟弟",
  oz: "姐姐",
  yz: "妹妹",
  b: "兄弟",
  z: "姐妹",
};

const STEP_TEXT_EN = {
  f: "father",
  m: "mother",
  s: "son",
  d: "daughter",
  h: "husband",
  w: "wife",
  ob: "elder brother",
  yb: "younger brother",
  oz: "elder sister",
  yz: "younger sister",
  b: "brother",
  z: "sister",
};

/** 往上几代的叫法 */
const ANCESTOR = [
  "",
  "父亲",
  "祖父",
  "曾祖父",
  "高祖父",
  "天祖父",
  "烈祖父",
  "太祖父",
  "远祖父",
  "鼻祖父",
];
/** 往下几代的叫法 */
const DESCENDANT = [
  "",
  "儿子",
  "孙子",
  "曾孙",
  "玄孙",
  "来孙",
  "晜孙",
  "仍孙",
  "云孙",
  "耳孙",
];

const SEX_OF_STEP = {
  f: "male",
  m: "female",
  s: "male",
  d: "female",
  h: "male",
  w: "female",
};

function birthYear(node) {
  const match = String(node?.birth ?? "").match(/(\d{3,4})/);
  return match ? Number(match[1]) : null;
}

/** other 比 self 年长返回 -1，年轻返回 1，不知道返回 0 */
function compareAge(self, other) {
  const a = birthYear(self);
  const b = birthYear(other);
  if (a === null || b === null) return 0;
  if (b < a) return -1;
  if (b > a) return 1;
  return 0;
}

function siblingStep(store, selfId, otherId) {
  const other = store.getNode(otherId);
  const order = compareAge(store.getNode(selfId), other);
  const female = other?.sex === "female";
  if (female) return order === -1 ? "oz" : order === 1 ? "yz" : "z";
  return order === -1 ? "ob" : order === 1 ? "yb" : "b";
}

function neighbors(store, id) {
  const out = [];
  const parents = store.parentsOf(id);
  const father =
    parents.find((pid) => store.getNode(pid)?.sex === "male") ?? null;
  const mother =
    parents.find((pid) => store.getNode(pid)?.sex === "female") ?? null;
  if (father) out.push({ id: father, step: "f", cost: 1 });
  if (mother) out.push({ id: mother, step: "m", cost: 1 });
  // 性别不明时按第一个父母兜底，别把人当成孤儿
  for (const pid of parents) {
    if (pid === father || pid === mother) continue;
    out.push({ id: pid, step: "f", cost: 1 });
  }
  for (const childId of store.childrenOf(id)) {
    const female = store.getNode(childId)?.sex === "female";
    out.push({ id: childId, step: female ? "d" : "s", cost: 1 });
  }
  for (const siblingId of store.siblingsOf(id))
    out.push({
      id: siblingId,
      step: siblingStep(store, id, siblingId),
      cost: 1,
    });
  for (const spouseId of store.spousesOf(id)) {
    const female = store.getNode(spouseId)?.sex === "female";
    // 姻亲也算一步：夫妻只差一步，比「先到孩子再绕回配偶」短，
    // 这样「我老婆」不会被算成「我女儿的母亲」
    out.push({ id: spouseId, step: female ? "w" : "h", cost: 1.001 });
  }
  return out;
}

const MAX_DEPTH = 8;

/**
 * 找甲→乙的关系串
 * @returns {{tokens: string[], path: string[]}|null}
 */
export function findPath(store, fromId, toId) {
  if (!fromId || !toId) return null;
  if (fromId === toId) return { tokens: [], path: [fromId] };
  if (!store.getNode(fromId) || !store.getNode(toId)) return null;

  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const queue = [{ id: fromId, cost: 0, depth: 0 }];
  let found = false;

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || a.depth - b.depth);
    const current = queue.shift();
    if (current.id === toId) {
      found = true;
      break;
    }
    if (current.depth >= MAX_DEPTH) continue;
    if (current.cost > (dist.get(current.id) ?? Infinity)) continue;
    for (const next of neighbors(store, current.id)) {
      const cost = current.cost + next.cost;
      if (cost >= (dist.get(next.id) ?? Infinity)) continue;
      dist.set(next.id, cost);
      prev.set(next.id, { id: current.id, step: next.step });
      queue.push({ id: next.id, cost, depth: current.depth + 1 });
    }
  }
  if (!found) return null;

  const tokens = [];
  const path = [toId];
  let cursor = toId;
  const guard = new Set();
  while (prev.has(cursor) && !guard.has(cursor)) {
    guard.add(cursor);
    const item = prev.get(cursor);
    tokens.unshift(item.step);
    path.unshift(item.id);
    cursor = item.id;
  }
  return { tokens, path };
}

// ---------- 称谓翻译 ----------

function cousin(sideFemale, siblingToken, targetFemale, order) {
  const viaFemale = siblingToken.endsWith("z");
  const biao = sideFemale || viaFemale;
  const prefix = biao ? "表" : "堂";
  const base = targetFemale ? "姐妹" : "兄弟";
  if (order === 0) return prefix + base;
  if (targetFemale) return prefix + (order === -1 ? "姐" : "妹");
  return prefix + (order === -1 ? "兄" : "弟");
}

function siblingTerm(token) {
  return (
    {
      ob: "哥哥",
      yb: "弟弟",
      oz: "姐姐",
      yz: "妹妹",
      b: "兄弟",
      z: "姐妹",
    }[token] ?? null
  );
}

const PARENT_SIBLING = {
  fob: "伯父",
  fyb: "叔父",
  fb: "伯父／叔父",
  foz: "姑母",
  fyz: "姑母",
  fz: "姑母",
  mob: "舅父",
  myb: "舅父",
  mb: "舅父",
  moz: "姨母",
  myz: "姨母",
  mz: "姨母",
};

const GRAND_SIBLING = {
  ffob: "伯祖父",
  ffyb: "叔祖父",
  ffb: "伯祖父／叔祖父",
  ffz: "姑祖母",
  fmob: "舅祖父",
  fmyb: "舅祖父",
  fmz: "姨祖母",
  mfob: "外伯祖父",
  mfyb: "外叔祖父",
  mfz: "外姑祖母",
  mmob: "外舅祖父",
  mmz: "外姨祖母",
};

const NEPHEW = {
  bs: "侄子",
  bd: "侄女",
  zs: "外甥",
  zd: "外甥女",
  obs: "侄子",
  obd: "侄女",
  ybs: "侄子",
  ybd: "侄女",
  ozs: "外甥",
  ozd: "外甥女",
  yzs: "外甥",
  yzd: "外甥女",
};

const NEPHEW_GRAND = {
  bss: "侄孙",
  bsd: "侄孙女",
  bds: "侄外孙",
  bdd: "侄外孙女",
  zss: "外甥孙",
  zsd: "外甥孙女",
};

/** 配偶称谓：键是「去掉最后一步 h/w 之后的关系串」 */
const SPOUSE_AS_WIFE = {
  s: "儿媳",
  d: "女儿的妻子",
  ob: "嫂子",
  yb: "弟媳",
  b: "兄弟的妻子",
  oz: "姐姐的妻子",
  yz: "妹妹的妻子",
  z: "姐妹的妻子",
  bs: "侄媳",
  zs: "外甥媳",
  f: "母亲",
  m: "母亲的妻子",
  ff: "祖母",
  mf: "外祖母",
};

const SPOUSE_AS_HUSBAND = {
  s: "儿子的丈夫",
  d: "女婿",
  ob: "哥哥的丈夫",
  yb: "弟弟的丈夫",
  b: "兄弟的丈夫",
  oz: "姐夫",
  yz: "妹夫",
  z: "姐妹的丈夫",
  bd: "侄女的丈夫",
  zd: "外甥女的丈夫",
  m: "父亲",
  f: "父亲的丈夫",
  fm: "祖母",
  mm: "外祖母",
};

const WIFE_FAMILY = {
  f: "岳父",
  m: "岳母",
  ob: "大舅子",
  yb: "小舅子",
  oz: "大姨子",
  yz: "小姨子",
  b: "妻子的兄弟",
  z: "妻子的姐妹",
  s: "继子／儿子",
  d: "继女／女儿",
};

const HUSBAND_FAMILY = {
  f: "公公",
  m: "婆婆",
  ob: "大伯子",
  yb: "小叔子",
  oz: "大姑子",
  yz: "小姑子",
  b: "丈夫的兄弟",
  z: "丈夫的姐妹",
  s: "继子／儿子",
  d: "继女／女儿",
};

/**
 * 把关系串翻成称谓
 * @returns {{ term: string, exact: boolean }}
 */
export function describeTokens(tokens, store, fromId, toId) {
  const key = tokens.join("");
  const self = store.getNode(fromId);
  const target = store.getNode(toId);
  const targetFemale = target?.sex === "female";
  const order = compareAge(self, target);

  if (!key) return { term: "自己", exact: true };

  // ---- 配偶收尾 ----
  const last = tokens[tokens.length - 1];
  if (last === "h" || last === "w") {
    const base = tokens.slice(0, -1).join("");
    if (!base) return { term: last === "w" ? "妻子" : "丈夫", exact: true };
    const table = last === "w" ? SPOUSE_AS_WIFE : SPOUSE_AS_HUSBAND;
    const direct = table[base];
    if (direct) return { term: direct, exact: tokens.length <= 2 };
  }
  // ---- 配偶的家里人 ----
  if (tokens.length === 2 && tokens[0] === "w") {
    const term = WIFE_FAMILY[tokens[1]];
    if (term) return { term, exact: true };
  }
  if (tokens.length === 2 && tokens[0] === "h") {
    const term = HUSBAND_FAMILY[tokens[1]];
    if (term) return { term, exact: true };
  }
  if (tokens.length >= 3 && tokens[0] === "w") {
    const inner = tokens.slice(1).join("");
    const term = WIFE_FAMILY[inner];
    if (term) return { term: "妻子的" + term, exact: false };
  }
  if (tokens.length >= 3 && tokens[0] === "h") {
    const inner = tokens.slice(1).join("");
    const term = HUSBAND_FAMILY[inner];
    if (term) return { term: "丈夫的" + term, exact: false };
  }

  // ---- 单纯往上 / 往下 ----
  if (/^[fm]+$/.test(key)) {
    const depth = tokens.length;
    if (depth === 1)
      return { term: tokens[0] === "f" ? "父亲" : "母亲", exact: true };
    const female = tokens[depth - 1] === "m";
    const prefix = tokens[0] === "m" ? "外" : "";
    const base = ANCESTOR[Math.min(depth, ANCESTOR.length - 1)];
    if (depth >= ANCESTOR.length)
      return { term: `${prefix}${depth - 1}世祖`, exact: false };
    const term = female ? base.replace("父", "母") : base;
    return { term: prefix + term, exact: depth <= 4 };
  }
  if (/^[sd]+$/.test(key)) {
    const depth = tokens.length;
    if (depth === 1)
      return { term: tokens[0] === "d" ? "女儿" : "儿子", exact: true };
    const female = tokens[depth - 1] === "d";
    const prefix = tokens.includes("d") ? "外" : "";
    const base = DESCENDANT[Math.min(depth, DESCENDANT.length - 1)];
    if (depth >= DESCENDANT.length)
      return { term: `${prefix}${depth - 1}世孙`, exact: false };
    const term = female ? base.replace("子", "女").replace("孙", "孙女") : base;
    return { term: prefix + term, exact: depth <= 4 };
  }

  // ---- 兄弟姐妹 ----
  if (tokens.length === 1) {
    const term = siblingTerm(key);
    if (term) return { term, exact: key.length === 2 };
  }

  // ---- 父母的兄弟姐妹 ----
  const parentSibling = PARENT_SIBLING[key];
  if (parentSibling) return { term: parentSibling, exact: key.length === 3 };
  const grandSibling = GRAND_SIBLING[key];
  if (grandSibling) return { term: grandSibling, exact: false };

  // ---- 兄弟姐妹的孩子、孙辈 ----
  const nephew = NEPHEW[key];
  if (nephew) return { term: nephew, exact: key.length === 2 };
  const nephewGrand = NEPHEW_GRAND[key];
  if (nephewGrand) return { term: nephewGrand, exact: false };

  // ---- 堂 / 表兄弟姐妹，以及他们的孩子 ----
  const cousinMatch = key.match(/^(f|m)(ob|yb|b|oz|yz|z)(s|d)?$/);
  if (cousinMatch) {
    const [, side, sibling, child] = cousinMatch;
    if (!child)
      return { term: PARENT_SIBLING[key] ?? "旁系长辈", exact: false };
    return {
      term: cousin(side === "m", sibling, child === "d", order),
      exact: sibling.length === 2,
    };
  }
  const cousinChild = key.match(/^(f|m)(ob|yb|b|oz|yz|z)(s|d)(s|d)$/);
  if (cousinChild) {
    const [, side, sibling, , child] = cousinChild;
    const biao = side === "m" || sibling.endsWith("z");
    const base = child === "d" ? "侄女" : "侄子";
    return { term: (biao ? "表" : "堂") + base, exact: false };
  }

  // ---- 兄弟姐妹的孙辈 ----
  const siblingGrand = key.match(/^(ob|yb|b|oz|yz|z)(s|d)(s|d)$/);
  if (siblingGrand) {
    const [, sibling, child, grand] = siblingGrand;
    const biao = sibling.endsWith("z") || child === "d";
    const base = grand === "d" ? "孙女" : "孙";
    return { term: (biao ? "外甥" : "侄") + base, exact: false };
  }

  // ---- 隔了几层但方向单纯：祖辈的兄弟姐妹的孩子 ----
  const elderCousin = key.match(/^(ff|fm|mf|mm)(ob|yb|b|oz|yz|z)(s|d)$/);
  if (elderCousin) {
    const [, up, sibling, child] = elderCousin;
    const biao = up.includes("m") || sibling.endsWith("z");
    const base = child === "d" ? "姐妹" : "兄弟";
    return { term: (biao ? "表" : "堂") + base + "（父辈）", exact: false };
  }

  return { term: "", exact: false };
}

/** 关系串 → 「你父亲的弟弟的女儿」这种人话 */
export function phraseOf(tokens) {
  if (getLang() === "en") {
    if (!tokens.length) return "yourself";
    return "your " + tokens.map((token) => STEP_TEXT_EN[token] ?? token).join("'s ");
  }
  let text = "你";
  for (const token of tokens) text += "的" + (STEP_TEXT[token] ?? token);
  return text;
}

// ---------- 英文称谓 ----------

const EN_TERM = {
  自己: "self",
  妻子: "wife",
  丈夫: "husband",
  父亲: "father",
  母亲: "mother",
  儿子: "son",
  女儿: "daughter",
  哥哥: "elder brother",
  弟弟: "younger brother",
  姐姐: "elder sister",
  妹妹: "younger sister",
  兄弟: "brother",
  姐妹: "sister",
  祖父: "grandfather",
  祖母: "grandmother",
  外祖父: "maternal grandfather",
  外祖母: "maternal grandmother",
  曾祖父: "great-grandfather",
  曾祖母: "great-grandmother",
  外曾祖父: "maternal great-grandfather",
  外曾祖母: "maternal great-grandmother",
  高祖父: "great-great-grandfather",
  高祖母: "great-great-grandmother",
  孙子: "grandson",
  孙女: "granddaughter",
  外孙: "daughter's son",
  外孙女: "daughter's daughter",
  曾孙: "great-grandson",
  曾孙女: "great-granddaughter",
  玄孙: "great-great-grandson",
  玄孙女: "great-great-granddaughter",
  伯父: "uncle",
  叔父: "uncle",
  "伯父／叔父": "uncle",
  姑母: "aunt",
  舅父: "uncle",
  姨母: "aunt",
  伯祖父: "great-uncle",
  叔祖父: "great-uncle",
  "伯祖父／叔祖父": "great-uncle",
  姑祖母: "great-aunt",
  舅祖父: "great-uncle",
  姨祖母: "great-aunt",
  外伯祖父: "great-uncle",
  外叔祖父: "great-uncle",
  外姑祖母: "great-aunt",
  外舅祖父: "great-uncle",
  外姨祖母: "great-aunt",
  侄子: "nephew",
  侄女: "niece",
  外甥: "nephew",
  外甥女: "niece",
  侄孙: "great-nephew",
  侄孙女: "great-niece",
  侄外孙: "great-nephew",
  侄外孙女: "great-niece",
  外甥孙: "great-nephew",
  外甥孙女: "great-niece",
  儿媳: "daughter-in-law",
  女婿: "son-in-law",
  嫂子: "sister-in-law",
  弟媳: "sister-in-law",
  侄媳: "niece-in-law",
  外甥媳: "niece-in-law",
  姐夫: "brother-in-law",
  妹夫: "brother-in-law",
  岳父: "father-in-law",
  岳母: "mother-in-law",
  公公: "father-in-law",
  婆婆: "mother-in-law",
  大舅子: "elder brother-in-law",
  小舅子: "younger brother-in-law",
  大姨子: "elder sister-in-law",
  小姨子: "younger sister-in-law",
  大伯子: "elder brother-in-law",
  小叔子: "younger brother-in-law",
  大姑子: "elder sister-in-law",
  小姑子: "younger sister-in-law",
  旁系长辈: "distant elder relative",
};

/** 「妻子的X」「丈夫的X」这类前缀 */
const EN_PREFIX = [
  ["妻子的", "wife's "],
  ["丈夫的", "husband's "],
  ["女儿的", "daughter's "],
  ["儿子的", "son's "],
  ["父亲的", "father's "],
  ["母亲的", "mother's "],
  ["哥哥的", "elder brother's "],
  ["弟弟的", "younger brother's "],
  ["姐姐的", "elder sister's "],
  ["妹妹的", "younger sister's "],
  ["兄弟的", "brother's "],
  ["姐妹的", "sister's "],
  ["侄女的", "niece's "],
  ["外甥女的", "niece's "],
];

/** 英文里堂/表不分，一律 cousin；侄子外甥也不分 */
const EN_COUSIN_KINDS = [
  { test: /兄弟|姐|妹|兄|弟/, en: "cousin" },
  { test: /侄女|外甥女/, en: "niece" },
  { test: /侄子|外甥/, en: "nephew" },
  { test: /孙女/, en: "grandniece" },
  { test: /孙/, en: "grandnephew" },
];

/**
 * 中文称谓 → 英文。翻不出就原样返回中文（宁可不翻，也不造词）。
 */
export function localizeTerm(term) {
  if (getLang() !== "en" || !term) return term;
  const text = String(term);
  if (EN_TERM[text]) return EN_TERM[text];

  // 「X世祖」「X世孙」这类按代数生成的
  const genUp = text.match(/^外?(\d+)世祖$/);
  if (genUp) return `${genUp[1]}-generation ancestor`;
  const genDown = text.match(/^外?(\d+)世孙$/);
  if (genDown) return `${genDown[1]}-generation descendant`;

  // 带前缀的复合词：妻子的岳父、侄女的丈夫…
  for (const [prefix, en] of EN_PREFIX) {
    if (text.startsWith(prefix)) {
      const rest = localizeTerm(text.slice(prefix.length));
      if (rest && rest !== text.slice(prefix.length))
        return en + rest.toLowerCase();
    }
  }

  // 堂/表 + 兄弟/姐妹/侄/孙
  if (text.startsWith("堂") || text.startsWith("表")) {
    const bare = text.replace(/（父辈）$/, "");
    for (const kind of EN_COUSIN_KINDS)
      if (kind.test.test(bare)) return kind.en;
  }

  // 「XX（父辈）」
  if (text.endsWith("（父辈）")) {
    const inner = localizeTerm(text.replace(/（父辈）$/, ""));
    if (inner !== text.replace(/（父辈）$/, "")) return inner + " (parent's generation)";
  }

  return text;
}

/**
 * 计算两个人的称谓
 * @returns {{ ok: boolean, tokens: string[], path: string[], term: string, exact: boolean, phrase: string }}
 */
export function kinship(store, fromId, toId) {
  const result = findPath(store, fromId, toId);
  if (!result)
    return {
      ok: false,
      tokens: [],
      path: [],
      term: "",
      exact: false,
      phrase: "",
      linked: false,
    };
  const { term, exact } = describeTokens(result.tokens, store, fromId, toId);
  return {
    ok: true,
    linked: true,
    tokens: result.tokens,
    path: result.path,
    term: localizeTerm(term),
    exact,
    phrase: phraseOf(result.tokens),
  };
}

export { STEP_TEXT };
