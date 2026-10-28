/**
 * 家谱图 · 编辑界面
 */
import {
  FuzzySuggestModal,
  Modal,
  Notice,
  Setting,
  TFile,
  setIcon,
} from "obsidian";
import { kinship } from "./kinship.js";
import { isDeceased } from "./model.js";
import { formatBytes, formatWhen } from "./backup.js";
import {
  DEFAULT_CUSTOM,
  LINE_WIDTH_MAX,
  LINE_WIDTH_MIN,
  THEME_PRESETS,
  normalizeTheme,
  previewColors,
  readableOn,
  sanitizeColors,
  themeColors,
} from "./theme.js";
import { t } from "./i18n.js";

class NotePickerModal extends FuzzySuggestModal {
  constructor(app, onPick) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder(t("搜索并选择要关联的笔记…"));
  }

  getItems() {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file) {
    this.onPick(file);
  }
}

export function pickNote(app, onPick) {
  new NotePickerModal(app, onPick).open();
}

/** 性别选项要跟着语言走，所以每次都现取 */
function sexOptions() {
  return [
    { value: "male", label: t("男") },
    { value: "female", label: t("女") },
    { value: "unknown", label: t("未知") },
  ];
}

/** 性别显示名 */
export function sexLabel(sex) {
  return t(sex === "male" ? "男" : sex === "female" ? "女" : "未知");
}

/**
 * 新建 / 编辑一个节点
 * resolve(改动对象 | null)
 */
export class NodeModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.node = options.node ?? null;
    this.title = options.title ?? (this.node ? t("编辑人物") : t("添加人物"));
    this.onSubmit = options.onSubmit ?? null;
    this.onDelete = options.onDelete ?? null;
    this.draft = {
      name: this.node?.name ?? "",
      sex: this.node?.sex ?? "unknown",
      birth: this.node?.birth ?? "",
      death: this.node?.death ?? "",
      remark: this.node?.remark ?? "",
      note: this.node?.note ?? "",
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jiapu-modal");
    contentEl.createEl("h3", { text: this.title });

    new Setting(contentEl).setName(t("姓名")).addText((text) => {
      text.setValue(this.draft.name);
      text.setPlaceholder(t("必填"));
      text.onChange((value) => (this.draft.name = value.trim()));
      text.inputEl.focus();
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") this.submit();
      });
    });

    new Setting(contentEl).setName(t("性别")).addDropdown((dropdown) => {
      for (const option of sexOptions())
        dropdown.addOption(option.value, option.label);
      dropdown.setValue(this.draft.sex);
      dropdown.onChange((value) => (this.draft.sex = value));
    });

    new Setting(contentEl).setName(t("生日")).addText((text) => {
      text.setValue(this.draft.birth);
      text.setPlaceholder(t("1995-11-06，可留空"));
      text.onChange((value) => (this.draft.birth = value.trim()));
    });

    new Setting(contentEl).setName(t("去世")).addText((text) => {
      text.setValue(this.draft.death);
      text.setPlaceholder(t("可留空"));
      text.onChange((value) => (this.draft.death = value.trim()));
    });

    new Setting(contentEl).setName(t("备注")).addTextArea((area) => {
      area.setValue(this.draft.remark);
      area.setPlaceholder(t("随便写点什么，会显示在卡片上"));
      area.inputEl.rows = 2;
      area.onChange((value) => (this.draft.remark = value));
    });

    const noteSetting = new Setting(contentEl)
      .setName(t("关联笔记"))
      .setDesc(t("双击卡片就跳到这篇笔记；留空则只是一张卡片"));
    noteSetting.addText((text) => {
      text.setValue(this.draft.note);
      text.setPlaceholder(t("留空，或选择一篇笔记"));
      text.onChange((value) => (this.draft.note = value.trim()));
      this.noteInput = text.inputEl;
    });
    noteSetting.addExtraButton((button) => {
      button.setIcon("search");
      button.setTooltip(t("选择笔记"));
      button.onClick(() => {
        pickNote(this.app, (file) => {
          this.draft.note = file.path;
          if (this.noteInput) this.noteInput.value = file.path;
          if (!this.draft.name) this.draft.name = file.basename;
        });
      });
    });
    noteSetting.addExtraButton((button) => {
      button.setIcon("file-text");
      button.setTooltip(t("打开这篇笔记"));
      button.onClick(() => {
        if (!openNote(this.app, this.draft.note))
          new Notice(t("还没有关联到能打开的笔记"));
      });
    });
    noteSetting.addExtraButton((button) => {
      button.setIcon("x");
      button.setTooltip(t("清空链接"));
      button.onClick(() => {
        this.draft.note = "";
        if (this.noteInput) this.noteInput.value = "";
      });
    });

    const footer = contentEl.createDiv({ cls: "jiapu-modal-footer" });
    if (this.node && this.onDelete) {
      const remove = footer.createEl("button", {
        text: t("删除此人"),
        cls: "mod-warning",
      });
      remove.addEventListener("click", () => {
        const node = this.node;
        this.close();
        this.onDelete(node);
      });
    }
    const spacer = footer.createDiv({ cls: "jiapu-spacer" });
    void spacer;
    const cancel = footer.createEl("button", { text: t("取消") });
    cancel.addEventListener("click", () => this.close());
    const submit = footer.createEl("button", {
      text: t("保存"),
      cls: "mod-cta",
    });
    submit.addEventListener("click", () => this.submit());
  }

  submit() {
    if (!this.draft.name) {
      this.draft.name = t("未命名");
    }
    const payload = { ...this.draft };
    // 找不到的链接不静默丢弃——保留下来，但明确提醒
    if (payload.note && !noteExists(this.app, payload.note))
      new Notice(
        t("找不到「{note}」，链接先保留，可以稍后再修正", {
          note: payload.note,
        }),
      );
    this.close();
    this.onSubmit?.(payload);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class ConfirmModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.message = options.message ?? "";
    this.confirmText = options.confirmText ?? t("确定");
    this.onConfirm = options.onConfirm ?? null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.confirmText });
    contentEl.createEl("p", { text: this.message });
    const footer = contentEl.createDiv({ cls: "jiapu-modal-footer" });
    footer.createDiv({ cls: "jiapu-spacer" });
    const cancel = footer.createEl("button", { text: t("取消") });
    cancel.addEventListener("click", () => this.close());
    const ok = footer.createEl("button", {
      text: this.confirmText,
      cls: "mod-warning",
    });
    ok.addEventListener("click", () => {
      this.close();
      this.onConfirm?.();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function iconButton(parent, icon, tooltip, onClick, cls = "") {
  const button = parent.createEl("button", {
    cls: "jiapu-tool" + (cls ? " " + cls : ""),
  });
  const holder = button.createSpan({ cls: "jiapu-tool-icon" });
  setIcon(holder, icon);
  // 图标名落到属性上：截图/测试能看出到底画的哪个图标
  button.setAttribute("data-icon", icon);
  if (tooltip) button.setAttribute("aria-label", tooltip);
  button.addEventListener("click", onClick);
  return button;
}

export function textButton(parent, label, onClick) {
  const button = parent.createEl("button", {
    cls: "jiapu-tool jiapu-tool-text",
  });
  button.createSpan({ text: label });
  button.addEventListener("click", onClick);
  return button;
}

export function noteExists(app, path) {
  if (!path) return false;
  return Boolean(
    app.metadataCache.getFirstLinkpathDest(path, "") ||
      app.vault.getAbstractFileByPath(path),
  );
}

export function openNote(app, path) {
  const file =
    app.metadataCache.getFirstLinkpathDest(path, "") ??
    app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    void app.workspace.getLeaf(false).openFile(file);
    return true;
  }
  return false;
}

/**
 * 单行 / 多行输入弹窗
 */
export class PromptModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.title = options.title ?? t("请输入");
    this.label = options.label ?? "";
    this.value = options.value ?? "";
    this.placeholder = options.placeholder ?? "";
    this.multiline = Boolean(options.multiline);
    this.onSubmit = options.onSubmit ?? null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jiapu-modal");
    contentEl.createEl("h3", { text: this.title });
    const setting = new Setting(contentEl).setName(this.label);
    if (this.multiline) {
      setting.addTextArea((area) => {
        area.setValue(this.value);
        area.setPlaceholder(this.placeholder);
        area.inputEl.rows = 3;
        area.onChange((value) => (this.value = value));
        area.inputEl.focus();
      });
    } else {
      setting.addText((text) => {
        text.setValue(this.value);
        text.setPlaceholder(this.placeholder);
        text.onChange((value) => (this.value = value));
        text.inputEl.focus();
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") this.submit();
        });
      });
    }
    const footer = contentEl.createDiv({ cls: "jiapu-modal-footer" });
    footer.createDiv({ cls: "jiapu-spacer" });
    const cancel = footer.createEl("button", { text: t("取消") });
    cancel.addEventListener("click", () => this.close());
    const ok = footer.createEl("button", { text: t("保存"), cls: "mod-cta" });
    ok.addEventListener("click", () => this.submit());
  }

  submit() {
    const value = this.value;
    this.close();
    this.onSubmit?.(value);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export function promptText(app, options) {
  new PromptModal(app, options).open();
}

/**
 * 管理布局：改名、写备注、上下挪、复制、删除
 */
export class LayoutsModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.store = options.store;
    this.onExportAll = options.onExportAll ?? null;
    this.onOpenLayout = options.onOpenLayout ?? null;
    this.unsubscribe = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jiapu-modal");
    contentEl.addClass("jiapu-layouts-modal");
    // 有些主题会把 .modal 撑到超出屏幕（输入框 width:100% 撑出来的），
    // 这里把外层宽度钉死；同时把「内容自己」的宽度也钉住——
    // 有的主题用 !important 盖掉 .modal 的宽度，只压外层是压不住的，
    // 内容不撑宽，弹窗才真的不会跑出屏幕。
    if (this.modalEl) {
      this.modalEl.style.width = "min(720px, 94vw)";
      this.modalEl.style.maxWidth = "94vw";
      this.modalEl.style.boxSizing = "border-box";
    }
    contentEl.style.width = "min(680px, calc(94vw - 44px))";
    contentEl.style.maxWidth = "calc(94vw - 44px)";
    contentEl.style.minWidth = "0";
    contentEl.style.boxSizing = "border-box";
    contentEl.createEl("h3", { text: t("管理布局") });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "一个布局＝一张图：决定「谁出现在这张图上、站在哪一排、跟谁连线」。姓名、生卒、笔记链接、备注存在人物库里，全局共用——同一个人在几张图里，双击都打开同一篇笔记。",
      ),
    });
    this.listEl = contentEl.createDiv({ cls: "jiapu-layout-list" });
    this.renderList();

    const footer = contentEl.createDiv({ cls: "jiapu-modal-footer" });
    const add = footer.createEl("button", { text: t("＋ 新建布局") });
    add.addEventListener("click", () => {
      const layout = this.store.createLayout();
      this.onOpenLayout?.(layout.id);
      this.renderList();
    });
    if (this.onExportAll) {
      const exportAll = footer.createEl("button", {
        text: t("全部导出 Markdown"),
      });
      exportAll.addEventListener("click", () => this.onExportAll());
    }
    footer.createDiv({ cls: "jiapu-spacer" });
    const close = footer.createEl("button", {
      text: t("关闭"),
      cls: "mod-cta",
    });
    close.addEventListener("click", () => this.close());
  }

  renderList() {
    if (!this.listEl) return;
    this.listEl.empty();
    const layouts = this.store.layouts;
    layouts.forEach((layout, index) => {
      const row = this.listEl.createDiv({ cls: "jiapu-layout-row" });
      if (layout.id === this.store.activeId) row.addClass("is-active");

      const head = row.createDiv({ cls: "jiapu-layout-head" });
      const badge = head.createSpan({ cls: "jiapu-layout-index" });
      badge.setText(String(index + 1));

      const nameInput = head.createEl("input", {
        type: "text",
        cls: "jiapu-layout-name",
      });
      nameInput.value = layout.name;
      nameInput.addEventListener("change", () => {
        if (this.store.renameLayout(layout.id, nameInput.value)) {
          new Notice(t("布局已改名为「{name}」", { name: layout.name }));
        } else {
          nameInput.value = layout.name;
        }
      });

      const count = head.createSpan({ cls: "jiapu-layout-count" });
      count.setText(t("{count} 人", { count: layout.nodes.length }));

      const actions = head.createDiv({ cls: "jiapu-layout-actions" });
      if (layout.id !== this.store.activeId) {
        const open = actions.createEl("button", { text: t("打开") });
        open.addEventListener("click", () => {
          this.store.activateLayout(layout.id);
          this.onOpenLayout?.(layout.id);
          this.renderList();
        });
      }
      const up = actions.createEl("button", { cls: "jiapu-icon-btn" });
      setIcon(up, "arrow-up");
      up.setAttribute("aria-label", t("上移"));
      up.disabled = index === 0;
      up.addEventListener("click", () => {
        this.store.moveLayout(layout.id, -1);
        this.renderList();
      });
      const down = actions.createEl("button", { cls: "jiapu-icon-btn" });
      setIcon(down, "arrow-down");
      down.setAttribute("aria-label", t("下移"));
      down.disabled = index === layouts.length - 1;
      down.addEventListener("click", () => {
        this.store.moveLayout(layout.id, 1);
        this.renderList();
      });
      const copy = actions.createEl("button", { text: t("复制") });
      copy.addEventListener("click", () => {
        this.store.duplicateLayout(layout.id);
        this.renderList();
        new Notice(t("已复制一份布局，位置和关系都带着"));
      });
      const remove = actions.createEl("button", {
        text: t("删除"),
        cls: "mod-warning",
      });
      remove.disabled = layouts.length <= 1;
      remove.addEventListener("click", () => {
        const name = layout.name;
        const count2 = layout.nodes.length;
        this.store.removeLayout(layout.id);
        this.renderList();
        new Notice(
          t("已删除布局「{name}」（{count} 人）。人物资料和笔记都没动。", {
            name,
            count: count2,
          }),
        );
      });

      const remark = row.createEl("input", {
        type: "text",
        cls: "jiapu-layout-remark",
      });
      remark.value = layout.remark ?? "";
      remark.placeholder = t("备注（比如：父系、母系、配偶家这边）");
      remark.addEventListener("change", () => {
        this.store.setLayoutRemark(layout.id, remark.value);
      });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * 可整行点击的勾选行。
 *
 * 复选框只当「状态显示」，指针事件全交给整行：这样点名字、点空白都能选中，
 * 也不会出现「点一下等于点两下」的抵消。回车 / 空格同样能勾。
 */
function checkRow(listEl, options = {}) {
  const checked = Boolean(options.checked);
  const row = listEl.createDiv({
    cls: "jiapu-pick-row" + (checked ? " is-checked" : ""),
    attr: {
      role: "checkbox",
      "aria-checked": checked ? "true" : "false",
      tabindex: "0",
    },
  });
  const box = row.createEl("input", { type: "checkbox" });
  box.checked = checked;
  box.tabIndex = -1;
  box.setAttribute("aria-hidden", "true");
  const text = row.createSpan({ cls: "jiapu-pick-text" });

  // 状态记在闭包里，不靠读 classList——读类名容易被主题/样式改动带偏
  let on = checked;
  /** 画成 next；返回「真的变了没有」，避免复选框和整行两条路各回调一次 */
  const paint = (next) => {
    const value = Boolean(next);
    const changed = value !== on;
    on = value;
    if (box.checked !== on) box.checked = on;
    row.classList.toggle("is-checked", on);
    row.setAttribute("aria-checked", on ? "true" : "false");
    return changed;
  };
  // 点复选框：浏览器已经替我们翻过了，照它的结果同步；
  // 点行的其他地方：自己翻。两条路都能勾，谁先到都不打架。
  row.addEventListener("click", (event) => {
    const viaBox = event.target === box;
    if (paint(viaBox ? box.checked : !on)) options.onToggle?.(on);
  });
  // 键盘在复选框上按空格时，click 不一定会冒到行上，这里兜一次
  box.addEventListener("change", () => {
    if (paint(box.checked)) options.onToggle?.(on);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (paint(!on)) options.onToggle?.(on);
  });
  return { row, box, text, paint, isChecked: () => on };
}

/** 「全选 / 清空选择 + 已选几个」那一行按钮，两个弹窗共用 */
function buildPickTools(contentEl, options = {}) {
  const tools = contentEl.createDiv({ cls: "jiapu-pick-tools" });
  const all = tools.createEl("button", { text: t("全选") });
  all.addEventListener("click", () => options.onAll?.(true));
  const none = tools.createEl("button", { text: t("清空选择") });
  none.addEventListener("click", () => options.onAll?.(false));
  const countEl = tools.createSpan({ cls: "jiapu-pick-count" });
  return {
    countEl,
    sync: (count) => countEl.setText(t("已选 {count} 人", { count })),
  };
}

/**
 * 从人物库挑人加进当前布局
 */
export class PeoplePickerModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.store = options.store;
    this.onPick = options.onPick ?? null;
    this.selected = new Set();
    this.keyword = "";
    this.visible = [];
    this.okButton = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jiapu-modal");
    contentEl.addClass("jiapu-pick-modal");
    contentEl.createEl("h3", { text: t("从人物库添加") });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "这些人已经在人物库里（别的布局用过），加进来不会复制资料，笔记链接也是同一份。",
      ),
    });

    const search = new Setting(contentEl).setName(t("筛选"));
    search.addText((text) => {
      text.setPlaceholder(t("输入姓名…"));
      text.onChange((value) => {
        this.keyword = value.trim();
        this.renderList();
      });
      text.inputEl.focus();
    });

    this.tools = buildPickTools(contentEl, {
      onAll: (on) => this.setAllVisible(on),
    });
    this.listEl = contentEl.createDiv({ cls: "jiapu-pick-list" });
    this.renderList();

    const footer = contentEl.createDiv({ cls: "jiapu-modal-footer" });
    footer.createDiv({ cls: "jiapu-spacer" });
    const cancel = footer.createEl("button", { text: t("取消") });
    cancel.addEventListener("click", () => this.close());
    const ok = footer.createEl("button", {
      text: t("加进这张图"),
      cls: "mod-cta",
    });
    this.okButton = ok;
    ok.addEventListener("click", () => {
      const ids = [...this.selected];
      if (!ids.length) return;
      this.close();
      this.onPick?.(ids);
    });
    this.syncFooter();
  }

  /** 当前筛选结果全选 / 全不选 */
  setAllVisible(on) {
    for (const person of this.visible) {
      if (on) this.selected.add(person.id);
      else this.selected.delete(person.id);
    }
    this.renderList();
  }

  syncFooter() {
    const count = this.selected.size;
    if (this.okButton) {
      this.okButton.setText(
        count
          ? t("加进这张图（{count}）", { count })
          : t("加进这张图"),
      );
      this.okButton.disabled = count === 0;
    }
    this.tools?.sync(count);
  }

  renderList() {
    if (!this.listEl) return;
    this.listEl.empty();
    const candidates = this.store
      .peopleNotInLayout()
      .filter((person) => !this.keyword || person.name.includes(this.keyword))
      .sort((a, b) => a.name.localeCompare(b.name, "zh"));
    this.visible = candidates;
    if (!candidates.length) {
      this.listEl.createEl("p", {
        cls: "setting-item-description",
        text: this.keyword
          ? t("没有匹配的人")
          : t("人物库里没有多余的人了——都是这张图上已有的。"),
      });
      this.syncFooter();
      return;
    }
    for (const person of candidates) {
      const meta = [
        sexLabel(person.sex),
        person.birth ? t("生 {date}", { date: person.birth }) : "",
        isDeceased(person) ? t("已故") : "",
        t("在 {count} 张图里", {
          count: this.store.layoutCountOf(person.id),
        }),
      ].filter(Boolean);
      const label = `${person.name}　${meta.join(" · ")}`;
      const line = checkRow(this.listEl, {
        checked: this.selected.has(person.id),
        onToggle: (on) => {
          if (on) this.selected.add(person.id);
          else this.selected.delete(person.id);
          this.syncFooter();
        },
      });
      line.text.setText(label);
      line.text.setAttribute("title", label);
    }
    this.syncFooter();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * 批量把卡片从当前布局移除。
 * 只动这张图：连线一起断，人物资料和笔记留着（除非这张图是 TA 唯一出现的地方）。
 */
export class RemovePeopleModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.store = options.store;
    this.onRemove = options.onRemove ?? null;
    this.selected = new Set();
    this.keyword = "";
    this.visible = [];
    this.okButton = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jiapu-modal");
    contentEl.addClass("jiapu-pick-modal");
    const layout = this.store.activeLayout;
    contentEl.createEl("h3", { text: t("批量移除卡片") });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "只从「{name}」这张图移除，连到 TA 的线会一起断。人物资料和笔记都保留；只有这张图是 TA 唯一出现的地方时，才会从人物库清掉，笔记文件永远不动。",
        { name: layout.name },
      ),
    });

    const search = new Setting(contentEl).setName(t("筛选"));
    search.addText((text) => {
      text.setPlaceholder(t("输入姓名…"));
      text.onChange((value) => {
        this.keyword = value.trim();
        this.renderList();
      });
      text.inputEl.focus();
    });

    this.tools = buildPickTools(contentEl, {
      onAll: (on) => this.setAllVisible(on),
    });
    this.listEl = contentEl.createDiv({ cls: "jiapu-pick-list" });
    this.renderList();

    const footer = contentEl.createDiv({ cls: "jiapu-modal-footer" });
    footer.createDiv({ cls: "jiapu-spacer" });
    const cancel = footer.createEl("button", { text: t("取消") });
    cancel.addEventListener("click", () => this.close());
    const ok = footer.createEl("button", {
      text: t("从这张图移除"),
      cls: "mod-warning",
    });
    this.okButton = ok;
    ok.addEventListener("click", () => {
      const ids = [...this.selected];
      if (!ids.length) return;
      this.close();
      this.onRemove?.(ids);
    });
    this.syncFooter();
  }

  setAllVisible(on) {
    for (const person of this.visible) {
      if (on) this.selected.add(person.id);
      else this.selected.delete(person.id);
    }
    this.renderList();
  }

  syncFooter() {
    const count = this.selected.size;
    if (this.okButton) {
      this.okButton.setText(
        count
          ? t("从这张图移除（{count}）", { count })
          : t("从这张图移除"),
      );
      this.okButton.disabled = count === 0;
    }
    this.tools?.sync(count);
  }

  renderList() {
    if (!this.listEl) return;
    this.listEl.empty();
    const people = this.store.nodes
      .filter((node) => !this.keyword || node.name.includes(this.keyword))
      .slice()
      .sort(
        (a, b) =>
          (a.row ?? 0) - (b.row ?? 0) ||
          a.name.localeCompare(b.name, "zh"),
      );
    this.visible = people;
    if (!people.length) {
      this.listEl.createEl("p", {
        cls: "setting-item-description",
        text: this.keyword ? t("没有匹配的人") : t("这张图上还没有人"),
      });
      this.syncFooter();
      return;
    }
    for (const node of people) {
      const meta = [
        sexLabel(node.sex),
        node.birth ? t("生 {date}", { date: node.birth }) : "",
        isDeceased(node) ? t("已故") : "",
        t("在 {count} 张图里", { count: this.store.layoutCountOf(node.id) }),
      ].filter(Boolean);
      const label = `${node.name}　${meta.join(" · ")}`;
      const line = checkRow(this.listEl, {
        checked: this.selected.has(node.id),
        onToggle: (on) => {
          if (on) this.selected.add(node.id);
          else this.selected.delete(node.id);
          this.syncFooter();
        },
      });
      line.text.setText(label);
      line.text.setAttribute("title", label);
    }
    this.syncFooter();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * 带搜索的人物选择框（替代只能滚动下拉的 select）
 *
 * 点一下就把全表铺开，边打字边筛；↑↓ 挪、回车定、Esc 收。
 * 返回的对象里 query() 是给测试用的：直接喂关键词，返回命中的节点数组。
 */
function personSearch(container, config) {
  const people = config.people ?? [];
  const byId = new Map(people.map((node) => [node.id, node]));
  // 列表最高就 6 行（4px 内边距 + 2px 边框 + 6×28 = 178），再高得靠滚
  const LIST_MAX = 178;
  let selectedId = byId.has(config.value) ? config.value : people[0]?.id ?? null;
  let hits = [];
  let activeIndex = 0;
  let open = false;
  // 列表贴着输入框悬浮，往下没地方就翻到上方展开——都不占文档流，弹窗不会跟着长高
  let above = false;
  let blurTimer = null;
  // 中文输入法拼写中（打 zhao 还没选字）时先别筛，否则列表会先空一下
  let composing = false;

  const generationOf = (node) =>
    t("第 {n} 代", { n: (node.row ?? 0) + 1 });

  const wrap = container.createDiv({ cls: "jiapu-search" });
  wrap.createDiv({ cls: "jiapu-search-title" }).setText(config.title ?? "");
  const input = wrap.createEl("input", {
    cls: "jiapu-search-input",
    attr: { type: "text", spellcheck: "false", autocomplete: "off" },
  });
  const listEl = wrap.createDiv({ cls: "jiapu-search-list" });

  const current = () => byId.get(selectedId) ?? null;

  /** 空关键词给全表；有词就按「前缀优先、其次包含、再看代次」排 */
  const filter = (text) => {
    const keyword = String(text ?? "").trim().toLowerCase();
    if (!keyword) return people.slice();
    const matched = [];
    for (const node of people) {
      const at = String(node.name ?? "").toLowerCase().indexOf(keyword);
      if (at >= 0) matched.push({ node, at });
    }
    matched.sort(
      (a, b) =>
        (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1) ||
        a.at - b.at ||
        (a.node.row ?? 0) - (b.node.row ?? 0) ||
        a.node.name.localeCompare(b.node.name, "zh"),
    );
    return matched.map((item) => item.node);
  };

  const syncPlaceholder = () => {
    const node = current();
    input.setAttribute(
      "placeholder",
      node
        ? t("搜索姓名 · 当前：{name}（{gen}）", {
            name: node.name,
            gen: generationOf(node),
          })
        : t("搜索姓名"),
    );
  };

  /**
   * 量一下还剩多少地方：下方不够就翻到输入框上方展开；上下都紧就压矮列表。
   * 量不出来（无布局 / 测试环境）就老老实实往下开。
   * 关键是量「会被裁剪的那一层」——弹窗内容框，而不只是视口。
   */
  const measure = () => {
    const rect = wrap.getBoundingClientRect?.();
    const viewport = window?.innerHeight;
    if (!rect || !Number.isFinite(viewport) || !Number.isFinite(rect.bottom)) {
      above = false;
      return;
    }
    const box = wrap.closest?.(".modal-content")?.getBoundingClientRect?.();
    const limitBottom = Number.isFinite(box?.bottom)
      ? Math.min(box.bottom, viewport)
      : viewport;
    const limitTop = Number.isFinite(box?.top) ? Math.max(box.top, 0) : 0;
    const below = limitBottom - rect.bottom - 6;
    const up = rect.top - limitTop - 6;
    above = below < LIST_MAX && up > below;
    const room = Math.max(96, above ? up : below);
    // 地方实在不够就把列表压矮，别让它在弹窗里被切一半
    listEl.style.maxHeight = Math.round(Math.min(LIST_MAX, room)) + "px";
  };

  /**
   * 把某一行滚进列表自己的视野。
   * 不用 scrollIntoView：那会连弹窗一起滚，点一下整页都跟着动。
   */
  const reveal = (row) => {
    if (!row) return;
    const view = listEl.clientHeight || 0;
    if (!view) return;
    const top = (row.offsetTop || 0) - 4;
    const bottom = top + (row.offsetHeight || 28) + 8;
    if (top < listEl.scrollTop) listEl.scrollTop = Math.max(0, top);
    else if (bottom > listEl.scrollTop + view)
      listEl.scrollTop = bottom - view;
  };

  const paint = (scrollTo) => {
    listEl.empty();
    listEl.setAttribute(
      "class",
      "jiapu-search-list" +
        (open ? " is-open" : "") +
        (open && above ? " is-above" : ""),
    );
    if (!open) return;
    if (!hits.length) {
      listEl
        .createDiv({ cls: "jiapu-search-empty" })
        .setText(
          String(input.value ?? "").trim()
            ? t("没有叫「{name}」的人", {
                name: String(input.value).trim(),
              })
            : t("这张图里还没有人"),
        );
      return;
    }
    const shown = hits.slice(0, 40);
    let pickedRow = null;
    let activeRow = null;
    shown.forEach((node, index) => {
      const cls =
        "jiapu-search-hit" +
        (node.id === selectedId ? " is-picked" : "") +
        (index === activeIndex ? " is-active" : "");
      const row = listEl.createDiv({ cls });
      row.setAttribute("data-id", node.id);
      row.createSpan({ cls: "jiapu-search-name" }).setText(node.name ?? "");
      const meta = [
        generationOf(node),
        node.birth ? String(node.birth) : "",
        isDeceased(node) ? t("已故") : "",
      ].filter(Boolean);
      row.createSpan({ cls: "jiapu-search-meta" }).setText(meta.join(" · "));
      if (node.id === selectedId) pickedRow = row;
      if (index === activeIndex) activeRow = row;
      // 按下时别把输入框的焦点抢走，否则列表先被 blur 收掉，点不中
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => pick(node.id));
      row.addEventListener("pointerenter", () => {
        if (activeIndex === index) return;
        activeIndex = index;
        paint();
      });
    });
    // 打开时把当前选中的人滚进视野，别让它埋在下面看不见
    const target =
      scrollTo === "active" ? activeRow : scrollTo === "picked" ? pickedRow : null;
    reveal(target);
  };

  const show = (text) => {
    const keyword = String(text ?? "");
    if (input.value !== keyword) input.value = keyword;
    open = true;
    hits = filter(keyword);
    activeIndex = 0;
    measure();
    paint("picked");
    return hits;
  };

  const pick = (id) => {
    if (!byId.has(id)) return;
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    selectedId = id;
    open = false;
    activeIndex = 0;
    if (input.value) input.value = "";
    syncPlaceholder();
    paint();
    config.onChange?.(id);
  };

  input.addEventListener("focus", () => show(input.value));
  input.addEventListener("input", () => {
    if (composing) return;
    show(input.value);
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    show(input.value);
  });
  input.addEventListener("keydown", (event) => {
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      if (!open) {
        show(input.value);
        event.preventDefault();
        return;
      }
      const step = key === "ArrowDown" ? 1 : -1;
      const total = Math.min(hits.length, 40);
      activeIndex = (activeIndex + step + total) % Math.max(total, 1);
      event.preventDefault();
      paint("active");
      return;
    }
    if (key === "Enter") {
      const target = hits[activeIndex];
      if (target) {
        event.preventDefault();
        pick(target.id);
      }
      return;
    }
    if (key === "Escape") {
      open = false;
      input.value = "";
      syncPlaceholder();
      paint();
      event.stopPropagation();
    }
  });
  input.addEventListener("blur", () => {
    // 列表直接收起会让下面的输入框往上跳，正在点的那一下容易点空；
    // 等一小会儿再收，这一下点击就能落在它真正瞄准的地方。
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      open = false;
      input.value = "";
      syncPlaceholder();
      paint();
    }, 140);
  });

  syncPlaceholder();
  paint();

  return {
    input,
    listEl,
    get selectedId() {
      return selectedId;
    },
    get hits() {
      return hits;
    },
    get isOpen() {
      return open;
    },
    setValue: (id) => pick(id),
    query: (text) => show(text),
    closeList() {
      open = false;
      paint();
    },
  };
}

/**
 * 亲戚计算器
 */
export class KinshipModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.store = options.store;
    this.fromId = options.fromId ?? "";
    this.toId = options.toId ?? "";
  }

  /** 按「第几代 + 站位」排一下，下拉框里好找 */
  ordered() {
    return this.store.nodes
      .slice()
      .sort(
        (a, b) =>
          (a.row ?? 0) - (b.row ?? 0) ||
          (a.x ?? 0) - (b.x ?? 0) ||
          a.name.localeCompare(b.name, "zh"),
      );
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jiapu-modal");
    contentEl.addClass("jiapu-kinship-modal");
    contentEl.createEl("h3", { text: t("亲戚计算器") });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "按这张图的父子 / 配偶关系算称呼。出生日期写了就能分清「哥」和「弟」。点输入框直接打字搜名字，↑↓ 选、回车确认。",
      ),
    });

    const people = this.ordered();
    if (!people.length) {
      contentEl.createEl("p", { text: t("这张图里还没有人。") });
      return;
    }
    if (!this.fromId || !people.some((node) => node.id === this.fromId))
      this.fromId = people[0].id;
    if (!this.toId || !people.some((node) => node.id === this.toId))
      this.toId = people[1]?.id ?? people[0].id;

    const pickerWrap = contentEl.createDiv({ cls: "jiapu-kinship-pickers" });
    this.fromPicker = personSearch(pickerWrap, {
      title: t("我是"),
      people,
      value: this.fromId,
      onChange: (id) => {
        this.fromId = id;
        this.update();
      },
    });
    this.toPicker = personSearch(pickerWrap, {
      title: t("TA 是"),
      people,
      value: this.toId,
      onChange: (id) => {
        this.toId = id;
        this.update();
      },
    });

    this.resultEl = contentEl.createDiv({ cls: "jiapu-kinship-result" });

    // 正反两种称呼都直接列在下面了，用不着「换个方向」
    const footer = contentEl.createDiv({ cls: "jiapu-modal-footer" });
    footer.createDiv({ cls: "jiapu-spacer" });
    const close = footer.createEl("button", {
      text: t("关闭"),
      cls: "mod-cta",
    });
    close.addEventListener("click", () => this.close());

    this.update();
  }

  update() {
    if (!this.resultEl) return;
    this.resultEl.empty();
    const forward = kinship(this.store, this.fromId, this.toId);
    const backward = kinship(this.store, this.toId, this.fromId);
    const nameOf = (id) => this.store.getNode(id)?.name ?? "—";

    if (!forward.ok) {
      this.resultEl.createEl("p", {
        cls: "jiapu-kinship-miss",
        text: t(
          "这两个人在图上连不起来——中间缺亲属关系，右键卡片补上父母、配偶或子女。",
        ),
      });
      return;
    }

    const block = (a, b, result) => {
      const card = this.resultEl.createDiv({ cls: "jiapu-kinship-line" });
      const head = card.createDiv({ cls: "jiapu-kinship-say" });
      const who = head.createSpan({ cls: "jiapu-kinship-who" });
      who.setText(t("{a} 称呼 {b}：", { a, b }));
      const term = head.createSpan({
        cls: "jiapu-kinship-term" + (result.exact ? "" : " is-fuzzy"),
      });
      term.setText(result.term ? result.term : t("（没有固定叫法）"));
      const detail = card.createDiv({ cls: "jiapu-kinship-chain" });
      detail.setText(t("关系链：{phrase}", { phrase: result.phrase }));
      let noteText = "";
      if (result.term && !result.exact)
        noteText = t("这是按辈分推的近似叫法，各地叫法不一样。");
      else if (!result.term)
        noteText = t("关系比较远，没有通用称谓，照上面这条链子叫就行。");
      // 没有注释也留一行空位：换人时卡片高度不变，弹窗就不会跟着抖
      const note = card.createDiv({ cls: "jiapu-kinship-note" });
      note.setText(noteText || "\u00a0");
      if (!noteText) note.addClass("is-blank");
    };

    block(nameOf(this.fromId), nameOf(this.toId), forward);
    if (this.fromId !== this.toId)
      block(nameOf(this.toId), nameOf(this.fromId), backward);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * 备份列表：挑一份恢复，或者现在就来一份。
 * 只读不写——「恢复」按钮把路径交回给插件，真正的写入和「恢复前先备份」都在插件里做。
 */
export class BackupModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.plugin = options.plugin;
    this.onBackup = options.onBackup ?? null;
    this.onRestore = options.onRestore ?? null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jiapu-modal");
    contentEl.addClass("jiapu-backup-modal");
    if (this.modalEl) {
      this.modalEl.style.width = "min(640px, 94vw)";
      this.modalEl.style.maxWidth = "94vw";
      this.modalEl.style.boxSizing = "border-box";
    }
    contentEl.style.width = "min(600px, calc(94vw - 44px))";
    contentEl.style.maxWidth = "calc(94vw - 44px)";
    contentEl.style.minWidth = "0";
    contentEl.style.boxSizing = "border-box";
    contentEl.createEl("h3", { text: t("备份与恢复") });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "备份是插件自己的一份完整数据（人物库 + 所有布局，站位和关系都在里面），不是一篇给人读的笔记。文件名带时间戳，只会新增，不会覆盖旧备份，也永远不会自动删除。",
      ),
    });
    this.listEl = contentEl.createDiv({ cls: "jiapu-backup-list" });
    void this.renderList();

    const footer = contentEl.createDiv({ cls: "jiapu-modal-footer" });
    const now = footer.createEl("button", {
      text: t("立即备份"),
      cls: "mod-cta",
    });
    now.addEventListener("click", () => {
      this.onBackup?.();
      // 备份是异步写完的，等一下再读列表才拿得到新文件
      window.setTimeout(() => void this.renderList(), 600);
    });
    footer.createDiv({ cls: "jiapu-spacer" });
    const close = footer.createEl("button", { text: t("关闭") });
    close.addEventListener("click", () => this.close());
  }

  async renderList() {
    if (!this.listEl) return;
    this.listEl.empty();
    this.listEl.createDiv({ cls: "jiapu-backup-empty", text: t("正在读取备份…") });
    const rows = (await this.plugin?.listBackups?.()) ?? [];
    if (!this.listEl) return;
    this.listEl.empty();

    if (!rows.length) {
      const empty = this.listEl.createDiv({ cls: "jiapu-backup-empty" });
      empty.createEl("p", { text: t("备份目录里还没有备份") });
      empty.createEl("p", {
        cls: "setting-item-description",
        text: t("备份目录：{path}", { path: this.plugin?.backupFolder ?? "" }),
      });
      return;
    }

    for (const row of rows) {
      const item = this.listEl.createDiv({ cls: "jiapu-backup-row" });
      const text = item.createDiv({ cls: "jiapu-backup-text" });
      const nameEl = text.createDiv({ cls: "jiapu-backup-name", text: row.name });
      // 名字太长会省略号截断，悬停给全名
      nameEl.setAttribute("title", row.name);
      const meta = [formatWhen(row.mtime), formatBytes(row.size)]
        .filter(Boolean)
        .join(" · ");
      if (meta) text.createDiv({ cls: "jiapu-backup-meta", text: meta });
      const restore = item.createEl("button", { text: t("恢复") });
      restore.addEventListener("click", () => {
        this.close();
        this.onRestore?.(row.path);
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * 主题：点一个预设立刻生效；想细调就改下面的颜色，改哪个自动切到「自定义」。
 *
 * 主题只写 CSS 变量到视图根节点上，卡片、连线全是 SVG + var()，
 * 所以换主题不用重画图，滑一下颜色就能看到效果。
 */
export class ThemeModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.theme = normalizeTheme(options.theme);
    this.onApply = options.onApply ?? (() => {});
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("jiapu-modal");
    contentEl.addClass("jiapu-theme-modal");
    if (this.modalEl) {
      this.modalEl.style.width = "min(620px, 94vw)";
      this.modalEl.style.maxWidth = "94vw";
      this.modalEl.style.boxSizing = "border-box";
    }
    contentEl.createEl("h3", { text: t("主题") });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: t(
        "人物卡片的颜色、文字颜色、已故样式，连线的颜色和粗细。点上面的预设立刻生效；改下面的颜色会自动切到「自定义」。",
      ),
    });

    this.bodyEl = contentEl.createDiv({ cls: "jiapu-theme-body" });

    const footer = contentEl.createDiv({ cls: "jiapu-modal-footer" });
    const reset = footer.createEl("button", { text: t("恢复默认") });
    reset.addEventListener("click", () => {
      this.theme = normalizeTheme({ preset: "classic" });
      this.commit(true);
    });
    footer.createDiv({ cls: "jiapu-spacer" });
    const close = footer.createEl("button", { text: t("关闭"), cls: "mod-cta" });
    close.addEventListener("click", () => this.close());

    this.paint();
  }

  /** 当前生效的颜色；默认主题没有自己的配色，就拿一整套基准值当预览 */
  colors() {
    return previewColors(this.theme);
  }

  paint() {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.paintPresets(this.bodyEl);
    this.paintCustom(this.bodyEl);
    this.paintPreview(this.bodyEl);
  }

  paintPresets(parent) {
    parent.createEl("h4", { text: t("预设主题") });
    const grid = parent.createDiv({ cls: "jiapu-theme-grid" });
    this.gridItems = [];
    for (const preset of THEME_PRESETS) {
      const colors =
        preset.id === "custom"
          ? sanitizeColors(this.theme.custom)
          : preset.colors
            ? sanitizeColors(preset.colors)
            : sanitizeColors(DEFAULT_CUSTOM);
      const card = grid.createDiv({ cls: "jiapu-theme-card" });
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      const chips = card.createDiv({ cls: "jiapu-theme-chips" });
      for (const color of [colors.male, colors.female, colors.deadFill]) {
        const chip = chips.createDiv({ cls: "jiapu-theme-chip" });
        chip.style.background = color;
      }
      card.createDiv({ cls: "jiapu-theme-name", text: t(preset.name) });
      const pick = () => this.pick(preset.id);
      card.addEventListener("click", pick);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          pick();
        }
      });
      this.gridItems.push({ id: preset.id, el: card });
    }
    this.markActive();
  }

  paintCustom(parent) {
    const c = this.colors();
    parent.createEl("h4", { text: t("自定义") });

    parent.createDiv({ cls: "jiapu-theme-group", text: t("人物卡片") });
    this.colorRow(parent, "male", t("男性卡片"), c.male);
    this.colorRow(parent, "female", t("女性卡片"), c.female);
    this.colorRow(parent, "unknown", t("未填性别"), c.unknown);
    this.colorRow(parent, "text", t("卡片文字"), c.text);

    parent.createDiv({ cls: "jiapu-theme-group", text: t("已故的人") });
    this.colorRow(parent, "deadFill", t("底色"), c.deadFill);
    this.colorRow(parent, "deadStroke", t("边框"), c.deadStroke);

    parent.createDiv({ cls: "jiapu-theme-group", text: t("连线") });
    this.colorRow(parent, "line", t("亲子线"), c.line);
    this.colorRow(parent, "spouse", t("配偶线"), c.spouse);
    this.widthRow(parent, c.lineWidth);
  }

  colorRow(parent, key, label, value) {
    const row = parent.createDiv({ cls: "jiapu-color-row" });
    row.createDiv({ cls: "jiapu-color-label", text: label });
    const picker = row.createEl("input", {
      cls: "jiapu-color-picker",
      attr: { type: "color" },
    });
    picker.value = value;
    const hex = row.createEl("input", {
      cls: "jiapu-color-hex",
      attr: { type: "text", spellcheck: "false", maxlength: "7" },
    });
    hex.value = value.toUpperCase();
    picker.addEventListener("input", () => {
      hex.value = picker.value.toUpperCase();
      this.patch(key, picker.value);
    });
    hex.addEventListener("change", () => {
      const text = String(hex.value ?? "").trim();
      const parsed = sanitizeColors({ [key]: text })[key];
      if (!/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(text)) {
        hex.value = this.colors()[key].toUpperCase();
        return;
      }
      picker.value = parsed;
      hex.value = parsed.toUpperCase();
      this.patch(key, parsed);
    });
  }

  widthRow(parent, value) {
    const row = parent.createDiv({ cls: "jiapu-color-row" });
    row.createDiv({ cls: "jiapu-color-label", text: t("线宽") });
    const slider = row.createEl("input", {
      cls: "jiapu-theme-slider",
      attr: {
        type: "range",
        min: String(LINE_WIDTH_MIN),
        max: String(LINE_WIDTH_MAX),
        step: "0.2",
      },
    });
    slider.value = String(value);
    const readout = row.createDiv({
      cls: "jiapu-color-hex jiapu-theme-width",
      text: `${Number(value).toFixed(1)}×`,
    });
    slider.addEventListener("input", () => {
      const width = Number(slider.value);
      readout.setText(`${width.toFixed(1)}×`);
      this.patch("lineWidth", width);
    });
  }

  paintPreview(parent) {
    parent.createEl("h4", { text: t("预览") });
    const strip = parent.createDiv({ cls: "jiapu-theme-preview" });
    const card = (label) => {
      const el = strip.createDiv({ cls: "jiapu-preview-card" });
      el.setText(label);
      return el;
    };
    this.preview = {
      male: card(t("男")),
      line: strip.createDiv({ cls: "jiapu-preview-line" }),
      female: card(t("女")),
      spouse: strip.createDiv({ cls: "jiapu-preview-line" }),
      dead: card(t("已故")),
    };
    this.refreshPreview();
  }

  /** 只改样式，不重建节点——拖颜色的时候重建会闪 */
  refreshPreview() {
    const p = this.preview;
    if (!p) return;
    const c = this.colors();
    const paintCard = (el, background, textColor, stroke) => {
      el.style.background = background;
      el.style.color = textColor;
      el.style.border = `1.2px solid ${stroke}`;
    };
    paintCard(p.male, c.male, c.text, c.male);
    paintCard(p.female, c.female, c.text, c.female);
    paintCard(p.dead, c.deadFill, readableOn(c.deadFill, c.text), c.deadStroke);
    p.line.style.borderTopWidth = `${c.lineWidth}px`;
    p.line.style.borderTopColor = c.line;
    p.spouse.style.borderTopWidth = `${(c.lineWidth * 1.2).toFixed(2)}px`;
    p.spouse.style.borderTopColor = c.spouse;
  }

  /** 点预设：换成这一套（自定义则从当前颜色起步，不跳回陈旧的值） */
  pick(id) {
    if (id === "custom")
      this.theme = {
        preset: "custom",
        custom: themeColors(this.theme) ?? sanitizeColors(DEFAULT_CUSTOM),
      };
    else this.theme = { preset: id, custom: this.theme.custom };
    this.commit(true);
  }

  /** 改单个颜色（或线宽）：一律落到「自定义」上 */
  patch(key, value) {
    const base = themeColors(this.theme) ?? sanitizeColors(DEFAULT_CUSTOM);
    this.theme = {
      preset: "custom",
      custom: sanitizeColors({ ...base, [key]: value }),
    };
    this.commit(false);
  }

  /** full=true 整块重画（预设高亮、各输入框的值都要跟着变） */
  commit(full) {
    if (full) this.paint();
    else {
      this.markActive();
      this.refreshPreview();
    }
    this.onApply(this.theme);
  }

  markActive() {
    for (const item of this.gridItems ?? []) {
      item.el.classList.toggle("is-active", item.id === this.theme.preset);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
