/**
 * 调试日志：写入 Zotero profile 目录下的 paperflow-xpi-debug.log
 * （同时输出到 Zotero.debug）。Windows 下不用 /tmp（父目录不存在会静默失败）。
 */
export function debugLogPath(): string {
  try {
    // Zotero 9 的 Zotero.Profile.dir 是字符串路径；Zotero 7/8 是 nsIFile（取 .path）
    const dir: any = (Zotero as any).Profile && (Zotero as any).Profile.dir;
    let base = "";
    if (typeof dir === "string" && dir.length > 0) {
      base = dir;
    } else if (dir && typeof dir.path === "string" && dir.path.length > 0) {
      base = dir.path;
    }
    if (base) {
      return base + (Zotero.isWin ? "\\paperflow-xpi-debug.log" : "/paperflow-xpi-debug.log");
    }
  } catch (e) {
    /* ignore */
  }
  return "paperflow-xpi-debug.log";
}

export function debugLog(msg: string): void {
  try {
    const line = "[" + new Date().toISOString() + "] " + msg + "\n";
    Zotero.debug("paperflow-xpi: " + msg);
    try {
      const g = globalThis as any;
      const encoder = g.TextEncoder ? new g.TextEncoder() : null;
      if (encoder && g.IOUtils && typeof g.IOUtils.write === "function") {
        g.IOUtils.write(debugLogPath(), encoder.encode(line), {
          mode: "appendOrCreate",
        });
      }
    } catch (e1) {
      /* IOUtils 不可用则算了，Zotero.debug 已有输出 */
    }
  } catch (e) {
    /* never throw */
  }
}