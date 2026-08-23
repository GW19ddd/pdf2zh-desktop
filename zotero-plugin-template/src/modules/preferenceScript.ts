import { config } from "../../package.json";
import { prefGet, prefSet } from "../utils/prefs";
import { debugLog } from "../utils/debug";
import { findPdf2zhExecutable } from "./launcher";

/**
 * 设置面板逻辑（addon/content/preferences.xhtml 加载时调用）。
 * 简单控件已由 preference="xxx" 自动绑定（scaffold 构建时自动加前缀），
 * 这里只处理需要逻辑的部分：默认格式兜底读写、程序路径自动探测 / 浏览 / 提示文字。
 * 用 WeakSet 保证幂等，避免 groupbox onload 与内联 <script> 双触发导致重复绑定。
 */
const boundWindows = new WeakSet<Window>();

export async function registerPrefsScripts(_window: Window): Promise<void> {
  if (boundWindows.has(_window)) return;
  const doc = _window.document;
  const exe = doc.getElementById("pdf2zh-exepath") as HTMLInputElement;
  const hint = doc.getElementById("pdf2zh-exehint");
  const fmt = doc.getElementById("pdf2zh-format") as HTMLSelectElement;
  const detectBtn = doc.getElementById("pdf2zh-detect");
  const browseBtn = doc.getElementById("pdf2zh-browse");
  if (!exe || !hint || !fmt) {
    debugLog("prefs pane elements missing, retry later");
    (_window as any).setTimeout(() => {
      void registerPrefsScripts(_window);
    }, 50);
    return;
  }
  boundWindows.add(_window);
  const hintEl = hint;

  function getP(key: string, def: any): any {
    return prefGet(key, def);
  }
  function setP(key: string, v: any): void {
    prefSet(key, v);
  }

  function setHint(id: string, fallback: string): void {
    try {
      const l10n = (doc as any).l10n;
      if (l10n && typeof l10n.setAttributes === "function") {
        l10n.setAttributes(hint, `${config.addonRef}-${id}`);
        return;
      }
    } catch (e) {
      /* ignore */
    }
    hintEl.textContent = fallback;
  }

  function refresh(p: string | null): void {
    if (p && p.length > 0) {
      setHint("pref-exe-ok", "已连接：右键翻译将使用该程序。");
    } else if (p) {
      setHint("pref-exe-missing", "路径不存在，点击「自动探测」或「浏览」重新指定。");
    } else {
      setHint("pref-exe-notfound", "未找到 pdf2zh 程序，点击「自动探测」或「浏览」手动选择。");
    }
  }

  // html:select 的 preference 自动绑定在部分版本不可靠，手动兜底读写
  let f = getP("format", "side_by_side");
  if (["side_by_side", "dual", "mono", "all"].indexOf(f) < 0) f = "side_by_side";
  fmt.value = f;
  fmt.addEventListener("change", () => setP("format", fmt.value));

  function onDetect(): void {
    const found = findPdf2zhExecutable();
    if (found) {
      setP("exePath", found);
      exe.value = found;
    }
    refresh(found);
  }

  function onBrowse(): void {
    pickExecutable((p) => {
      if (p) {
        setP("exePath", p);
        exe.value = p;
        refresh(p);
      }
    });
  }

  if (detectBtn) (detectBtn as any).addEventListener("command", onDetect);
  if (browseBtn) (browseBtn as any).addEventListener("command", onBrowse);

  // 自动连接：未设置程序路径时自动探测并写入
  const current = exe.value || getP("exePath", "");
  if (!current) {
    const auto = findPdf2zhExecutable();
    if (auto) {
      setP("exePath", auto);
      exe.value = auto;
    }
  }
  refresh(exe.value || getP("exePath", ""));
}

function pickExecutable(cb: (path: string) => void): void {
  try {
    const win = Zotero.getMainWindow();
    const fp = (Components.classes as any)["@mozilla.org/filepicker;1"].createInstance(
      Components.interfaces.nsIFilePicker
    );
    fp.init(win, "选择 pdf2zh 程序", fp.modeOpen);
    if (Zotero.isWin) {
      fp.appendFilter("pdf2zh.exe", "pdf2zh.exe");
      fp.appendFilters(fp.filterApps);
    }
    const rv = fp.show ? fp.show() : fp.open;
    if (rv === fp.returnOK && fp.file) cb(fp.file.path);
  } catch (e) {
    debugLog("pickExecutable error: " + e);
  }
}
