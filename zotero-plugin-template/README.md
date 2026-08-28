# pdf2zh Connector（Zotero 插件）

配合 [pdf2zh-desktop](https://github.com/AaronGIG/pdf2zh-desktop) 使用的 Zotero 右键翻译插件。

- 在 Zotero 条目树或 PDF 阅读器内对 PDF 右键 → 「📖 用 PaperFlow 翻译」
- 翻译完成后译文自动挂回原条目：普通附件导入 storage；**链接附件**（zotmoov 等移走的 PDF）放回原 PDF 同目录并链接关联
- 插件设置面板：Zotero → 设置 → pdf2zh 翻译（默认格式、静默翻译、完成后定位、程序路径）
- 支持 Zotero 7 / 8 / 9，通过 `updates.json` 自动更新

## 构建

```bash
npm install
npm run build
```

产物：`.scaffold/build/pdf2zh-connector-vX.Y.Z.xpi`。
发布时同步到仓库根目录 `pdf2zh-connector-vX.Y.Z.xpi` 与 `assets/pdf2zh-connector.xpi`（桌面端「一键安装插件」使用的包）。

## 目录结构

- `src/modules/httpEndpoints.ts` — `POST /pdf2zh/attach`（挂回译文附件）+ `GET /pdf2zh/ping`（健康检查）
- `src/modules/contextMenu.ts` — 条目树 / PDF 阅读器右键菜单
- `src/modules/preferenceScript.ts` / `src/modules/prefs.ts` — 设置面板
- `src/modules/launcher.ts` — 唤起 PaperFlow并传入 `--zotero-key` / `--zotero-link-mode`

## 版本

- **v1.0.0**：品牌焕新 — 更名 **PaperFlow Connector for Zotero**（作者 gw），插件 ID 改为 `paperflow-connector@gw.com`，需卸载旧插件后重装
- **v1.0.31**：修复设置面板「浏览应用路径」无效（Zotero 7/9 移除 `Components`，改用 `Zotero.FilePicker`），支持手动输入路径
- **v1.0.30**：修复链接附件判断（Zotero 9 `LINK_MODE_LINKED_FILE = 2`，此前误判为 3），链接附件译文改用 `linkFromFile` 放回原目录；右键菜单与设置面板回归
- v1.0.29：右键菜单 / 设置面板重构（better-notes 模板）