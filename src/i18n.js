/**
 * 界面语言
 *
 * 设计取舍：用「中文原文」当 key，而不是 p{...} 这种编号 key。
 * 好处是中文模式下 t() 几乎零成本（原样返回），代码里读到的是能看懂的中文；
 * 代价是改中文文案要同步改词典——所以别随手改 t() 里的中文。
 *
 * 带变量的写法：t("已切到布局「{name}」（{count} 人）", { name, count })
 * 占位符必须两边一致，缺的变量原样留着（方便一眼看出漏了）。
 */

/** 英文词典：键是中文原文，值是英文译文 */
const EN = {
  // ---------- 标点 / 连接 ----------
  "，": ", ",
  "、": ", ",
  "（没有固定叫法）": "(no common term)",

  // ---------- 通用 ----------
  "保存": "Save",
  "取消": "Cancel",
  "关闭": "Close",
  "确定": "OK",
  "删除": "Delete",
  "打开": "Open",
  "复制": "Duplicate",
  "清空": "Clear",
  "上移": "Move up",
  "下移": "Move down",
  "名称": "Name",
  "姓名": "Name",
  "性别": "Sex",
  "男": "Male",
  "女": "Female",
  "未知": "Unknown",
  "生日": "Birth date",
  "出生": "Born",
  "去世": "Died",
  "备注": "Remark",
  "笔记": "Note",
  "必填": "Required",
  "可留空": "Optional",
  "未命名": "Untitled",
  "请输入": "Please enter",
  "筛选": "Filter",
  "状态": "Status",
  "主体": "Subject",
  "关系": "Relation",
  "相关人": "Related person",
  "子女": "Child",
  "配偶": "Spouse",
  "第几代": "Generation",
  "人数": "People",
  "关系数": "Relations",
  "在世": "Living",
  "已故": "Deceased",
  "已故（{date}）": "Deceased ({date})",
  "家谱": "Family Tree",
  "家谱图": "Family Tree",
  "家谱图 · {name}": "Family Tree · {name}",
  "家谱布局": "family-tree-layout",
  "家谱导出": "family-tree-export",
  "布局": "Layouts",
  "布局备注": "Layout remark",
  "布局名称": "Layout name",
  "生成时间": "generated",
  "布局 id": "layout id",
  "父亲": "father",
  "母亲": "mother",
  "库根目录": "vault root",
  "这个节点": "this node",

  // ---------- 工具栏 ----------
  "＋ 人物": "+ Person",
  "＋ 新建布局": "+ New layout",
  "放大": "Zoom in",
  "缩小": "Zoom out",
  "适应窗口": "Fit to window",
  "显示生日": "Show dates",
  "显示/隐藏生日": "Show/hide dates",
  "拖动吸附": "Snap while dragging",
  "吸附已关闭": "Snapping off",
  "吸附已开启": "Snapping on",
  "撤销上一次紧缩": "Undo last compaction",
  "紧缩空间并居中": "Compact and center",
  "紧缩空间并居中（不重排、不改代际）":
    "Compact and center (no re-layout, no generation change)",
  "吸附对齐（拖动时对齐别人的中线、留白和父母中点；按住 Alt 可临时关闭）":
    "Snap alignment (align to others' center lines, gaps and the parents' midpoint; hold Alt to disable)",
  "拖动时自动对齐别人的中线、留白和父母中点（也可以按住 Alt 临时关掉）":
    "Snap to other cards' center lines, gaps and the parents' midpoint while dragging (hold Alt to turn it off temporarily)",
  "拖动卡片：左右挪位置、上下换排（一代人只占一行）· 双击打开笔记 · 右键改关系 · 左上角切换布局":
    "Drag a card: move it sideways, or up/down to change row (one generation per row) · Double-click to open its note · Right-click to edit relations · Top-left to switch layout",
  "点一下：两人左右对调": "Click to swap left/right",

  // ---------- 布局 ----------
  "管理布局": "Manage layouts",
  "管理布局…": "Manage layouts…",
  "管理布局（改名、备注、排序、复制、删除）":
    "Manage layouts (rename, remark, reorder, duplicate, delete)",
  "改名、写备注、排序、复制、删除":
    "Rename, remark, reorder, duplicate, delete",
  "新建布局": "New layout",
  "新建布局…": "New layout…",
  "重命名布局": "Rename layout",
  "重命名当前布局…": "Rename current layout…",
  "编辑布局备注…": "Edit layout remark…",
  "复制当前布局": "Duplicate current layout",
  "切换布局…": "Switch layout…",
  "切换布局 — {tip}": "Switch layout — {tip}",
  "{name}（{count} 人）": "{name} ({count} people)",
  "{count} 人": "{count} people",
  "第 {n} 代": "Generation {n}",
  "第 {n} 代（{count} 人）": "Generation {n} ({count} people)",
  "已切到布局「{name}」（{count} 人）":
    'Switched to layout "{name}" ({count} people)',
  "已补全 {n} 条亲属连线（配偶双方）":
    "Filled in {n} parent link(s) so both spouses are connected",
  "已复制成「{name}」": 'Duplicated as "{name}"',
  "已复制一份布局，位置和关系都带着":
    "Layout duplicated, positions and relations included",
  "已改名为「{name}」": 'Renamed to "{name}"',
  "布局已改名为「{name}」": 'Layout renamed to "{name}"',
  "布局「{name}」里还没有人": 'Layout "{name}" has no one in it yet',
  "已删除布局「{name}」（{count} 人）。人物资料和笔记都没动。":
    'Deleted layout "{name}" ({count} people). Person details and notes are untouched.',
  "备注已保存": "Remark saved",
  "备注（比如：父系、母系、配偶家这边）":
    "Remark (e.g. paternal line, maternal line, spouse's side)",
  "比如：母系、配偶家这边": "e.g. maternal line, spouse's side",
  "这张图是给谁看的、收的是哪一支…":
    "Who this graph is for, which branch it covers…",
  "当前有 {count} 个布局：{list}": "{count} layouts: {list}",
  "一个布局＝一张图：决定「谁出现在这张图上、站在哪一排、跟谁连线」。姓名、生卒、笔记链接、备注存在人物库里，全局共用——同一个人在几张图里，双击都打开同一篇笔记。":
    "A layout is one graph: it decides who appears, which row they stand in, and who links to whom. Names, dates, note links and remarks live in the people library and are shared globally — the same person in several graphs always opens the same note.",

  // ---------- 人物 ----------
  "添加人物": "Add person",
  "添加父亲": "Add father",
  "添加母亲": "Add mother",
  "添加配偶": "Add spouse",
  "添加子女": "Add child",
  "添加兄弟姐妹": "Add sibling",
  "编辑人物": "Edit person",
  "编辑资料…": "Edit details…",
  "删除此人": "Delete this person",
  "删除「{name}」": 'Delete "{name}"',
  "从这张图移除": "Remove from this graph",
  "给「{name}」添加子女": 'Add a child to "{name}"',
  "给「{name}」添加配偶": 'Add a spouse to "{name}"',
  "给「{name}」添加兄弟姐妹": 'Add a sibling to "{name}"',
  "添加父亲：{name}": "Add father of {name}",
  "添加母亲：{name}": "Add mother of {name}",
  "与「{name}」互换左右": 'Swap sides with "{name}"',
  "「{a}」和「{b}」已左右对调": 'Swapped "{a}" and "{b}"',
  "图里还没有人": "Nobody on this graph yet",
  "这张图里还没有人": "Nobody on this graph yet",
  "这张图里还没有人。": "Nobody on this graph yet.",
  "找不到这个布局": "Layout not found",
  "找不到「{note}」，链接先保留，可以稍后再修正":
    'Couldn\'t find "{note}" — keeping the link for now; you can fix it later',
  "已把 {count} 个人加进这张图，位置可以自己拖":
    "Added {count} people to this graph — drag them where you like",
  "人物库里没有别人了——想让同一个人出现在另一张图，先新建一个布局":
    "Nobody else in the people library — to show the same person on another graph, create a new layout first",
  "人物库里没有多余的人了——都是这张图上已有的。":
    "Nobody left in the library — everyone in it is already on this graph.",
  "这个人还出现在另外 {count} 张布局里：这次只从当前布局移除，人物资料、笔记链接和其他布局都不动。":
    "This person also appears in {count} other layouts: they'll only be removed from this one. Details, note links and other layouts stay as they are.",
  "TA 下面还有 {count} 个子女，连线也会一起删掉，子女不会被删除。":
    "They have {count} children below — the links go too, but the children aren't deleted.",
  "与 TA 相连的线会一起删掉。": "Every link to them will be removed too.",
  "TA 还没填父母，新人是独立节点；右键它可添加父母":
    "They have no parents recorded yet, so the new person sits on its own — right-click them to add parents",
  "从人物库添加": "Add from people library",
  "从人物库添加…": "Add from people library…",
  "从人物库添加（别的布局里已经有的人）":
    "Add from the people library (people already used in other layouts)",
  "这些人已经在人物库里（别的布局用过），加进来不会复制资料，笔记链接也是同一份。":
    "These people already exist in the library (used by other layouts). Adding them here doesn't copy anything — the note links stay shared.",
  "加进这张图": "Add to this graph",
  "加进这张图（{count}）": "Add to this graph ({count})",
  "没有匹配的人": "No matches",
  "输入姓名…": "Type a name…",
  "{count} 张图里已有": "in {count} layouts",
  "在 {count} 张图里": "in {count} layouts",
  "生 {date}": "b. {date}",

  // ---------- 批量移除 ----------
  "批量移除卡片": "Remove cards in bulk",
  "批量移除卡片…": "Remove cards in bulk…",
  "批量移除卡片（多选）": "Remove cards in bulk (multi-select)",
  "从这张图移除（{count}）": "Remove from this graph ({count})",
  "全选": "Select all",
  "清空选择": "Clear selection",
  "已选 {count} 人": "{count} selected",
  "这张图上还没有人": "Nobody on this graph yet",
  "只从「{name}」这张图移除，连到 TA 的线会一起断。人物资料和笔记都保留；只有这张图是 TA 唯一出现的地方时，才会从人物库清掉，笔记文件永远不动。":
    'Removes the selected cards from "{name}" only, and the links to them go too. Details and notes are kept — the people-library entry is dropped only when this graph is the only place they appear, and note files are never touched.',
  "已从这张图移除 {count} 人，人物资料和笔记都还在":
    "Removed {count} people from this graph; their details and notes are untouched",
  "已从这张图移除 {count} 人；其中 {forgotten} 人在这张图之外没人用了，资料已清掉（笔记没动）":
    "Removed {count} people from this graph; {forgotten} of them appear nowhere else, so their details were dropped (notes untouched)",

  // ---------- 笔记 ----------
  "关联笔记": "Linked note",
  "关联笔记…": "Link a note…",
  "更换关联笔记…": "Change linked note…",
  "移除关联笔记": "Remove the linked note",
  "打开笔记": "Open note",
  "打开这篇笔记": "Open this note",
  "选择笔记": "Pick a note",
  "清空链接": "Clear the link",
  "搜索并选择要关联的笔记…": "Search for a note to link…",
  "双击卡片就跳到这篇笔记；留空则只是一张卡片":
    "Double-clicking the card opens this note; leave empty to keep it a plain card",
  "留空，或选择一篇笔记": "Leave empty, or pick a note",
  "1995-11-06，可留空": "1995-11-06, optional",
  "随便写点什么，会显示在卡片上":
    "Anything you like — it shows on the card",
  "笔记找不到了，可以右键重新指定":
    "Note not found — right-click to point at another one",
  "笔记找不到了，可以重新指定": "Note not found — you can pick another one",
  "还没有关联到能打开的笔记": "No openable note is linked yet",
  "笔记链接已失效，清除链接": "Dead note link — clear it",
  "改接到别的笔记…": "Point at another note…",
  "「{name}」的失效链接已清除": 'Dead link on "{name}" cleared',
  "已移除「{name}」的笔记链接，卡片还在图上":
    'Removed the note link on "{name}"; the card stays on the graph',
  "已关联「{name}」，双击卡片即可打开":
    'Linked "{name}" — double-click the card to open it',
  "已链接笔记，双击打开：{note}": "Note linked, double-click to open: {note}",

  // ---------- 关系 ----------
  "断开与父母的连线": "Detach from parents",
  "断开配偶连线": "Remove spouse link",
  "断开「{name}」与父母的连线": 'Detach "{name}" from their parents',
  "断开：{name}": "Detach: {name}",
  "断开这一家的全部连线（{count} 条）":
    "Detach this whole family ({count} links)",
  "删除配偶连线（{a} — {b}）": "Remove the spouse link ({a} — {b})",
  "删除关联连线（{a} — {b}）": "Remove the link ({a} — {b})",
  "已断开「{name}」与父母的连线": 'Detached "{name}" from their parents',
  "已断开配偶连线（人还在图上）":
    "Spouse link removed (both people stay on the graph)",
  "连线已删除，人还在图上":
    "Link removed; the person is still on the graph",
  "这一家的亲子连线已全部断开":
    "All parent-child links in this family are removed",

  // ---------- 紧缩 / 撤销 ----------
  "当前版本 {version}": "Version {version}",
  "已去掉空排、收紧间距并居中。不想要就点工具栏的撤销。":
    "Empty rows removed, gaps tightened and centered. Use Undo in the toolbar to revert.",
  "已经很紧凑了：该挨的都挨着了，没有能再收紧的空间":
    "Already as compact as it gets — nothing left to tighten",
  "没有可撤销的紧缩": "Nothing to undo",
  上次紧缩是在另一张布局上做的:
    "The last compaction was done on another layout",
  已还原到紧缩之前的位置:
    "Restored the positions from before the compaction",

  // ---------- 亲戚计算器 ----------
  "亲戚计算器": "Kinship calculator",
  "亲戚计算器…": "Kinship calculator…",
  "亲戚计算器（以 TA 为参照）…":
    "Kinship calculator (using them as the reference)…",
  "我是": "I am",
  "TA 是": "They are",
  "搜索姓名": "Search name",
  "搜索姓名 · 当前：{name}（{gen}）":
    "Search name · current: {name} ({gen})",
  "没有叫「{name}」的人": 'No one called "{name}"',
  "{a} 称呼 {b}：": "{a} calls {b}: ",
  "关系链：{phrase}": "Chain: {phrase}",
  "按这张图的父子 / 配偶关系算称呼。出生日期写了就能分清「哥」和「弟」。点输入框直接打字搜名字，↑↓ 选、回车确认。":
    'Works out how to address someone from the parent and spouse links on this graph. Birth dates are what separate "elder" from "younger" siblings. Click the box and type to search; ↑↓ to move, Enter to confirm.',
  "这两个人在图上连不起来——中间缺亲属关系，右键卡片补上父母、配偶或子女。":
    "These two aren't connected on this graph — right-click a card to add a parent, spouse or child in between.",
  "这是按辈分推的近似叫法，各地叫法不一样。":
    "A rough term based on seniority — wording varies by region.",
  "关系比较远，没有通用称谓，照上面这条链子叫就行。":
    "Too distant for a standard term — follow the chain above.",

  // ---------- 设置页 ----------
  "界面语言": "Interface language",
  "插件界面文案的语言。「自动」跟随 Obsidian 的界面语言。":
    "Language used by this plugin's interface. Auto follows Obsidian's own language.",
  "人物资料（姓名、生卒、笔记链接、备注）存在一张全局的人物库里，一张布局只记「谁出现、站哪、谁跟谁有关系」。所以同一个人在几张布局里，双击都打开同一篇笔记。":
    "Person details (name, dates, note link, remark) live in one global people library; a layout only records who appears, where they stand, and who relates to whom. That's why double-clicking the same person in any layout opens the same note.",
  "卡片上是否显示出生/去世日期":
    "Show birth and death dates on the cards",
  "导出成 Markdown": "Export to Markdown",
  "把布局写成一篇笔记：人物表 + 世代 + 家庭 + 婚姻，外加一张「人物｜关系｜相关人」的三元组表，方便自己也方便 AI 直接读文本。每次导出覆盖同名文件。":
    "Writes a layout out as a note: people table, generations, families, marriages, plus a subject|relation|related table so both you and an AI can read it as plain text. Exporting overwrites the same file.",
  "导出目录": "Export folder",
  "相对库根目录，例如 家谱导出；留空则放在库根目录":
    "Relative to the vault root, e.g. family-tree-export; leave empty for the vault root",
  "导出": "Export",
  "导出当前布局": "Export the current layout",
  "导出当前": "Export current",
  "全部导出": "Export all",
  "导出当前布局为 Markdown": "Export current layout as Markdown",
  "导出全部布局为 Markdown": "Export all layouts as Markdown",
  "从笔记导入成一个新布局": "Import notes into a new layout",
  "从笔记导入": "Import from notes",
  "把某个文件夹里的人物笔记一次性读进来（父母、配偶、子女字段），生成一个新布局。这是单向的：导入之后改笔记不会再影响图。":
    "Reads every person note in a folder at once (parent, spouse and children fields) and builds a new layout. One-way: editing the notes afterwards won't change the graph.",
  "笔记文件夹": "Notes folder",
  "例如 family/家谱": "e.g. family/家谱",
  "导入": "Import",
  "会生成一个新布局，已有的布局不受影响":
    "Creates a new layout; existing layouts are untouched",
  "开始导入": "Start import",
  "危险操作": "Danger zone",
  "清空全部布局": "Clear all layouts",
  "把所有布局和人都删掉。人物笔记不会被删除。":
    "Deletes every layout and everyone on them. Your notes are left alone.",
  "数据文件：{path}": "Data file: {path}",
  "已清空当前所有布局": "All layouts cleared",
  "这个文件夹里没读到人物，检查一下路径":
    "No people found in that folder — check the path",
  "已从笔记导入 {people} 人、{edges} 条关系":
    "Imported {people} people and {edges} relations from notes",
  "已导入成一个新布局「{name}」：{people} 人、{edges} 条关系":
    'Imported into a new layout "{name}": {people} people, {edges} relations',
  "已导出：{path}": "Exported: {path}",
  "导出失败：{message}": "Export failed: {message}",
  "已导出 {count} 个布局到 {folder}":
    "Exported {count} layouts to {folder}",
  "打开家谱图": "Open family tree",
  "全部导出 Markdown": "Export all as Markdown",

  // ---------- 主题 ----------
  "主题": "Theme",
  "主题…": "Theme…",
  "主题（配色、线宽）": "Theme (colours, line width)",
  "配色与线宽": "Colours and line width",
  "预设主题": "Presets",
  "自定义": "Custom",
  "人物卡片": "Person cards",
  "男性卡片": "Male cards",
  "女性卡片": "Female cards",
  "未填性别": "Unspecified sex",
  "卡片文字": "Card text",
  "已故的人": "Deceased",
  "底色": "Background",
  "边框": "Border",
  "连线": "Lines",
  "亲子线": "Parent–child lines",
  "配偶线": "Spouse lines",
  "线宽": "Line width",
  "预览": "Preview",
  "恢复默认": "Reset to default",
  "默认（跟随明暗主题）": "Default (follows light/dark)",
  "墨": "Ink",
  "秋": "Autumn",
  "林": "Forest",
  "莫兰迪": "Morandi",
  "素纸": "Paper",
  "人物卡片的颜色、文字颜色、已故样式，连线的颜色和粗细。点上面的预设立刻生效；改下面的颜色会自动切到「自定义」。":
    "Card colours, text colour, the deceased style, and the colour and thickness of lines. Picking a preset applies it at once; editing a colour below switches to Custom.",
  "人物卡片的颜色、卡片文字、已故样式，连线的颜色和粗细。当前：{name}":
    "Card colours, card text, the deceased style, and the colour and thickness of lines. Current: {name}",

  // ---------- 备份 / 恢复 ----------
  "备份": "Backup",
  "备份与恢复": "Backup and restore",
  "导出备份": "Export backup",
  "导出备份…": "Export backup…",
  "从备份恢复": "Restore from backup",
  "从备份恢复…": "Restore from backup…",
  "导出备份（所有布局 + 人物库，存成一个 JSON）":
    "Export a backup (all layouts + the people library, as one JSON)",
  "从备份恢复（列表里挑一份）":
    "Restore from a backup (pick one from the list)",
  "恢复备份": "Restore backup",
  "恢复": "Restore",
  "立即备份": "Back up now",
  "备份目录": "Backup folder",
  "备份目录：{path}": "Backup folder: {path}",
  "相对库根目录，默认 family/家谱备份":
    "Relative to the vault root. Default: family/家谱备份",
  "立即把当前全部数据写成一份 JSON":
    "Write all current data to a JSON file right away",
  "正在读取备份…": "Reading backups…",
  "备份目录里还没有备份": "No backups in the backup folder yet",
  "已有 {count} 份备份，最新一份：{name}":
    "{count} backups so far · newest: {name}",
  "备份是插件自己的一份完整数据（人物库 + 所有布局，站位和关系都在里面），不是一篇给人读的笔记。文件名带时间戳，只会新增，不会覆盖旧备份，也永远不会自动删除。":
    "A backup is this plugin's own complete data — the shared people library plus every layout, positions and relations included. It is not a note meant for reading. File names carry a timestamp, so new backups never overwrite old ones, and nothing is ever deleted automatically.",
  "注意：备份里不含人物笔记本身。笔记是库里的 Markdown 文件，要另外靠同步或整库备份来保。":
    "Note: the backup does not contain the person notes themselves. Those are Markdown files in your vault — protect them with sync or a full-vault backup.",
  "已备份到 {path}（{people} 人、{layouts} 个布局）":
    "Backed up to {path} ({people} people, {layouts} layouts)",
  "备份失败：{message}": "Backup failed: {message}",
  "文件不存在": "File not found",
  "读不到这个备份：{message}": "Cannot read this backup: {message}",
  "这个文件不是有效的 JSON": "This file is not valid JSON",
  "这个文件里没有家谱数据": "No family tree data in this file",
  "未知时间": "an unknown time",
  "要恢复「{name}」吗？这份备份是 {time} 的，{people} 人、{layouts} 个布局，会覆盖当前的全部数据。恢复前会先把现在的数据另存一份备份，反悔还来得及。":
    'Restore "{name}"? This backup is from {time}, with {people} people and {layouts} layouts, and it will replace everything you have now. Your current data is saved to a fresh backup right before restoring, so you can still go back.',
  "已恢复：{people} 人、{layouts} 个布局。恢复前的数据存到了 {path}":
    "Restored {people} people and {layouts} layouts. The data from before the restore was saved to {path}",
  "已恢复：{people} 人、{layouts} 个布局":
    "Restored {people} people and {layouts} layouts",

  // ---------- 导出文件 ----------
  "一、人物": "1. People",
  "二、按世代": "2. By generation",
  "三、家庭（父母 → 子女）": "3. Families (parents → children)",
  "四、婚姻": "4. Marriages",
  "五、关系明细（机器可读）": "5. Relations in detail (machine-readable)",
  "每行读作：**主体** 的 **关系** 是 **相关人**。":
    "Each row reads: the **relation** of **subject** is **related person**.",
  "这张图里还没有父子关系。": "No parent-child relations on this graph yet.",
  "这张图里还没有配偶关系。": "No spouse relations on this graph yet.",
  "附：本库的其他家谱布局": "Appendix: other layouts in this vault",
  "由家谱图插件生成": "Generated by the Family Tree plugin",
  "本文件由「家谱图」插件导出，是一次性快照——改这里不会回流到图里；要改请在 Obsidian 里打开家谱图拖动或编辑。人物的笔记链接在同一个 vault 内全局共用，同一个人出现在几张布局里都指向同一篇笔记。":
    "Exported by the Family Tree plugin as a one-off snapshot — editing this file does not flow back into the graph. To change things, open the graph in Obsidian and drag or edit there. Note links are shared across the whole vault, so the same person points at the same note in every layout.",
};

const LANG_LABEL = { auto: "自动 / Auto", zh: "简体中文", en: "English" };

let current = "zh";

/** 把设置里的 auto 解析成实际语言 */
export function resolveLang(setting) {
  if (setting === "zh" || setting === "en") return setting;
  if (typeof window === "undefined") return "zh";
  let raw = "";
  try {
    raw = String(window.localStorage?.getItem("language") ?? "");
  } catch (error) {
    raw = "";
  }
  if (!raw) raw = String(globalThis.navigator?.language ?? "");
  const low = raw.toLowerCase();
  if (low.startsWith("zh")) return "zh";
  if (low.startsWith("en")) return "en";
  return "zh";
}

export function setLang(lang) {
  current = lang === "en" ? "en" : "zh";
  if (typeof document !== "undefined" && document.body)
    document.body.setAttribute("data-jiapu-lang", current);
  return current;
}

export function getLang() {
  return current;
}

export function isEn() {
  return current === "en";
}

/** 语言显示名，给设置页的下拉框用（这一项本身不翻译） */
export function langLabel(key) {
  return LANG_LABEL[key] ?? key;
}

export const LANG_OPTIONS = [
  { value: "auto", label: LANG_LABEL.auto },
  { value: "zh", label: LANG_LABEL.zh },
  { value: "en", label: LANG_LABEL.en },
];

/**
 * 翻译一个界面字符串。
 * @param {string} text 中文原文（同时也是词典的键）
 * @param {Record<string, unknown>} [vars] 占位符取值
 */
export function t(text, vars) {
  const source = String(text ?? "");
  let out = current === "en" ? EN[source] ?? source : source;
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (whole, key) =>
      vars[key] === undefined || vars[key] === null ? whole : String(vars[key]),
    );
  }
  return out;
}

/** 只取英文译文，不给就回退中文——给「两种语言都要写出来」的场合用 */
export function en(text) {
  return EN[String(text ?? "")] ?? String(text ?? "");
}

/** 调试用：列出还没翻译的 key */
export function missingKeys(keys) {
  return keys.filter((key) => !EN[key]);
}

export { EN };
