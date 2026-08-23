import { prefGet, prefSet } from "../utils/prefs";
import { debugLog, debugLogPath } from "../utils/debug";

/**
 * 唤起 pdf2zh-desktop 应用（与旧版插件 v1.0.27 行为一致）：
 *   - Windows：直接跑 core\runtime\pythonw.exe _launcher.py <args>
 *     （pdf2zh.exe / pdf2zh.vbs 都不转发命令行参数，这是当年"右键不自动翻译"的根因）
 *   - macOS：/usr/bin/open -a <app> --args <args>
 *   - Linux：直接执行可执行文件
 * 参数：--format / --auto / --silent / --zotero-key / --zotero-link-mode <file.pdf>
 */

export interface Pdf2zhLaunchInfo {
  key?: string;
  itemID?: number;
  linkMode?: number;
}

function pathJoin(...parts: string[]): string {
  const sep = Zotero.isWin ? "\\" : "/";
  return parts.filter(Boolean).join(sep);
}

function homeDir(): string {
  try {
    return Services.env.get(Zotero.isWin ? "USERPROFILE" : "HOME") || "";
  } catch (e) {
    return "";
  }
}

function fileExistsPath(p: string): string | null {
  try {
    const f = Zotero.File.pathToFile(p);
    return f && f.exists() ? p : null;
  } catch (e) {
    return null;
  }
}

/** 在某目录下浅层扫描 pdf2zh.exe：遍历每个子目录，查子目录内是否有可执行文件。限制数量避免全盘慢扫。 */
function scanDirForExe(dir: string, exeName: string): string | null {
  try {
    const d = Zotero.File.pathToFile(dir);
    if (!d || !d.exists() || !d.isDirectory()) return null;
    const direct = fileExistsPath(pathJoin(dir, exeName));
    if (direct) return direct;
    const winRoot = fileExistsPath(pathJoin(pathJoin(dir, "pdf2zh-desktop-win"), exeName));
    if (winRoot) return winRoot;
    const skip = new Set([
      "windows",
      "$recycle.bin",
      "system volume information",
      "programdata",
      "recovery",
      "perflogs",
      "appdata",
    ]);
    const entries = (d as any).directoryEntries;
    let count = 0;
    while (entries.hasMoreElements() && count < 120) {
      let sub: any;
      try {
        sub = entries.getNext().QueryInterface(Components.interfaces.nsIFile);
      } catch (e) {
        continue;
      }
      if (!sub.isDirectory()) continue;
      count++;
      const name = (sub.leafName || "").toLowerCase();
      if (skip.has(name)) continue;
      const hit = fileExistsPath(pathJoin(sub.path, exeName));
      if (hit) return hit;
      const hit2 = fileExistsPath(pathJoin(pathJoin(sub.path, "pdf2zh-desktop-win"), exeName));
      if (hit2) return hit2;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

/** 找 pdf2zh 可执行文件（跨平台）。手动配置优先，其次固定候选，最后浅递归扫描。 */
export function findPdf2zhExecutable(): string | null {
  const saved = prefGet("exePath", "");
  if (saved && fileExistsPath(saved)) return saved;

  const home = homeDir();

  if (Zotero.isMac) {
    const macs = ["/Applications/pdf2zh.app", pathJoin(home, "Applications/pdf2zh.app")];
    for (const m of macs) {
      const f = fileExistsPath(m);
      if (f) return f;
    }
    return null;
  }

  if (!Zotero.isWin) {
    const lins = ["/usr/local/bin/pdf2zh", pathJoin(home, "pdf2zh-desktop-win/pdf2zh")];
    for (const p of lins) {
      const f = fileExistsPath(p);
      if (f) return f;
    }
    return null;
  }

  // ===== Windows =====
  const exe = "pdf2zh.exe";
  const folderNames = [
    "pdf2zh-desktop-win",
    "pdf2zh-desktop-win-v2.3.3",
    "pdf2zh-desktop-win-v2.3.2",
    "pdf2zh-desktop-win-v2.3.1",
    "pdf2zh",
  ];
  const bases = [
    "C:\\",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    pathJoin(home, "Downloads"),
    pathJoin(home, "Desktop"),
    pathJoin(home, "Documents"),
    home,
    "D:\\",
    "D:\\Program Files",
    "E:\\",
    "F:\\",
  ];
  for (const b of bases) {
    for (const fn of folderNames) {
      const p = fileExistsPath(pathJoin(pathJoin(b, fn), exe));
      if (p) return p;
      const p2 = fileExistsPath(pathJoin(pathJoin(pathJoin(b, fn), "pdf2zh-desktop-win"), exe));
      if (p2) return p2;
    }
    const direct = fileExistsPath(pathJoin(b, exe));
    if (direct) return direct;
  }
  const scanDirs = [
    pathJoin(home, "Downloads"),
    pathJoin(home, "Desktop"),
    pathJoin(home, "Documents"),
    "C:\\",
    "D:\\",
    "E:\\",
  ];
  for (const s of scanDirs) {
    const hit = scanDirForExe(s, exe);
    if (hit) return hit;
  }
  return null;
}


function alertUser(title: string, msg: string): void {
  try {
    Zotero.alert(Zotero.getMainWindow() as any, title, msg);
  } catch (e) {
    /* ignore */
  }
}

function loadSubprocess(): any {
  try {
    return (ChromeUtils as any).importESModule("resource://gre/modules/Subprocess.sys.mjs").Subprocess;
  } catch (e1) {
    try {
      return (ChromeUtils as any).import("resource://gre/modules/Subprocess.jsm").Subprocess;
    } catch (e2) {
      return null;
    }
  }
}

/** 找不到程序时让用户手动指定一次，存进 pref 永久生效。 */
function promptPickExecutable(): Promise<string | null> {
  return new Promise((resolve) => {
    void (async () => {
      let picked: string | null = null;
      try {
        const win = Zotero.getMainWindow();
        const yes = Services.prompt.confirm(win as any,
          "pdf2zh-desktop Connector",
          "没有自动找到 pdf2zh-desktop 应用。\n\n" +
            "Windows: 请确认已把 pdf2zh-desktop-win 文件夹解压出来(里面有 pdf2zh.exe)。\n" +
            "Mac: 确认 pdf2zh.app 在“应用程序”里。\n\n" +
            "点“确定”手动选择 " +
            (Zotero.isWin ? "pdf2zh.exe" : "pdf2zh.app") +
            " 的位置(只需选一次)；\n" +
            "点“取消”去下载：github.com/GW19ddd/pdf2zh-desktop/releases"
        );
        if (yes) {
          // Zotero 7/9 已移除扩展里的 Components，改用 Zotero.FilePicker
          const FP: any = (Zotero as any).FilePicker;
          const fp = new FP();
          fp.init(win, "选择 pdf2zh 程序", fp.modeOpen);
          if (Zotero.isWin) {
            fp.appendFilter("pdf2zh.exe", "pdf2zh.exe");
            fp.appendFilters(fp.filterApps);
          }
          const rv = await fp.show();
          if (rv === fp.returnOK && fp.file) {
            picked = fp.file.path;
            try {
              prefSet("exePath", picked);
            } catch (e) {
              /* ignore */
            }
          }
        }
      } catch (e) {
        /* 老版本 Zotero 时 filepicker 降级 */
      }
      if (!picked) {
        alertUser(
          "pdf2zh-desktop Connector",
          "未找到 pdf2zh-desktop 应用。\n" +
            "Windows: 把下载的 zip 解压, 确认有 pdf2zh-desktop-win\\pdf2zh.exe；建议解压到“下载”或“桌面”。\n" +
            "Mac: 把 pdf2zh.app 放进“应用程序”。\n\n" +
            "下载：https://github.com/GW19ddd/pdf2zh-desktop/releases"
        );
      }
      resolve(picked);
    })();
  });
}
export async function launchPdf2zh(
  filePath: string,
  format: string | null,
  auto: boolean,
  info?: Pdf2zhLaunchInfo
): Promise<void> {
  let exe = findPdf2zhExecutable();
  if (!exe) {
    exe = await promptPickExecutable();
  }
  if (!exe) return;

  const args: string[] = [];
  if (format) args.push("--format=" + format);
  if (auto) args.push("--auto");
  // 后台静默模式（右键菜单 / 设置面板里开启）
  if (prefGet("silent", false) === true) args.push("--silent");
  // 传 Zotero 附件元数据，解决 zotmoov 等插件移动过的链接附件无法回写的问题
  if (info) {
    if (info.key) args.push("--zotero-key=" + info.key);
    if (typeof info.linkMode === "number") args.push("--zotero-link-mode=" + info.linkMode);
  }
  args.push(filePath);

  let command: string;
  let allArgs: string[];
  let subOpts: any = null;
  if (Zotero.isMac) {
    command = "/usr/bin/open";
    allArgs = ["-a", exe, "--args"].concat(args);
  } else if (Zotero.isWin) {
    // 直跑 pythonw _launcher.py（CreateProcessW，中文路径 Unicode 安全）+ 复刻 vbs 的环境变量
    const appDir = exe.replace(/[\\\/]+pdf2zh\.exe$/i, "");
    const pythonw = appDir + "\\core\\runtime\\pythonw.exe";
    const launcher = appDir + "\\_launcher.py";
    if (fileExistsPath(pythonw) && fileExistsPath(launcher)) {
      command = pythonw;
      allArgs = [launcher].concat(args);
      subOpts = {
        environment: {
          PYTHONHOME: "",
          PYTHONPATH: "",
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONIOENCODING: "utf-8",
          QT_PLUGIN_PATH: appDir + "\\core\\site-packages\\PyQt5\\Qt5\\plugins",
        },
        environmentAppend: true,
        workdir: appDir,
      };
    } else {
      command = exe; // 兜底（理论不该走到）
      allArgs = args;
    }
  } else {
    command = exe;
    allArgs = args;
  }

  debugLog("launch command=" + command + " args=" + JSON.stringify(allArgs));

  // 首选 Subprocess API（Zotero 9 / Firefox 128+ 之后 nsIProcess 在部分场景已失效）
  const Subprocess = loadSubprocess();
  if (Subprocess) {
    try {
      const callOpts: any = { command, arguments: allArgs };
      if (subOpts) {
        callOpts.environment = subOpts.environment;
        callOpts.environmentAppend = subOpts.environmentAppend;
        callOpts.workdir = subOpts.workdir;
      }
      await Subprocess.call(callOpts);
      debugLog("Subprocess.call SUCCESS");
      return;
    } catch (subErr) {
      debugLog("Subprocess.call FAILED: " + subErr + " stack=" + (subErr && (subErr as any).stack ? (subErr as any).stack : "no-stack"));
    }
  }

  // 兜底：老式 nsIProcess
  try {
    debugLog("trying nsIProcess...");
    const proc = (Components.classes as any)["@mozilla.org/process/util;1"].createInstance(
      Components.interfaces.nsIProcess
    );
    proc.init(Zotero.File.pathToFile(command));
    proc.run(false, allArgs, allArgs.length);
    debugLog("nsIProcess.run SUCCESS");
  } catch (e) {
    debugLog("nsIProcess FAILED: " + e);
    alertUser(
      "pdf2zh-desktop Connector",
      "唤起 pdf2zh-desktop 失败：\n" +
        String(e) +
        "\n\n临时办法：手动打开 pdf2zh-desktop 应用，把 PDF 拖进去。\n日志已写到 " + debugLogPath()
    );
  }
}
