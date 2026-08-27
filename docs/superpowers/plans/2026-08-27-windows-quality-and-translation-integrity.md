# Windows 版质量验证与翻译完整性实施计划

> **执行要求：** 实施时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项执行和审查。所有步骤使用复选框跟踪。

**目标：** 修复长文本翻译缺失和残缺缓存，为 Windows 桌面版全部可达 UI 控件建立验证，并新增翻译完整性报告。

**架构：** 在 `pdf2zh` 翻译基础层增加分段、校验和统计对象，Bing、Google 及 OpenAI 兼容服务共用完整性规则；通过现有转换器、工作线程和完成信号把报告传到界面。界面测试通过 Qt 离屏模式构造窗口并模拟外部边界，不进行真实联网或安装操作。

**技术栈：** Python、PyQt5、pytest、pytest-qt、Peewee/SQLite、PyMuPDF、现有 pdf2zh 转换流程。

**设计文档：** `docs/superpowers/specs/2026-08-27-windows-quality-and-translation-integrity-design.md`

## 全局约束

- 仅支持 Windows 10 和 Windows 11。
- 不覆盖工作区中与本任务无关的用户修改。
- 不在自动测试中调用真实付费接口、资源管理器、浏览器或用户的 Zotero 配置。
- 纯译文、双语对照和左右并排输出格式保持兼容。
- 无效译文不得写入缓存；最终失败时保留原文。

---

### 任务 1：建立 Windows 测试基础设施

**文件：**
- 新建：`pytest.ini`
- 新建：`tests/conftest.py`
- 新建：`tests/fixtures/sample_long_text.py`
- 新建：`tests/test_smoke_imports.py`
- 修改：Windows 构建依赖清单（以仓库实际使用的打包配置为准）

**接口：**
- 提供 `qapp`、隔离缓存数据库、临时配置目录和禁用外部启动的公共测试夹具。
- 后续任务通过 `tests/conftest.py` 获取这些夹具。

- [ ] **步骤 1：写一个失败的导入与 Qt 离屏测试**

```python
def test_windows_ui_imports(qapp):
    from ui.main_window import MainWindow
    assert MainWindow is not None
```

- [ ] **步骤 2：运行测试并确认当前环境缺少测试配置或依赖**

运行：`core/runtime/python.exe -m pytest tests/test_smoke_imports.py -v`

预期：首次运行因为 pytest/pytest-qt、导入路径或 Qt 平台配置缺失而失败。

- [ ] **步骤 3：配置 pytest、Qt 离屏平台和隔离目录**

```ini
[pytest]
testpaths = tests
addopts = -ra
```

在 `tests/conftest.py` 中设置 `QT_QPA_PLATFORM=offscreen`，将缓存、配置和临时输出指向 `tmp/test-runtime/`，并对 `subprocess.Popen`、`webbrowser.open` 等外部启动提供默认阻止夹具。

- [ ] **步骤 4：补齐仅用于开发测试的 pytest 与 pytest-qt 依赖并运行冒烟测试**

运行：`core/runtime/python.exe -m pytest tests/test_smoke_imports.py -v`

预期：通过，且没有打开任何窗口或外部程序。

- [ ] **步骤 5：提交任务 1**

```powershell
git add pytest.ini tests/conftest.py tests/fixtures/sample_long_text.py tests/test_smoke_imports.py
git commit -m "test: add Windows UI test harness"
```

---

### 任务 2：实现长文本分段和译文完整性校验

**文件：**
- 新建：`core/site-packages/pdf2zh/translation_integrity.py`
- 新建：`tests/test_translation_integrity.py`

**接口：**
- 提供 `split_translation_text(text: str, limit: int) -> list[str]`。
- 提供 `validate_translation(source: str, translated: str) -> tuple[bool, str]`。
- 提供 `TranslationIntegrityError(ValueError)`。
- 占位符匹配规则覆盖 `{v12}` 和 `{{v12}}`。

- [ ] **步骤 1：编写分段失败测试**

```python
def test_split_keeps_every_character_and_placeholder_atomic():
    source = "A" * 995 + " {v12} " + "B" * 300
    chunks = split_translation_text(source, 1000)
    assert "".join(chunks) == source
    assert any("{v12}" in chunk for chunk in chunks)
    assert all(len(chunk) <= 1000 for chunk in chunks)
```

- [ ] **步骤 2：编写空返回和占位符丢失测试**

```python
@pytest.mark.parametrize("translated,reason", [
    ("", "empty_translation"),
    ("已翻译但没有公式", "missing_placeholders"),
])
def test_validation_rejects_incomplete_result(translated, reason):
    ok, actual = validate_translation("source {v1}", translated)
    assert not ok
    assert actual == reason
```

- [ ] **步骤 3：运行测试确认失败**

运行：`core/runtime/python.exe -m pytest tests/test_translation_integrity.py -v`

- [ ] **步骤 4：实现最小分段器和校验器**

优先在段落、句号和空白处切分；没有安全边界时才按字符切分。切分前用正则识别占位符，禁止从占位符内部切开。

- [ ] **步骤 5：增加中文、英文、连续长字符串和多占位符边界测试**

运行：`core/runtime/python.exe -m pytest tests/test_translation_integrity.py -v`

预期：全部通过。

- [ ] **步骤 6：提交任务 2**

```powershell
git add core/site-packages/pdf2zh/translation_integrity.py tests/test_translation_integrity.py
git commit -m "feat: add translation integrity primitives"
```

---

### 任务 3：修复翻译服务、重试和缓存污染

**文件：**
- 修改：`core/site-packages/pdf2zh/translator.py:84-97`
- 修改：`core/site-packages/pdf2zh/translator.py:173-229`
- 修改：`core/site-packages/pdf2zh/cache.py:65-96`
- 新建：`tests/test_translator_chunking.py`
- 新建：`tests/test_translation_cache_validation.py`

**接口：**
- `BaseTranslator.max_request_chars: int | None` 声明服务限制。
- `BaseTranslator.translate()` 负责分段、逐段调用、校验、合并和仅缓存有效结果。
- Bing 设置 `max_request_chars = 1000`，Google 设置 `max_request_chars = 5000`。
- 缓存读取结果必须经过 `validate_translation()`。

- [ ] **步骤 1：编写 Bing 超过 1000 字符仍完整发送的失败测试**

```python
def test_bing_translates_all_chunks(fake_bing):
    source = "A" * 1356
    result = fake_bing.translate(source)
    assert sum(map(len, fake_bing.sent_texts)) == len(source)
    assert len(fake_bing.sent_texts) == 2
    assert result == source
```

- [ ] **步骤 2：编写空返回、占位符丢失和残缺缓存测试**

验证失败响应会重试；重试耗尽时抛出 `TranslationIntegrityError`；缓存中已有残缺结果时不得直接返回；失败结果不得产生新缓存记录。

- [ ] **步骤 3：运行定向测试确认当前硬截断导致失败**

运行：`core/runtime/python.exe -m pytest tests/test_translator_chunking.py tests/test_translation_cache_validation.py -v`

- [ ] **步骤 4：删除 Bing/Google 的字符串切片并接入通用分段流程**

保留各服务现有的实际请求代码，但每次只接收合法大小的单个分段。

- [ ] **步骤 5：实现最多 3 次的完整性重试**

仅重试当前失败分段；记录失败原因，不重复翻译已经成功的分段。网络库已有的限流重试保持不变。

- [ ] **步骤 6：验证缓存只保存完整合并结果**

运行：`core/runtime/python.exe -m pytest tests/test_translator_chunking.py tests/test_translation_cache_validation.py -v`

预期：全部通过；1356 字符样本不再丢失末尾。

- [ ] **步骤 7：提交任务 3**

```powershell
git add core/site-packages/pdf2zh/translator.py core/site-packages/pdf2zh/cache.py tests/test_translator_chunking.py tests/test_translation_cache_validation.py
git commit -m "fix: prevent silent translation truncation"
```

---

### 任务 4：在 PDF 中保留失败原文并生成完整性报告

**文件：**
- 修改：`core/site-packages/pdf2zh/converter.py:342-377`
- 修改：`ui/main_window.py:258-274`
- 修改：`ui/translate_worker.py:799-1056`
- 修改：`ui/main_window.py:4036-4096`
- 新建：`tests/test_integrity_report.py`
- 新建：`tests/test_translate_worker_integrity.py`

**接口：**
- 新增 `TranslationIntegrityReport`，字段为 `total_segments`、`translated_segments`、`retried_segments`、`failed_segments`、`affected_pages`、`failures`。
- `TranslateWorker.finished` 的字典增加 `integrity_report`，不改变现有 `mono`、`dual`、`side_by_side` 字段。
- 单段最终失败时转换器使用原文 `s` 作为排版内容。

- [ ] **步骤 1：编写失败段保留原文的测试**

```python
def test_failed_translation_falls_back_to_source():
    result, report = translate_segment_with_fallback("original", failing_translator)
    assert result == "original"
    assert report.failed_segments == 1
```

- [ ] **步骤 2：编写工作线程完成结果兼容性测试**

检查三个旧路径字段仍存在，新增报告可序列化，受影响页码按升序去重。

- [ ] **步骤 3：运行测试确认失败**

运行：`core/runtime/python.exe -m pytest tests/test_integrity_report.py tests/test_translate_worker_integrity.py -v`

- [ ] **步骤 4：在转换器和 GUI 镜像补丁中统一接入失败回退**

两个 `receive_layout` 路径必须使用相同辅助函数，避免核心版本与桌面补丁行为分叉。

- [ ] **步骤 5：在翻译完成界面显示摘要和可复制详情**

成功时显示“完整性检查通过”；存在失败时显示失败段数和页码，并提供复制诊断信息的入口，不阻止用户打开输出文件。

- [ ] **步骤 6：运行定向测试**

运行：`core/runtime/python.exe -m pytest tests/test_integrity_report.py tests/test_translate_worker_integrity.py -v`

- [ ] **步骤 7：提交任务 4**

```powershell
git add core/site-packages/pdf2zh/converter.py ui/main_window.py ui/translate_worker.py tests/test_integrity_report.py tests/test_translate_worker_integrity.py
git commit -m "feat: report translation integrity failures"
```

---

### 任务 5：建立全部 Windows UI 控件清单并验证信号

**文件：**
- 新建：`tests/ui/control_inventory.py`
- 新建：`tests/ui/test_translate_page.py`
- 新建：`tests/ui/test_preview_page.py`
- 新建：`tests/ui/test_history_page.py`
- 新建：`tests/ui/test_settings_page.py`
- 新建：`tests/ui/test_main_window.py`
- 修改：`ui/main_window.py`（只为缺少稳定标识的控件补充 `objectName`，并修复测试发现的真实问题）

**接口：**
- `collect_controls(root: QWidget) -> list[ControlRecord]` 返回对象名、控件类型、显示文本、是否启用、是否可见和父页面。
- `assert_expected_controls(root, expected)` 检查控件清单和唯一对象名。

- [ ] **步骤 1：生成当前界面控件基线并检查重复或空对象名**

测试至少覆盖翻译、预览、历史、设置、摘要/问答和主导航页面。

- [ ] **步骤 2：为翻译页编写交互测试**

验证添加、删除、清空、页码解析、服务选择、输出格式、开始、取消和失败重试；文件对话框和工作线程使用模拟对象。

- [ ] **步骤 3：为预览和历史页编写交互测试**

验证模式切换、翻页、适宽/适页、连续模式、旋转、高亮、擦除、全屏、历史筛选、打开源文件、删除和清空；禁止真正启动外部程序。

- [ ] **步骤 4：为设置及辅助功能编写交互测试**

验证服务字段切换、连接测试、提示词、术语表、主题、缓存、字体、Zotero 设置、数据目录、更新、链接和复制操作。

- [ ] **步骤 5：修复测试发现的未连接、错误启用状态或无反馈控件**

每次只修复一个行为并运行所属页面测试，禁止顺带重构整页。

- [ ] **步骤 6：运行全部 UI 测试**

运行：`core/runtime/python.exe -m pytest tests/ui -v`

预期：控件清单无遗漏、对象名唯一、所有测试不启动真实外部程序。

- [ ] **步骤 7：提交任务 5**

```powershell
git add ui/main_window.py tests/ui
git commit -m "test: verify Windows UI controls"
```

---

### 任务 6：增加 Windows 边界和 PDF 回归测试

**文件：**
- 新建：`tests/test_windows_paths.py`
- 新建：`tests/test_external_boundaries.py`
- 新建：`tests/test_pdf_regression.py`
- 新建：`tests/fixtures/pdfs/README.md`
- 新建：`docs/testing/windows-release-checklist.md`
- 按测试结果修改：`ui/translate_worker.py`、`ui/main_window.py` 或相关配置模块

**接口：**
- PDF 回归辅助函数返回页数、各页文本字符数、占位符集合和渲染成功状态。
- 外部边界测试只断言请求的程序路径、参数和目标文件。

- [ ] **步骤 1：编写 Windows 路径测试**

覆盖中文、空格、长文件名、不存在、只读和被占用文件，验证不通过 shell 拼接执行用户路径。

- [ ] **步骤 2：编写资源管理器、浏览器和 Zotero 边界测试**

模拟 `Start-Process`/`subprocess.Popen`/HTTP 调用，检查参数转义、失败提示和回退行为。

- [ ] **步骤 3：建立小型 PDF 回归样本和断言**

至少包含普通双栏文本、超长段落、公式占位符和表格四类；断言三种输出可打开、页数符合预期、长段落尾部标记仍存在。

- [ ] **步骤 4：用用户提供的论文执行额外回归**

如果文件存在，重点检查原 PDF 第 23 页的 `Alexandre Drouin` 与 `Pengfei Du` 内容在译文输出中不再整块缺失。该路径不得写死进正式测试。

- [ ] **步骤 5：编写 Windows 人工发布清单**

包含 Windows 10/11、100%/150%/200% DPI、原生文件对话框、资源管理器、Zotero、打包程序启动、取消翻译和三种输出预览。

- [ ] **步骤 6：运行边界和 PDF 测试**

运行：`core/runtime/python.exe -m pytest tests/test_windows_paths.py tests/test_external_boundaries.py tests/test_pdf_regression.py -v`

- [ ] **步骤 7：提交任务 6**

```powershell
git add tests docs/testing/windows-release-checklist.md ui/translate_worker.py ui/main_window.py
git commit -m "test: add Windows and PDF regressions"
```

---

### 任务 7：全量验证与交付

**文件：**
- 修改：`README.md`
- 修改：`README_EN.md`（只保留与现有双语文档一致所需的功能说明）
- 修改：`docs/testing/windows-release-checklist.md`

**接口：** 无新增运行时接口。

- [ ] **步骤 1：运行全部自动测试**

运行：`core/runtime/python.exe -m pytest -v`

预期：全部通过，无真实网络调用和外部程序启动。

- [ ] **步骤 2：检查代码和补丁完整性**

运行：`git diff --check`

检查没有残留调试输出、硬编码桌面路径、API Key、临时缓存数据库或生成 PDF。

- [ ] **步骤 3：启动 Windows 应用完成核心人工冒烟测试**

执行普通 PDF 翻译、取消、失败重试、三种格式预览、历史记录和设置保存。涉及 Zotero 的真实安装动作只有在用户明确授权时才执行。

- [ ] **步骤 4：重新验证问题论文**

确认原第 23 页长参考文献全部进入译文，完整性报告显示通过或明确列出仍失败的段落，且重新运行不会命中旧残缺缓存。

- [ ] **步骤 5：更新说明和发布清单结果**

README 说明新增的自动分段、完整性校验和失败回退；清单记录实际测试的 Windows 版本和未执行项目。

- [ ] **步骤 6：提交最终文档**

```powershell
git add README.md README_EN.md docs/testing/windows-release-checklist.md
git commit -m "docs: document translation integrity checks"
```

- [ ] **步骤 7：输出交付报告**

报告必须列出：已修复问题、按钮验证覆盖率、自动测试数量与结果、人工测试结果、已知限制、未执行的真实外部操作，以及用户现有修改是否保持不变。
