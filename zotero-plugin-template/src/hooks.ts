import { getString, initLocale } from "./utils/locale";
import { debugLog } from "./utils/debug";
import {
  registerHttpEndpoints,
  unregisterHttpEndpoints,
} from "./modules/httpEndpoints";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { installContextMenus, uninstallContextMenus } from "./modules/contextMenu";

/**
 * PaperFlow Connector 生命周期：
 *   startup       → 注册 HTTP 端点 + 设置面板 + 对已开窗口安装右键菜单
 *   主窗口加载    → 安装条目树右键菜单 + reader 菜单事件
 *   shutdown      → 全部反注册
 */

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  registerHttpEndpoints();

  await registerPrefsPane();

  // Zotero 9 首次启动时 bootstrap 的 onMainWindowLoad 可能漏触发
  // （主窗口 load 早于插件窗口监听器注册，见 plugins.js）。仿照 better-notes：
  // 在 uiReady 后主动对已打开的主窗口安装右键菜单；后续新窗口仍走 onMainWindowLoad。
  try {
    const wins: any[] = (Zotero as any).getMainWindows();
    for (const win of wins) {
      try {
        installContextMenus(win as unknown as Window);
      } catch (e) {
        debugLog("install menus on existing window error: " + e);
      }
    }
    debugLog("menus installed on " + wins.length + " existing window(s)");
  } catch (e) {
    debugLog("getMainWindows error: " + e);
  }

  addon.data.initialized = true;
  debugLog("startup complete");
}

async function registerPrefsPane() {
  try {
    // await 注册结果：Zotero 9 的 PreferencePanes.register 是异步的，
    // 不 await 的话失败会被吞掉，日志里看不到真实原因
    const paneID = await Zotero.PreferencePanes.register({
      pluginID: addon.data.config.addonID,
      id: "paperflow-pref-pane",
      src: `chrome://${addon.data.config.addonRef}/content/preferences.xhtml`,
      label: getString("prefs-title"),
      image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
    });
    debugLog("preference pane registered: " + paneID);
  } catch (e) {
    debugLog("preference pane register FAILED: " + e);
  }
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow) {
  debugLog("onMainWindowLoad fired");
  installContextMenus(win as unknown as Window);
}

async function onMainWindowUnload(win: Window) {
  // 菜单清理统一在 onShutdown 执行
}

function onShutdown() {
  unregisterHttpEndpoints();
  uninstallContextMenus();
  try {
    Zotero.PreferencePanes.unregister(addon.data.config.addonID);
  } catch (e) {
    /* ignore */
  }
  addon.data.alive = false;
}

async function onPrefsEvent(type: string, data: { window: Window }) {
  if (type === "load") {
    await registerPrefsScripts(data.window);
  }
}

export default {
  onStartup,
  onMainWindowLoad,
  onMainWindowUnload,
  onShutdown,
  onPrefsEvent,
};
