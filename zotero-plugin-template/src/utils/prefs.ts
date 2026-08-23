import { config } from "../../package.json";

/**
 * 读写插件偏好（scaffold 构建时会自动把 addon/prefs.js 与 preferences.xhtml 里的
 * 短键名扩展为 `${config.prefsPrefix}.<key>`，这里保持一致）。
 */
export function prefGet(key: string, def: any): any {
  try {
    return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true);
  } catch (e) {
    return def;
  }
}

export function prefSet(key: string, value: any): void {
  try {
    Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
  } catch (e) {
    /* ignore */
  }
}
