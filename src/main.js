import { Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from "obsidian";
import { GraphStore, emptyGraph, importFromNotes } from "./model.js";
import { buildLayoutMarkdown, exportFileName } from "./export.js";
import { JiapuView, VIEW_TYPE } from "./view.js";
import {
  BackupModal,
  ConfirmModal,
  KinshipModal,
  LayoutsModal,
  ThemeModal,
} from "./modals.js";
import { LANG_OPTIONS, isEn, resolveLang, setLang, t } from "./i18n.js";
import { normalizeTheme, previewColors, themeName } from "./theme.js";
import {
  backupFileName,
  backupSortKey,
  buildBackup,
  formatBytes,
  formatWhen,
  parseBackup,
} from "./backup.js";

const LOG = "[Family Tree] ";

const DEFAULT_SETTINGS = {
  showDates: true,
  snap: true,
  importFolder: "family/家谱",
  exportFolder: "家谱导出",
  backupFolder: "family/家谱备份",
  /** auto | zh | en */
  lang: "auto",
  /** 主题：{ preset, custom }，读的时候一律过一遍 normalizeTheme */
  theme: { preset: "classic" },
};

/** 命令 id → 界面名。切换语言时按这张表批量刷新 */
const COMMANDS = {
  open: "打开家谱图",
  layouts: "管理布局",
  kinship: "亲戚计算器",
  export: "导出当前布局为 Markdown",
  "export-all": "导出全部布局为 Markdown",
  backup: "导出备份",
  restore: "从备份恢复",
  import: "从笔记导入成一个新布局",
};

/** 备份默认目录：设置里清空时兜底用 */
const DEFAULT_BACKUP_FOLDER = "family/家谱备份";

function normalizeFolder(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export default class JiapuPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    setLang(resolveLang(this.settings.lang));
    this.store = new GraphStore(this.app, this);
    await this.store.load();
    // 老数据里「只连了一方」的亲子边已被补成夫妻双方，说一声免得以为是自动改了
    if (this.store.repairedLinks)
      new Notice(
        t("已补全 {n} 条亲属连线（配偶双方）", { n: this.store.repairedLinks }),
      );

    this.registerView(VIEW_TYPE, (leaf) => new JiapuView(leaf, this));

    this.ribbonEl = this.addRibbonIcon("network", t("打开家谱图"), () =>
      void this.activateView(),
    );

    for (const [id, label] of Object.entries(COMMANDS))
      this.addCommand({
        id,
        name: t(label),
        callback: this.commandHandler(id),
      });

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.store.handleRename(file, oldPath);
      }),
    );

    this.addSettingTab(new JiapuSettingTab(this.app, this));
  }

  onunload() {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void this.store?.flush();
  }

  commandHandler(id) {
    switch (id) {
      case "layouts":
        return () => this.openLayouts();
      case "kinship":
        return () => void this.openKinship();
      case "export":
        return () => void this.exportLayout(this.store.activeId);
      case "export-all":
        return () => void this.exportAllLayouts();
      case "backup":
        return () => void this.exportBackup();
      case "restore":
        return () => this.openBackups();
      case "import":
        return () => void this.importGraph();
      default:
        return () => void this.activateView();
    }
  }

  /**
   * 换语言：命令面板里那几条命令的名字是注册时定死的，
   * 这里直接改 app.commands 里的副本，不用重载插件也能立刻看到新名字。
   */
  syncCommandNames() {
    const prefix = (this.manifest?.id ?? "family-tree") + ":";
    for (const [id, label] of Object.entries(COMMANDS)) {
      const command = this.app.commands?.commands?.[prefix + id];
      if (command) command.name = t(label);
    }
    if (this.ribbonEl)
      this.ribbonEl.setAttribute("aria-label", t("打开家谱图"));
  }

  async applyLang() {
    setLang(resolveLang(this.settings.lang));
    this.syncCommandNames();
    this.refreshViews();
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof JiapuView) {
        view.selected = null;
        view.render();
        view.fit();
        // 换语言后标签页标题也要跟着变
        leaf.updateHeader?.();
      }
    }
  }

  // ---------- 主题 ----------

  /** 把主题写到所有打开的家谱视图上：只改 CSS 变量，不重画图 */
  applyTheme() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const view = leaf.view;
      if (view instanceof JiapuView) view.applyTheme();
    }
  }

  /**
   * 换主题：立刻生效，落盘攒一下——
   * 拖颜色滑块时一秒能来几十个 input 事件，每个都写盘没必要。
   */
  setTheme(theme) {
    this.settings.theme = normalizeTheme(theme);
    this.applyTheme();
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveSettings();
    }, 300);
  }

  openTheme() {
    new ThemeModal(this.app, {
      theme: this.settings.theme,
      onApply: (theme) => this.setTheme(theme),
    }).open();
  }

  openLayouts() {
    new LayoutsModal(this.app, {
      store: this.store,
      onOpenLayout: () => this.refreshViews(),
      onExportAll: () => void this.exportAllLayouts(),
    }).open();
  }

  async openKinship() {
    await this.activateView();
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    const view = leaves[0]?.view;
    if (view instanceof JiapuView) view.openKinship(view.selected ?? "");
    else new KinshipModal(this.app, { store: this.store }).open();
  }

  // ---------- 导入 ----------

  async importGraph() {
    const graph = await importFromNotes(this.app, this.settings.importFolder);
    if (!graph.nodes?.length && !graph.layouts?.[0]?.nodes?.length) {
      new Notice(t("这个文件夹里没读到人物，检查一下路径"));
      return;
    }
    const count = graph.layouts[0].nodes.length;
    // 图还是空的就占位，否则作为一个新布局加进来，不动已有的
    if (!this.store.people.length && !this.store.nodes.length) {
      this.store.replaceGraph(graph);
      new Notice(
        t("已从笔记导入 {people} 人、{edges} 条关系", {
          people: count,
          edges: graph.layouts[0].edges.length,
        }),
      );
    } else {
      const layout = this.store.addGraphAsLayout(
        graph,
        isEn() ? "Notes import" : "笔记导入",
      );
      new Notice(
        t("已导入成一个新布局「{name}」：{people} 人、{edges} 条关系", {
          name: layout.name,
          people: layout.nodes.length,
          edges: layout.edges.length,
        }),
      );
    }
    this.refreshViews();
  }

  async clearGraph() {
    this.store.replaceGraph(emptyGraph());
    new Notice(t("已清空当前所有布局"));
    this.refreshViews();
  }

  // ---------- 导出 ----------

  async ensureFolder(folder) {
    if (!folder) return;
    const parts = folder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? current + "/" + part : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing) continue;
      try {
        await this.app.vault.createFolder(current);
      } catch {
        // 并发创建（两个导出同时跑）时会撞车，此时文件夹已经在了，忽略即可；
        // 真写不进去的话，后面那次写入会自己报出来
      }
    }
  }

  async exportLayout(layoutId) {
    const layout = this.store.getLayout(layoutId ?? this.store.activeId);
    if (!layout) {
      new Notice(t("找不到这个布局"));
      return false;
    }
    if (!layout.nodes.length) {
      new Notice(t("布局「{name}」里还没有人", { name: layout.name }));
      return false;
    }
    const folder = normalizeFolder(this.settings.exportFolder);
    const markdown = buildLayoutMarkdown(this.store, layout, {
      alsoLayouts: this.store.layouts
        .filter((item) => item.id !== layout.id)
        .map((item) => ({ name: item.name, remark: item.remark })),
    });
    const path = folder
      ? `${folder}/${exportFileName(layout)}`
      : exportFileName(layout);
    try {
      await this.ensureFolder(folder);
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile)
        await this.app.vault.modify(existing, markdown);
      else await this.app.vault.create(path, markdown);
      new Notice(t("已导出：{path}", { path }));
      return true;
    } catch (error) {
      console.error(LOG + "export failed", error);
      new Notice(
        t("导出失败：{message}", { message: error?.message ?? error }),
      );
      return false;
    }
  }

  async exportAllLayouts() {
    let count = 0;
    for (const layout of this.store.layouts)
      if (await this.exportLayout(layout.id)) count += 1;
    if (count) {
      const folder =
        normalizeFolder(this.settings.exportFolder) || t("库根目录");
      new Notice(t("已导出 {count} 个布局到 {folder}", { count, folder }));
    }
  }

  // ---------- 备份 ----------

  get backupFolder() {
    return normalizeFolder(this.settings.backupFolder) || DEFAULT_BACKUP_FOLDER;
  }

  /** 同一秒里连按两次也不会互相覆盖：重名就往后加 -2、-3 */
  async uniquePath(folder, fileName) {
    const base = fileName.replace(/\.json$/i, "");
    const prefix = folder ? folder + "/" : "";
    let path = prefix + base + ".json";
    let index = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = prefix + base + "-" + index + ".json";
      index += 1;
    }
    return path;
  }

  /** 备份文件本身也是个 TFile，读之前先认一下 */
  backupFileAt(path) {
    const file = this.app.vault.getAbstractFileByPath(String(path));
    return file instanceof TFile ? file : null;
  }

  /**
   * 导出备份：把完整数据（人物库 + 所有布局）写成一个带时间戳的 JSON。
   * 只写新文件，从不动旧备份——删不删由人自己决定。
   */
  async exportBackup(options = {}) {
    const { silent = false, tag = "" } = options;
    const folder = this.backupFolder;
    const now = new Date();
    const data = buildBackup(this.store.snapshot(), this.settings, {
      now,
      pluginVersion: this.manifest?.version ?? "",
    });
    try {
      await this.ensureFolder(folder);
      const path = await this.uniquePath(folder, backupFileName(now, tag));
      // 用 Vault API 而不是 adapter：文件树会立刻刷新，同步和索引也拿得到
      await this.app.vault.create(path, JSON.stringify(data, null, 2));
      if (!silent)
        new Notice(
          t("已备份到 {path}（{people} 人、{layouts} 个布局）", {
            path,
            people: data.counts.people,
            layouts: data.counts.layouts,
          }),
        );
      return path;
    } catch (error) {
      console.error(LOG + "backup failed", error);
      new Notice(t("备份失败：{message}", { message: error?.message ?? error }));
      return null;
    }
  }

  /** 备份目录里的 JSON，新的在前 */
  async listBackups() {
    const folder = this.backupFolder;
    const rows = [];
    const dir = folder ? this.app.vault.getAbstractFileByPath(folder) : this.app.vault.getRoot();
    if (!(dir instanceof TFolder)) return [];
    for (const child of dir.children) {
      if (!(child instanceof TFile)) continue;
      if (!child.path.toLowerCase().endsWith(".json")) continue;
      rows.push({
        path: child.path,
        name: child.name,
        size: Number(child.stat?.size ?? 0),
        mtime: Number(child.stat?.mtime ?? 0),
      });
    }
    // 新的在前：先按文件名里的时间戳（同一秒的按 -2、-3 排），再退回 mtime
    const rank = (row) => backupSortKey(row.name);
    rows.sort((a, b) => {
      const left = rank(a);
      const right = rank(b);
      if (left !== null && right !== null && left !== right)
        return left < right ? 1 : -1;
      if (left === null && right !== null) return 1;
      if (left !== null && right === null) return -1;
      if (a.mtime !== b.mtime) return b.mtime - a.mtime;
      return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
    });
    return rows;
  }

  openBackups() {
    new BackupModal(this.app, {
      plugin: this,
      onBackup: () => void this.exportBackup(),
      onRestore: (path) => void this.restoreBackup(path),
    }).open();
  }

  /** 读文件 → 校验 → 弹确认框（真正落盘在 applyRestore 里） */
  async restoreBackup(path) {
    let text = "";
    try {
      const file = this.backupFileAt(path);
      if (!file) throw new Error(t("文件不存在"));
      text = await this.app.vault.read(file);
    } catch (error) {
      console.error(LOG + "read backup failed", error);
      new Notice(
        t("读不到这个备份：{message}", { message: error?.message ?? error }),
      );
      return false;
    }
    let raw = null;
    try {
      raw = JSON.parse(text);
    } catch {
      new Notice(t("这个文件不是有效的 JSON"));
      return false;
    }
    const parsed = parseBackup(raw);
    if (parsed.error) {
      new Notice(t("这个文件里没有家谱数据"));
      return false;
    }
    const name = String(path).split("/").pop();
    const counts = parsed.info.counts;
    const when = parsed.info.createdAtLocal || formatWhen(parsed.info.createdAt);
    new ConfirmModal(this.app, {
      confirmText: t("恢复备份"),
      message: t(
        "要恢复「{name}」吗？这份备份是 {time} 的，{people} 人、{layouts} 个布局，会覆盖当前的全部数据。恢复前会先把现在的数据另存一份备份，反悔还来得及。",
        {
          name,
          time: when || t("未知时间"),
          people: counts.people,
          layouts: counts.layouts,
        },
      ),
      onConfirm: () => void this.applyRestore(parsed.graph),
    }).open();
    return true;
  }

  async applyRestore(graph) {
    // 先给现在这份留个后路，再动手
    const safety = await this.exportBackup({ tag: "before-restore", silent: true });
    this.store.replaceGraph(graph);
    await this.store.flush();
    this.refreshViews();
    const counts = {
      people: this.store.people.length,
      layouts: this.store.layouts.length,
    };
    new Notice(
      safety
        ? t(
            "已恢复：{people} 人、{layouts} 个布局。恢复前的数据存到了 {path}",
            { ...counts, path: safety },
          )
        : t("已恢复：{people} 人、{layouts} 个布局", counts),
    );
  }

  // ---------- 设置 ----------

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.theme = normalizeTheme(this.settings.theme);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class JiapuSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: t("家谱图") });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "人物资料（姓名、生卒、笔记链接、备注）存在一张全局的人物库里，一张布局只记「谁出现、站哪、谁跟谁有关系」。所以同一个人在几张布局里，双击都打开同一篇笔记。",
      ),
    });
    // 版本号写在这里：升级后一眼能对上，免得「明明改了却没生效」其实是没重载
    containerEl.createEl("p", {
      cls: "jiapu-version",
      text: t("当前版本 {version}", {
        version: this.plugin.manifest?.version ?? "",
      }),
    });

    // 语言放最前面：看不懂界面就没法调后面那些
    new Setting(containerEl)
      .setName(t("界面语言"))
      .setDesc(t("插件界面文案的语言。「自动」跟随 Obsidian 的界面语言。"))
      .addDropdown((dropdown) => {
        for (const option of LANG_OPTIONS)
          dropdown.addOption(option.value, option.label);
        dropdown.setValue(this.plugin.settings.lang ?? "auto");
        dropdown.onChange(async (value) => {
          this.plugin.settings.lang = value;
          await this.plugin.saveSettings();
          await this.plugin.applyLang();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t("显示生日"))
      .setDesc(t("卡片上是否显示出生/去世日期"))
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showDates);
        toggle.onChange(async (value) => {
          this.plugin.settings.showDates = value;
          await this.plugin.saveSettings();
          for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            const view = leaf.view;
            if (view instanceof JiapuView) view.render();
          }
        });
      });

    new Setting(containerEl)
      .setName(t("拖动吸附"))
      .setDesc(
        t("拖动时自动对齐别人的中线、留白和父母中点（也可以按住 Alt 临时关掉）"),
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.snap !== false);
        toggle.onChange(async (value) => {
          this.plugin.settings.snap = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName(t("主题")).setHeading();
    const themeStrip = containerEl.createDiv({ cls: "jiapu-theme-preview" });
    const swatch = (background, stroke) => {
      const chip = themeStrip.createDiv({ cls: "jiapu-theme-chip" });
      chip.style.background = background;
      chip.style.boxShadow = `inset 0 0 0 1px ${stroke}`;
      chip.style.width = "34px";
      chip.style.height = "16px";
    };
    const preview = previewColors(this.plugin.settings.theme);
    swatch(preview.male, preview.male);
    swatch(preview.female, preview.female);
    swatch(preview.deadFill, preview.deadStroke);
    const lineChip = themeStrip.createDiv({ cls: "jiapu-preview-line" });
    lineChip.style.borderTopWidth = `${preview.lineWidth}px`;
    lineChip.style.borderTopColor = preview.line;

    new Setting(containerEl)
      .setName(t("配色与线宽"))
      .setDesc(
        t(
          "人物卡片的颜色、卡片文字、已故样式，连线的颜色和粗细。当前：{name}",
          { name: t(themeName(this.plugin.settings.theme)) },
        ),
      )
      .addButton((button) => {
        button.setButtonText(t("主题…"));
        button.setCta();
        button.onClick(() => this.plugin.openTheme());
      })
      .addButton((button) => {
        button.setButtonText(t("恢复默认"));
        button.onClick(() => {
          this.plugin.setTheme({ preset: "classic" });
          this.display();
        });
      });

    new Setting(containerEl).setName(t("布局")).setHeading();
    const layouts = this.plugin.store.layouts;
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t("当前有 {count} 个布局：{list}", {
        count: layouts.length,
        list: layouts
          .map((item) =>
            t("{name}（{count} 人）", {
              name: item.name,
              count: item.nodes.length,
            }),
          )
          .join(t("、")),
      }),
    });

    new Setting(containerEl)
      .setName(t("管理布局"))
      .setDesc(t("改名、写备注、排序、复制、删除"))
      .addButton((button) => {
        button.setButtonText(t("打开"));
        button.onClick(() => this.plugin.openLayouts());
      });

    new Setting(containerEl).setName(t("导出成 Markdown")).setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "把布局写成一篇笔记：人物表 + 世代 + 家庭 + 婚姻，外加一张「人物｜关系｜相关人」的三元组表，方便自己也方便 AI 直接读文本。每次导出覆盖同名文件。",
      ),
    });

    new Setting(containerEl)
      .setName(t("导出目录"))
      .setDesc(t("相对库根目录，例如 家谱导出；留空则放在库根目录"))
      .addText((text) => {
        text.setValue(this.plugin.settings.exportFolder);
        text.setPlaceholder(t("家谱导出"));
        text.onChange(async (value) => {
          this.plugin.settings.exportFolder = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("导出"))
      .setDesc(t("导出当前布局"))
      .addButton((button) => {
        button.setButtonText(t("导出当前"));
        button.setCta();
        button.onClick(
          () => void this.plugin.exportLayout(this.plugin.store.activeId),
        );
      })
      .addButton((button) => {
        button.setButtonText(t("全部导出"));
        button.onClick(() => void this.plugin.exportAllLayouts());
      });

    new Setting(containerEl).setName(t("备份")).setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "备份是插件自己的一份完整数据（人物库 + 所有布局，站位和关系都在里面），不是一篇给人读的笔记。文件名带时间戳，只会新增，不会覆盖旧备份，也永远不会自动删除。",
      ),
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "注意：备份里不含人物笔记本身。笔记是库里的 Markdown 文件，要另外靠同步或整库备份来保。",
      ),
    });

    new Setting(containerEl)
      .setName(t("备份目录"))
      .setDesc(t("相对库根目录，默认 family/家谱备份"))
      .addText((text) => {
        text.setValue(this.plugin.settings.backupFolder ?? DEFAULT_BACKUP_FOLDER);
        text.setPlaceholder(DEFAULT_BACKUP_FOLDER);
        text.onChange(async (value) => {
          this.plugin.settings.backupFolder = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("导出备份"))
      .setDesc(t("立即把当前全部数据写成一份 JSON"))
      .addButton((button) => {
        button.setButtonText(t("立即备份"));
        button.setCta();
        button.onClick(() => void this.plugin.exportBackup());
      })
      .addButton((button) => {
        button.setButtonText(t("从备份恢复"));
        button.onClick(() => this.plugin.openBackups());
      });

    const backupInfo = containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t("正在读取备份…"),
    });
    void this.plugin.listBackups().then((rows) => {
      if (!backupInfo.isConnected) return;
      if (!rows.length) {
        backupInfo.setText(t("备份目录里还没有备份"));
        return;
      }
      const newest = rows[0];
      const parts = [newest.name];
      const when = formatWhen(newest.mtime);
      if (when) parts.push(when);
      const size = formatBytes(newest.size);
      if (size) parts.push(size);
      backupInfo.setText(
        t("已有 {count} 份备份，最新一份：{name}", {
          count: rows.length,
          name: parts.join(" · "),
        }),
      );
    });

    new Setting(containerEl).setName(t("从笔记导入")).setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "把某个文件夹里的人物笔记一次性读进来（父母、配偶、子女字段），生成一个新布局。这是单向的：导入之后改笔记不会再影响图。",
      ),
    });

    new Setting(containerEl)
      .setName(t("笔记文件夹"))
      .setDesc(t("例如 family/家谱"))
      .addText((text) => {
        text.setValue(this.plugin.settings.importFolder);
        text.onChange(async (value) => {
          this.plugin.settings.importFolder = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("导入"))
      .setDesc(t("会生成一个新布局，已有的布局不受影响"))
      .addButton((button) => {
        button.setButtonText(t("开始导入"));
        button.onClick(() => void this.plugin.importGraph());
      });

    new Setting(containerEl).setName(t("危险操作")).setHeading();
    new Setting(containerEl)
      .setName(t("清空全部布局"))
      .setDesc(t("把所有布局和人都删掉。人物笔记不会被删除。"))
      .addButton((button) => {
        button.setButtonText(t("清空"));
        button.setWarning();
        button.onClick(() => void this.plugin.clearGraph());
      });

    const path = this.plugin.store.filePath;
    if (path)
      containerEl.createEl("p", {
        cls: "setting-item-description",
        text: t("数据文件：{path}", { path }),
      });
  }
}
