# Windows Quality and Translation Integrity Design

## Purpose

Improve the Windows-only desktop application in three connected areas: prevent silent translation loss, verify every user-facing control, and add a translation-integrity report that makes incomplete output visible and recoverable.

## Scope

- Target Windows 10 and Windows 11 only.
- Cover the PyQt5 application in `ui/`, the bundled `pdf2zh` translation pipeline in `core/site-packages/pdf2zh/`, configuration handling, PDF preview, history, AI tools, table translation, and Zotero integration.
- Preserve existing output formats: mono, dual, and side-by-side.
- Preserve current user changes and avoid unrelated refactoring.
- Do not add macOS or Linux compatibility work.

“Every UI control” means every visible button, menu action, checkbox, combo box, editable field, list action, and navigation control that can be reached in a normal Windows session. Automated tests may simulate external services, dialogs, Explorer, Zotero, network access, and application restart; a smaller end-to-end matrix will exercise real local PDF operations.

## Recommended Approach

Use a layered test-and-fix approach. First create an inventory that detects unconnected or unreachable controls. Then add focused tests around each page and external boundary. Fix translation integrity at the shared translator layer so every output mode benefits. Finally add an integrity report to the existing completion flow instead of introducing a separate subsystem.

This is preferred over a manual-only button review because it is repeatable, and over a broad UI rewrite because the current interface already contains the required workflows.

## Translation Integrity

### Long-input handling

Each translation provider declares its maximum request size. Inputs exceeding that limit are split at paragraph, sentence, whitespace, and hard-character boundaries, in that order. Formula placeholders such as `{v12}` remain atomic and chunks are translated in order before being joined.

The Bing provider must never silently execute `text[:1000]`; the Google provider must never silently execute `text[:5000]`. Limits may still be respected, but only through explicit chunking.

### Result validation

Before caching or rendering, the shared translator validates that:

- the result is a non-empty string for non-empty translatable input;
- every formula placeholder in the source occurs in the result;
- no chunk is missing from the assembled response;
- provider errors and empty model responses are represented as failures, not successful empty translations.

Failed validation triggers bounded retries. If retries are exhausted, the original source is retained in the PDF and the failure is recorded. Invalid or partial results are never cached. Existing corrupt cache entries are rejected when they fail the same validation during lookup.

### Integrity report

Translation completion returns an integrity summary containing total segments, translated segments, retried segments, failed segments, and affected pages. The completion UI shows a concise success or warning message and allows the user to copy diagnostic details. The existing output files remain available even when some segments fail.

## Windows UI Verification

Create a test-only control inventory that walks the widget tree after the main window is constructed. Controls receive stable object names where needed. Tests verify visibility/reachability, enabled-state transitions, signal connections, page navigation, cancellation, and safe behavior when no file or configuration is selected.

The verification matrix covers:

- translation file management, page ranges, service selection, output modes, start, cancel, retry, and random greeting;
- PDF preview modes, open, paging, zoom, fit modes, continuous view, rotation menu, highlights, erase, full screen, history, and AI question panel;
- history grouping, selection, thumbnails, reveal/open-source operations, deletion, and clearing;
- settings for translation services, connection testing, prompts, glossaries, themes, cache, layout, fonts, data directory, and Zotero installation/options;
- summary, AI chat, prompt presets, update actions, external links, copy actions, and application close behavior.

Tests must not launch Explorer, a browser, Zotero, or network calls directly. Those boundaries are mocked and their requested arguments are asserted. Windows path handling is tested with spaces, Unicode, long filenames, missing files, and locked files.

## Test Architecture

Add a `tests/` suite using `pytest`, `pytest-qt`, and the Qt offscreen platform for automated UI tests. Translation-provider tests use deterministic fake sessions and fake OpenAI-compatible responses. PDF regression tests use small checked-in fixtures plus the reported paper when it is available locally; the checked-in suite must not depend on that external desktop path.

The suite is divided into:

- fast unit tests for chunking, validation, caching, parsing, and Windows paths;
- page-level UI tests for controls and signal wiring;
- worker integration tests for success, cancellation, retry, and failure reporting;
- PDF regression tests that compare extracted source coverage, placeholder preservation, page counts, and renderability;
- a short manual Windows release checklist for native dialogs, Explorer, Zotero, DPI scaling, and packaged executable startup.

## Error Handling

User-facing failures identify the affected file and action without exposing credentials. Diagnostic logs include provider name, page, segment identifier, retry count, and validation reason, but never API keys or full authorization headers. Destructive actions such as clearing history retain their existing confirmation behavior.

## Acceptance Criteria

- Bing and Google translate text beyond their per-request limits without losing the tail.
- Empty, partial, or placeholder-damaging translations are retried and never cached as successes.
- A failed segment remains visible as source text and appears in the integrity report.
- Every reachable Windows UI control has an automated construction/wiring test and an entry in the verification matrix.
- Core workflows pass against representative text PDFs, formula-heavy PDFs, table PDFs, and the reported long-reference PDF.
- Mono, dual, and side-by-side outputs open successfully and preserve expected page structure.
- The packaged Windows application completes the manual release checklist on Windows 10 or 11.
- No unrelated user changes are overwritten.

## Out of Scope

- Redesigning the visual appearance of the application.
- Supporting operating systems other than Windows.
- Guaranteeing availability or correctness of third-party translation services.
- Automating real credentials, real paid API calls, or installation into a user’s live Zotero profile during the test suite.
