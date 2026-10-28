/**
 * 主题：人物卡片的底色、文字色、已故样式，以及连线的颜色和宽度。
 *
 * 这一层只做两件事：
 *   1. 一张预设表（几套配好的配色）；
 *   2. 把一份主题算成一组 CSS 变量（悬停色、描边色这些跟着底色自动推）。
 *
 * 不碰 Obsidian API，可以脱离 Obsidian 单独测。
 */

/** 主题里需要写进元素的所有变量名。切回默认时要逐个删掉，所以得列全 */
export const VAR_KEYS = [
  "--jiapu-male-fill",
  "--jiapu-male-fill-hover",
  "--jiapu-male-stroke",
  "--jiapu-female-fill",
  "--jiapu-female-fill-hover",
  "--jiapu-female-stroke",
  "--jiapu-unknown-fill",
  "--jiapu-unknown-fill-hover",
  "--jiapu-unknown-stroke",
  "--jiapu-card-text",
  "--jiapu-card-text-dim",
  "--jiapu-card-stroke-hover",
  "--jiapu-select-stroke",
  "--jiapu-dead-fill",
  "--jiapu-dead-fill-hover",
  "--jiapu-dead-stroke",
  "--jiapu-dead-stroke-hover",
  "--jiapu-dead-stroke-select",
  "--jiapu-dead-text",
  "--jiapu-dead-text-dim",
  "--jiapu-line",
  "--jiapu-line-strong",
  "--jiapu-spouse",
  "--jiapu-line-w",
  "--jiapu-spouse-w",
  "--jiapu-spouse-w-hover",
  "--jiapu-line-w-other",
];

/* ---------- 颜色工具 ---------- */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** "#abc" / "#aabbcc" / "aabbcc" → {r,g,b}；认不出就是 null */
export function parseHex(value) {
  let text = String(value ?? "").trim().replace(/^#/, "");
  if (text.length === 3)
    text = text
      .split("")
      .map((char) => char + char)
      .join("");
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
  return {
    r: parseInt(text.slice(0, 2), 16),
    g: parseInt(text.slice(2, 4), 16),
    b: parseInt(text.slice(4, 6), 16),
  };
}

export function isHex(value) {
  return Boolean(parseHex(value));
}

const hex2 = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");

export function toHex(color) {
  if (!color) return "#000000";
  return "#" + hex2(color.r) + hex2(color.g) + hex2(color.b);
}

/** 认不出就把 fallback 还回去，调用方永远拿到一个能用的颜色 */
export function safeHex(value, fallback) {
  return isHex(value) ? toHex(parseHex(value)) : fallback;
}

/** a 往 b 靠 ratio（0~1） */
export function mix(a, b, ratio) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return safeHex(a, "#000000");
  const t = clamp(Number(ratio) || 0, 0, 1);
  return toHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  });
}

export const lighten = (color, amount) => mix(color, "#ffffff", amount);
export const darken = (color, amount) => mix(color, "#000000", amount);

/** #2f6bb5 + 0.76 → rgba(47,107,181,0.76) */
export function alpha(color, value) {
  const c = parseHex(color);
  if (!c) return "rgba(0,0,0,0)";
  const a = clamp(Number(value), 0, 1);
  return `rgba(${c.r},${c.g},${c.b},${Math.round(a * 100) / 100})`;
}

/** 相对亮度，0（黑）~1（白），算对比度用 */
export function luminance(color) {
  const c = parseHex(color);
  if (!c) return 0;
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const high = Math.max(la, lb);
  const low = Math.min(la, lb);
  return (high + 0.05) / (low + 0.05);
}

export const isLight = (color) => luminance(color) > 0.45;

/**
 * 在给定底色上挑一个能看清的字色：先用用户选的，实在看不见就按深浅兜底。
 * 阈值 3.2 是「大字号勉强可读」那条线，卡片名字是粗体，够用。
 */
export function readableOn(background, preferred) {
  const fallback = isLight(background) ? "#171a20" : "#f7f8fa";
  if (!isHex(preferred)) return fallback;
  return contrast(background, preferred) >= 3.2 ? toHex(parseHex(preferred)) : fallback;
}

/* ---------- 预设 ---------- */

/**
 * colors 为 null 表示「交给样式表」：那套配色在 Obsidian 明暗主题下各有一份，
 * 跟着系统走最稳，所以默认主题不写死。
 */
export const THEME_PRESETS = [
  {
    id: "classic",
    name: "默认（跟随明暗主题）",
    colors: null,
  },
  {
    id: "ink",
    name: "墨",
    colors: {
      male: "#33414d",
      female: "#6d4147",
      unknown: "#4b525c",
      text: "#f4f5f7",
      deadFill: "#0d0f12",
      deadStroke: "#c9a437",
      line: "#8d97a6",
      spouse: "#a4737f",
      lineWidth: 2,
    },
  },
  {
    id: "amber",
    name: "秋",
    colors: {
      male: "#8a5a2b",
      female: "#a33c3c",
      unknown: "#7a6a55",
      text: "#fdf8ef",
      deadFill: "#1a1410",
      deadStroke: "#d9a441",
      line: "#bda98c",
      spouse: "#b8763f",
      lineWidth: 2,
    },
  },
  {
    id: "forest",
    name: "林",
    colors: {
      male: "#2f6b52",
      female: "#9b4b63",
      unknown: "#5c6b62",
      text: "#f2f7f3",
      deadFill: "#0b1210",
      deadStroke: "#57a37a",
      line: "#8fa89a",
      spouse: "#b07a86",
      lineWidth: 2,
    },
  },
  {
    id: "morandi",
    name: "莫兰迪",
    colors: {
      male: "#7b8ca0",
      female: "#b08a8f",
      unknown: "#9a9a93",
      text: "#fbfbfa",
      deadFill: "#23252a",
      deadStroke: "#c58b8b",
      line: "#c3c2bd",
      spouse: "#b9a2a4",
      lineWidth: 2,
    },
  },
  {
    id: "paper",
    name: "素纸",
    colors: {
      male: "#e9eef7",
      female: "#f8e9ec",
      unknown: "#eef0f3",
      text: "#262b33",
      deadFill: "#2b3038",
      deadStroke: "#c04a52",
      line: "#9aa3b2",
      spouse: "#c99ab0",
      lineWidth: 1.6,
    },
  },
  {
    id: "custom",
    name: "自定义",
    colors: null,
  },
];

export const DEFAULT_CUSTOM = {
  male: "#2f6bb5",
  female: "#b8435c",
  unknown: "#6a7180",
  text: "#f8f9fc",
  deadFill: "#0e0e12",
  deadStroke: "#e0484f",
  line: "#b3bbc9",
  spouse: "#c07f99",
  lineWidth: 2,
};

export const LINE_WIDTH_MIN = 1;
export const LINE_WIDTH_MAX = 4;

export function normalizeWidth(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return DEFAULT_CUSTOM.lineWidth;
  return Math.round(clamp(num, LINE_WIDTH_MIN, LINE_WIDTH_MAX) * 10) / 10;
}

/** 自定义配色补齐 + 校验：缺项、脏数据都退回默认值 */
export function sanitizeColors(input = {}) {
  return {
    male: safeHex(input.male, DEFAULT_CUSTOM.male),
    female: safeHex(input.female, DEFAULT_CUSTOM.female),
    unknown: safeHex(input.unknown, DEFAULT_CUSTOM.unknown),
    text: safeHex(input.text, DEFAULT_CUSTOM.text),
    deadFill: safeHex(input.deadFill, DEFAULT_CUSTOM.deadFill),
    deadStroke: safeHex(input.deadStroke, DEFAULT_CUSTOM.deadStroke),
    line: safeHex(input.line, DEFAULT_CUSTOM.line),
    spouse: safeHex(input.spouse, DEFAULT_CUSTOM.spouse),
    lineWidth: normalizeWidth(input.lineWidth),
  };
}

/** 设置里存的主题对象，缺什么补什么（老版本数据里没有 theme 也认） */
export function normalizeTheme(theme) {
  const raw = theme && typeof theme === "object" ? theme : {};
  const known = THEME_PRESETS.some((item) => item.id === raw.preset);
  return {
    preset: known ? raw.preset : "classic",
    custom: sanitizeColors(raw.custom),
  };
}

/** 当前生效的那套颜色；默认主题返回 null（交给样式表，跟随明暗） */
export function themeColors(theme) {
  const normal = normalizeTheme(theme);
  if (normal.preset === "custom") return normal.custom;
  const preset = THEME_PRESETS.find((item) => item.id === normal.preset);
  return preset?.colors ? sanitizeColors(preset.colors) : null;
}

/**
 * 预览用的那套颜色：默认主题没有自己的配色（交给明暗主题），
 * 但设置页和预览条总得画点什么，就拿基准值顶上。
 */
export function previewColors(theme) {
  return themeColors(theme) ?? sanitizeColors(DEFAULT_CUSTOM);
}

/** 主题名（下拉、设置页里显示用） */
export function themeName(theme) {
  const id = normalizeTheme(theme).preset;
  return THEME_PRESETS.find((item) => item.id === id)?.name ?? "默认（跟随明暗主题）";
}

/**
 * 一份主题 → 一组 CSS 变量。
 * 悬停、描边、强调这些都是从底色推出来的，用户只需要挑几个主色。
 */
export function themeVars(theme) {
  const c = themeColors(theme);
  if (!c) return {};

  const strokeOf = (fill) => darken(fill, 0.22);
  const deadText = readableOn(c.deadFill, c.text);
  const width = c.lineWidth;
  // 悬停/选中描边要「反着来」：深色卡片配白边，浅色卡片配深边，
  // 否则浅色主题下白边等于没有。
  const lightCards = isLight(c.male) && isLight(c.female);
  const hoverStroke = lightCards ? darken(c.text, 0.15) : "#ffffff";
  const selectStroke = lightCards ? darken(c.text, 0.3) : "#ffffff";

  return {
    "--jiapu-male-fill": c.male,
    "--jiapu-male-fill-hover": lighten(c.male, 0.09),
    "--jiapu-male-stroke": strokeOf(c.male),
    "--jiapu-female-fill": c.female,
    "--jiapu-female-fill-hover": lighten(c.female, 0.09),
    "--jiapu-female-stroke": strokeOf(c.female),
    "--jiapu-unknown-fill": c.unknown,
    "--jiapu-unknown-fill-hover": lighten(c.unknown, 0.09),
    "--jiapu-unknown-stroke": strokeOf(c.unknown),
    "--jiapu-card-text": c.text,
    "--jiapu-card-text-dim": alpha(c.text, 0.76),
    "--jiapu-card-stroke-hover": hoverStroke,
    "--jiapu-select-stroke": selectStroke,
    "--jiapu-dead-fill": c.deadFill,
    "--jiapu-dead-fill-hover": lighten(c.deadFill, 0.07),
    "--jiapu-dead-stroke": c.deadStroke,
    "--jiapu-dead-stroke-hover": lighten(c.deadStroke, 0.14),
    "--jiapu-dead-stroke-select": lighten(c.deadStroke, 0.24),
    "--jiapu-dead-text": deadText,
    "--jiapu-dead-text-dim": alpha(deadText, 0.62),
    "--jiapu-line": c.line,
    "--jiapu-line-strong": mix(c.line, isLight(c.line) ? "#000000" : "#ffffff", 0.34),
    "--jiapu-spouse": c.spouse,
    "--jiapu-line-w": String(width),
    "--jiapu-spouse-w": (width * 1.2).toFixed(2),
    "--jiapu-spouse-w-hover": (width * 1.4).toFixed(2),
    "--jiapu-line-w-other": (width * 0.9).toFixed(2),
  };
}

/**
 * 把主题写到某个元素上（一般就是 .jiapu-view）。
 * 先清再写：从自定义切回默认时，残留的行内变量会盖住样式表里那套。
 */
export function applyThemeTo(el, theme) {
  const style = el?.style;
  if (!style) return {};
  for (const key of VAR_KEYS) {
    if (typeof style.removeProperty === "function") style.removeProperty(key);
    else delete style[key];
  }
  const vars = themeVars(theme);
  for (const [key, value] of Object.entries(vars)) {
    if (typeof style.setProperty === "function") style.setProperty(key, value);
    else style[key] = value;
  }
  return vars;
}
