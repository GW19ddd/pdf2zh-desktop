import { getString } from "../utils/locale";
import { prefGet, prefSet } from "../utils/prefs";
import { debugLog, debugLogPath } from "../utils/debug";
import { launchPdf2zh, Pdf2zhLaunchInfo } from "./launcher";

/**
 * 右键菜单：
 *   - 条目树（zotero-itemmenu）：完整子菜单（一键翻译 / 各格式 / 静默开关 / 打开配置）
 *   - PDF reader（Zotero 9+）：通过 Zotero.Reader.registerEventListener 向动态右键菜单
 *     注入同样的子菜单，翻译 reader 当前打开的 PDF
 */

export interface PdfInfo extends Pdf2zhLaunchInfo {
  path: string;
  itemID?: number;
}


function alertUser(title: string, msg: string): void {
  try {
    Zotero.alert(Zotero.getMainWindow() as any, title, msg);
  } catch (e) {
    /* ignore */
  }
}

function isSilentMode(): boolean {
  return prefGet("silent", false) === true;
}

function toggleSilentMode(): boolean {
  const now = !isSilentMode();
  prefSet("silent", now);
  return now;
}

function defaultFormat(): string {
  const v = prefGet("format", "side_by_side");
  return ["side_by_side", "dual", "mono", "all"].includes(v) ? v : "side_by_side";
}

async function getSelectedPdfPaths(): Promise<PdfInfo[]> {
  const win = Zotero.getMainWindow() as any;
  if (!win || !win.ZoteroPane) return [];
  const items: any[] = win.ZoteroPane.getSelectedItems();
  const infos: PdfInfo[] = [];
  for (const item of items) {
    // 选中项本身就是 PDF 附件
    if (
      typeof item.isAttachment === "function" &&
      item.isAttachment() &&
      item.attachmentContentType === "application/pdf"
    ) {
      const p = await item.getFilePathAsync();
      if (p) infos.push({ path: p, key: item.key, linkMode: item.attachmentLinkMode, itemID: item.id });
      continue;
    }
    // 普通文献条目：取它的 PDF 附件
    if (typeof item.isRegularItem === "function" && item.isRegularItem()) {
      const attIds = item.getAttachments();
      for (const attId of attIds) {
        const att = Zotero.Items.get(attId);
        if (att && att.attachmentContentType === "application/pdf") {
          const p = await att.getFilePathAsync();
          if (p) infos.push({ path: p, key: att.key, linkMode: att.attachmentLinkMode, itemID: att.id });
        }
      }
    }
  }
  return infos;
}

export async function triggerTranslate(
  format: string | null,
  auto: boolean,
  infosOverride?: PdfInfo[]
): Promise<void> {
  debugLog("=== triggerTranslate called format=" + format + " auto=" + auto + " ===");
  try {
    const infos = infosOverride || (await getSelectedPdfPaths());
    debugLog("selected pdf count=" + infos.length);
    if (infos.length === 0) {
      alertUser(
        "pdf2zh-desktop Connector",
        "请先选中一个 PDF 附件或含 PDF 的文献条目\n(pdf2zh-desktop Connector)"
      );
      return;
    }
    for (const info of infos) {
      await launchPdf2zh(info.path, format, auto, info);
    }
    debugLog("=== triggerTranslate DONE ===");
  } catch (e: any) {
    debugLog(
      "triggerTranslate EXCEPTION: " + e + " stack=" + (e && e.stack ? e.stack : "no-stack")
    );
    alertUser(
      "pdf2zh-desktop Connector",
      "右键翻译失败：\n" + String(e) + "\n\n日志已写到：" + debugLogPath()
    );
  }
}

/** reader 当前打开的 PDF → 翻译（reader 实例直接来自 reader 菜单事件） */
async function triggerReaderTranslate(reader: any, format: string | null, auto: boolean): Promise<void> {
  try {
    const itemID = reader && reader.itemID;
    if (!itemID) {
      alertUser("pdf2zh-desktop Connector", "未找到当前打开的 PDF（reader）");
      return;
    }
    const item = Zotero.Items.get(itemID);
    if (!item || item.attachmentContentType !== "application/pdf") {
      alertUser("pdf2zh-desktop Connector", "当前 reader 打开的附件不是 PDF");
      return;
    }
    const p = await item.getFilePathAsync();
    if (!p) {
      alertUser("pdf2zh-desktop Connector", "无法获取当前 PDF 的文件路径");
      return;
    }
    debugLog("=== triggerReaderTranslate file=" + p + " format=" + format + " ===");
    await launchPdf2zh(p, format, auto, {
      key: item.key,
      linkMode: item.attachmentLinkMode,
      itemID: item.id,
    });
  } catch (e: any) {
    debugLog("triggerReaderTranslate EXCEPTION: " + e);
    alertUser("pdf2zh-desktop Connector", "reader 翻译失败：\n" + String(e));
  }
}
type TranslateHandler = (format: string | null, auto: boolean) => void;

interface MenuItemDef {
  label: string;
  separator?: boolean;
  useDefault?: boolean;
  format?: string;
  auto?: boolean;
  silent?: boolean;
}

function buildTranslateMenu(doc: Document, onTranslate: TranslateHandler): any {
  const create = (tag: string) =>
    (doc as any).createXULElement ? (doc as any).createXULElement(tag) : doc.createElement(tag);
  const menu = create("menu");
  menu.id = "pdf2zh-translate-menu";
  menu.setAttribute("label", getString("menu-translate-label"));

  const subpopup = create("menupopup");
  const defs: MenuItemDef[] = [
    { label: getString("menu-one-click"), useDefault: true, auto: true },
    { label: "─────────", separator: true },
    { label: getString("menu-side-by-side"), format: "side_by_side", auto: false },
    { label: getString("menu-dual"), format: "dual", auto: false },
    { label: getString("menu-mono"), format: "mono", auto: false },
    { label: getString("menu-all"), format: "all", auto: false },
    { label: "─────────", separator: true },
    { label: getString("menu-silent"), silent: true },
    { label: "─────────", separator: true },
    { label: "⚙️ " + getString("menu-open-config"), useDefault: false, format: undefined, auto: false },
  ];

  let silentItem: any = null;
  for (const def of defs) {
    if (def.separator) {
      subpopup.appendChild(create("menuseparator"));
      continue;
    }
    const mi = create("menuitem");
    mi.setAttribute("label", def.label);
    if (def.silent) {
      mi.setAttribute("type", "checkbox");
      mi.setAttribute("autocheck", "false");
      silentItem = mi;
      mi.addEventListener("command", () => {
        const on = toggleSilentMode();
        mi.setAttribute("checked", on ? "true" : "false");
      });
    } else {
      mi.addEventListener("command", () => {
        // 「打开配置」= format null auto false → 唤起 app 打开该 PDF，用户手动配置翻译
        const fmt = def.useDefault ? defaultFormat() : def.format || null;
        onTranslate(fmt, def.useDefault ? true : false);
      });
    }
    subpopup.appendChild(mi);
  }

  // 每次打开菜单时同步静默开关的勾选状态
  subpopup.addEventListener("popupshowing", () => {
    if (silentItem) silentItem.setAttribute("checked", isSilentMode() ? "true" : "false");
  });

  menu.appendChild(subpopup);
  return menu;
}

/** 条目树右键菜单 */
export function installItemContextMenu(win: Window): void {
  try {
    if (!win || !win.document) return;
    const doc = win.document;
    const menupopup = doc.getElementById("zotero-itemmenu");
    if (!menupopup) return;
    if (doc.getElementById("pdf2zh-translate-menu")) return;
    const menu = buildTranslateMenu(doc, (fmt, auto) => {
      void triggerTranslate(fmt, auto);
    });
    menupopup.appendChild(menu);
    debugLog("item context menu installed");
  } catch (e) {
    debugLog("installItemContextMenu error: " + e);
  }
}

function removeItemContextMenu(win: Window): void {
  try {
    if (!win || !win.document) return;
    const m = win.document.getElementById("pdf2zh-translate-menu");
    if (m && m.parentNode) m.parentNode.removeChild(m);
  } catch (e) {
    /* ignore */
  }
}

/**
 * PDF reader 右键菜单（Zotero 9+）：
 * reader.xhtml 不再有静态的 zotero-reader-context-menu，右键菜单由 reader 动态生成。
 * 插件通过 Zotero.Reader.registerEventListener('createViewContextMenu' / 'createAnnotationContextMenu')
 * 把「用 pdf2zh-desktop 翻译」子菜单追加进菜单项（append 必须同步调用）。
 */
type ReaderMenuEvent = {
  reader: any;
  params: any;
  append: (...items: any[]) => void;
};

interface ReaderMenuItem {
  label: string;
  checked?: boolean;
  onCommand?: () => void;
  groups?: ReaderMenuItem[][];
}

function buildReaderMenu(reader: any): any | null {
  try {
    const itemID = reader && reader.itemID;
    if (!itemID) return null;
    const item = Zotero.Items.get(itemID);
    if (!item || item.attachmentContentType !== "application/pdf") return null;
    const mk = (label: string, onCommand: () => void): ReaderMenuItem => ({ label, onCommand });
    // 每个 group 之间由原生菜单渲染为分隔线，结构对齐条目树子菜单
    const groups: ReaderMenuItem[][] = [
      [
        mk(getString("menu-one-click"), () => {
          void triggerReaderTranslate(reader, defaultFormat(), true);
        }),
      ],
      [
        mk(getString("menu-side-by-side"), () => {
          void triggerReaderTranslate(reader, "side_by_side", false);
        }),
        mk(getString("menu-dual"), () => {
          void triggerReaderTranslate(reader, "dual", false);
        }),
        mk(getString("menu-mono"), () => {
          void triggerReaderTranslate(reader, "mono", false);
        }),
        mk(getString("menu-all"), () => {
          void triggerReaderTranslate(reader, "all", false);
        }),
      ],
      [
        {
          label: getString("menu-silent"),
          checked: isSilentMode(),
          onCommand: () => {
            toggleSilentMode();
          },
        },
      ],
      [
        mk(getString("menu-open-config"), () => {
          // format null auto false → 唤起 app 打开该 PDF，用户手动配置翻译
          void triggerReaderTranslate(reader, null, false);
        }),
      ],
    ];
    return {
      label: getString("menu-translate-label"),
      groups,
    };
  } catch (e) {
    debugLog("buildReaderMenu error: " + e);
    return null;
  }
}

const readerMenuHandlers = new Map<string, (event: ReaderMenuEvent) => void>();

function registerReaderMenuEvent(type: string): void {
  try {
    const readerTool = (Zotero as any).Reader;
    if (!readerTool || typeof readerTool.registerEventListener !== "function") return;
    if (readerMenuHandlers.has(type)) return;
    const handler = (event: ReaderMenuEvent) => {
      try {
        if (!event || typeof event.append !== "function") return;
        const menu = buildReaderMenu(event.reader);
        if (menu) event.append(menu);
      } catch (e) {
        debugLog("reader menu event " + type + " error: " + e);
      }
    };
    readerTool.registerEventListener(type, handler, addon.data.config.addonID);
    readerMenuHandlers.set(type, handler);
    debugLog("reader menu event registered: " + type);
  } catch (e) {
    debugLog("registerReaderMenuEvent " + type + " FAILED: " + e);
  }
}

function installReaderMenuEvents(): void {
  registerReaderMenuEvent("createViewContextMenu");
  registerReaderMenuEvent("createAnnotationContextMenu");
}

function uninstallReaderMenuEvents(): void {
  try {
    const readerTool = (Zotero as any).Reader;
    if (readerTool && typeof readerTool.unregisterEventListener === "function") {
      for (const [type, handler] of readerMenuHandlers) {
        try {
          readerTool.unregisterEventListener(type, handler);
        } catch (e) {
          /* ignore */
        }
      }
    }
  } catch (e) {
    /* ignore */
  }
  readerMenuHandlers.clear();
}

let readerEventsInstalled = false;

/** 主窗口加载：安装条目树菜单 + 注册 reader 菜单事件 */
export function installContextMenus(win: Window): void {
  installItemContextMenu(win);
  if (!readerEventsInstalled) {
    installReaderMenuEvents();
    readerEventsInstalled = true;
  }
}

export function uninstallContextMenus(): void {
  uninstallReaderMenuEvents();
  readerEventsInstalled = false;
  try {
    const wm = (Components.classes as any)["@mozilla.org/appshell/window-mediator;1"].getService(
      Components.interfaces.nsIWindowMediator
    );
    const enumerator = wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
      const win = enumerator.getNext();
      removeItemContextMenu(win as Window);
    }
  } catch (e) {
    /* ignore */
  }
}
