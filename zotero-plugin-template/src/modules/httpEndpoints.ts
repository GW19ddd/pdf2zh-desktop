import { prefGet } from "../utils/prefs";
import { debugLog } from "../utils/debug";

/**
 * Zotero 本地 HTTP 端点（与旧版插件协议完全一致）：
 *   POST /pdf2zh/attach  接收桌面端翻译结果，作为子附件挂回原条目
 *   GET  /pdf2zh/ping    健康检查（桌面端「Zotero 联动」据此判断插件是否安装）
 */
export interface ZoteroEndpoint {
  supportedMethods: string[];
  supportedDataTypes: string[];
  permitBookmarklet: boolean;
  init(options: { data?: unknown }): Promise<[number, string, string]>;
}

function normFilePath(p: unknown): string {
  try {
    return String(p).replace(/\\/g, "/").toLowerCase();
  } catch (e) {
    return String(p);
  }
}

function fileExists(path: string): boolean {
  try {
    const f = Zotero.File.pathToFile(path);
    return !!(f && f.exists());
  } catch (e) {
    return false;
  }
}

/**
 * 找"原附件"。右键链路里 item 本身往往就是被翻译的 PDF 附件，
 * 优先直接用 item（判断 linkMode 即可，不依赖路径字符串匹配）；
 * 路径匹配仅作为 item 不是附件时的兜底。
 */
async function findOriginalAttachment(item: any, parentFilePath: string | null): Promise<any> {
  try {
    if (
      item &&
      typeof item.isAttachment === "function" &&
      item.isAttachment() &&
      item.attachmentContentType === "application/pdf"
    ) {
      return item;
    }
    const target = parentFilePath ? normFilePath(parentFilePath) : null;
    const pool: any[] = [];
    if (item && typeof item.getAttachments === "function") {
      const ids = item.getAttachments();
      for (const id of ids) {
        const att = Zotero.Items.get(id);
        if (att && att.attachmentContentType === "application/pdf") pool.push(att);
      }
    }
    for (const att of pool) {
      try {
        const p = await att.getFilePathAsync();
        if (target && p && normFilePath(p) === target) return att;
      } catch (e) {
        /* ignore */
      }
    }
  } catch (e) {
    debugLog("  findOriginalAttachment EXCEPTION: " + e);
  }
  return null;
}

/**
 * 把译文文件放到原 PDF 同目录（优先 move，失败则 copy；都失败返回原位置）。
 */
async function placeBesideOriginal(filePath: string, parentFilePath: string): Promise<string> {
  try {
    const src = Zotero.File.pathToFile(filePath);
    const parent = Zotero.File.pathToFile(parentFilePath);
    const dir = parent.parent;
    if (!dir || !dir.isDirectory()) return filePath;
    const srcBase = src.leafName || "translated.pdf";
    const parentBase = parent.leafName || "original.pdf";
    // 防同名冲突：若与原文同名则加 -translated 后缀
    let name = srcBase;
    if (normFilePath(srcBase) === normFilePath(parentBase)) {
      const dot = parentBase.lastIndexOf(".");
      name = parentBase.slice(0, dot) + "-translated" + parentBase.slice(dot);
    }
    const dst = dir.clone();
    dst.append(name);
    if (dst.exists()) {
      try {
        dst.remove(false);
      } catch (e) {
        /* ignore */
      }
    }
    try {
      await (globalThis as any).IOUtils.move(filePath, dst.path);
      return dst.path;
    } catch (e1) {
      try {
        await (globalThis as any).IOUtils.copy(filePath, dst.path);
        return dst.path;
      } catch (e2) {
        return filePath;
      }
    }
  } catch (e) {
    return filePath;
  }
}

function autoFocusEnabled(): boolean {
  return prefGet("autoFocus", true) !== false;
}

/**
 * Zotero 9 RequestHandler._processEndpoint does `new this.endpoint()`,
 * so endpoints must be registered as constructor functions (classes).
 */
class AttachEndpoint implements ZoteroEndpoint {
  supportedMethods = ["POST"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  init = async (options: { data?: unknown }): Promise<[number, string, string]> => {
    try {
      debugLog("=== /pdf2zh/attach POST received ===");
      const data =
        typeof options.data === "string" ? JSON.parse(options.data) : (options.data || {});
      const itemKey: string = data.itemKey;
      const filePath: string = data.filePath;
      const title: string | undefined = data.title;
      const parentFilePath: string | undefined = data.parentFilePath;
      debugLog(
        "  itemKey=" +
          itemKey +
          " title=" +
          JSON.stringify(title) +
          " filePath=" +
          JSON.stringify(filePath) +
          " parentFilePath=" +
          JSON.stringify(parentFilePath)
      );

      if (!itemKey || !filePath) {
        debugLog("  missing itemKey or filePath");
        return [
          400,
          "application/json",
          JSON.stringify({ error: "Missing required fields: itemKey, filePath" }),
        ];
      }

      // Look up the item in the user library first, then all libraries (group libraries)
      let item: any = null;
      try {
        item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, itemKey);
      } catch (e) {
        /* ignore */
      }
      if (!item && (Zotero.Libraries as any).getAll) {
        const libs = (Zotero.Libraries as any).getAll();
        for (const lib of libs) {
          try {
            item = Zotero.Items.getByLibraryAndKey(lib.libraryID, itemKey);
            if (item) break;
          } catch (e) {
            /* ignore */
          }
        }
      }
      debugLog("  item lookup -> " + (item ? "found id=" + item.id : "NOT FOUND"));
      if (!item) {
        return [404, "application/json", JSON.stringify({ error: "Item not found: " + itemKey })];
      }

      const parentID = item.parentItemID || item.id;
      debugLog("  parentID=" + parentID + " creating attachment...");

      // Linked attachments (e.g. moved by zotmoov) live outside Zotero storage.
      // When the original is LINKED_FILE (API linkMode=3), make the translation
      // a linked file placed beside the original; otherwise keep imported behavior.
      // NOTE: Zotero 9 importFromFile ignores the linkMode option (always imports);
      // linked attachments must use Zotero.Attachments.linkFromFile.
      let srcAttachment: any = null;
      if (parentFilePath) {
        srcAttachment = await findOriginalAttachment(item, parentFilePath);
        debugLog(
          "  original attachment -> " +
            (srcAttachment
              ? "found key=" + srcAttachment.key + " linkMode=" + srcAttachment.attachmentLinkMode
              : "NOT FOUND (will keep imported mode)")
        );
      }

      let attachment: any;
      let linkedToParent = false;
      let dstPath: string | null = null;
      if (srcAttachment && srcAttachment.attachmentLinkMode === 2 /* Zotero 9: LINK_MODE_LINKED_FILE = 2 */) {
        dstPath = await placeBesideOriginal(filePath, parentFilePath as string);
        debugLog("  placing translated file at " + dstPath + " (linked attachment)");
        try {
          attachment = await (Zotero.Attachments.linkFromFile as any)({
            file: dstPath,
            parentItemID: parentID,
            title: title || "Translated PDF",
            contentType: "application/pdf",
          });
          linkedToParent = true;
        } catch (linkErr) {
          // Fall back to imported if this version restricts linked files outside the base dir
          debugLog("  linked linkFromFile FAILED: " + linkErr + " -> fallback to imported");
          let src2 = filePath;
          try {
            if (!fileExists(filePath) && dstPath) src2 = dstPath;
          } catch (e) {
            /* ignore */
          }
          attachment = await (Zotero.Attachments.importFromFile as any)({
            file: src2,
            parentItemID: parentID,
            title: title || "Translated PDF",
            contentType: "application/pdf",
          });
          linkedToParent = false;
        }
      } else {
        attachment = await (Zotero.Attachments.importFromFile as any)({
          file: filePath,
          parentItemID: parentID,
          title: title || "Translated PDF",
          contentType: "application/pdf",
        });
      }
      debugLog(
        "  attachment created: key=" +
          attachment.key +
          " id=" +
          attachment.id +
          " linkMode=" +
          attachment.attachmentLinkMode
      );

      if (title) {
        attachment.setField("title", title);
        await attachment.saveTx();
        debugLog("  title override saved");
      }

      // Auto-focus the item in Zotero after translation (can be disabled in settings)
      try {
        if (autoFocusEnabled()) {
          const pane = Zotero.getActiveZoteroPane();
          if (pane && pane.selectItem) pane.selectItem(item.id);
          debugLog("  auto-focused item id=" + item.id);
        }
      } catch (e) {
        debugLog("  auto-focus failed (ignored): " + e);
      }

      debugLog("  === /pdf2zh/attach DONE ok ===");
      return [
        200,
        "application/json",
        JSON.stringify({
          key: attachment.key,
          id: attachment.id,
          linkedToParent: linkedToParent,
          filePath: linkedToParent ? dstPath || filePath : filePath,
        }),
      ];
    } catch (e: any) {
      debugLog(
        "  /pdf2zh/attach EXCEPTION: " + e + " stack=" + (e && e.stack ? e.stack : "no-stack")
      );
      return [500, "application/json", JSON.stringify({ error: String(e) })];
    }
  };
}

class PingEndpoint implements ZoteroEndpoint {
  supportedMethods = ["GET"];
  supportedDataTypes = ["application/json"];
  permitBookmarklet = false;

  // 必须声明至少一个参数：Zotero 9 用 init.length 判断调用方式（1=对象式，0/2+=回调式）
  init = async (_options: { data?: unknown }): Promise<[number, string, string]> => {
    return [200, "application/json", JSON.stringify({ status: "ok", plugin: "pdf2zh-connector" })];
  };
}
export function registerHttpEndpoints(): void {
  try {
    const endpoints = (Zotero.Server.Endpoints as any) || {};
    endpoints["/pdf2zh/attach"] = AttachEndpoint;
    endpoints["/pdf2zh/ping"] = PingEndpoint;
    debugLog("HTTP endpoints registered");
  } catch (e) {
    debugLog("registerHttpEndpoints FAILED: " + e);
  }
}

export function unregisterHttpEndpoints(): void {
  try {
    delete (Zotero.Server.Endpoints as any)["/pdf2zh/attach"];
  } catch (e) {
    /* ignore */
  }
  try {
    delete (Zotero.Server.Endpoints as any)["/pdf2zh/ping"];
  } catch (e) {
    /* ignore */
  }
}
