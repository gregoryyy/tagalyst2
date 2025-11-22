# TODOs and Roadmap for Tagalyst 2

Also see Issues: https://github.com/gregoryyy/tagalyst2/issues

Bugs / Cleanup
- Ensure toolbar state fully tears down on project overviews (page classifier and detection reliable).
- Improve keyboard shortcut robustness across SPA URL changes.
- Revisit overview ruler drag behavior; ensure focus click/drag is smooth.

Next
- Cross-chat operations: search/export across threads, document assembly from tags/annotations. (Issues: #7, #9)
- Additional page classifiers (e.g., for project overviews or future surfaces like Gemini) and attach controllers conditionally. (Issues: #12)
- Performance tuning under large threads; smooth scroll/navigation and highlight rendering. (Issues: #10)
- Optional Shadow DOM for toolbar isolation. (Issues: #11)

Moonshots
- Text-based interface / agent (WebLLM + command API) for organizing content.
- Generalize to arbitrary web pages (meta-layer akin to Hypothesis, focused on personal organization).


Status / Backlog

Done / Current
- TS refactor and module split landed; services/controllers/dom adapters are separate; page classifier added to gate UI to conversation pages only.
- Toolbar/top panels/overview ruler/highlight/keyboard wiring stable for `/c/...` threads (including project threads); overview pages skip UI.
- Highlights + annotations reuse consistent textarea editor; tag editor saves on Enter; note editor saves on Ctrl/Cmd+Enter.
- Markdown export filters out UI, handles LaTeX/canvas, supports focus subsets.
- Tests: Jest unit/jsdom + load smoke; optional Puppeteer E2E smoke (skips unless puppeteer-core + executable path/full Puppeteer).
- Storage import/export/clear present in Options; YAML keymap drives keyboard shortcuts with fallback defaults.
- Issue refs: #1 (refactor), #2 (export fixes), #3 (tests), #4 (annotations/highlights), #5 (page gating), #6 (keyboard YAML)
