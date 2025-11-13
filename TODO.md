# TODOs and Roadmap for Tagalyst 2

Bugs:

Refactor to ts:
- like for like DONE
- iterative changes see ARCH.md DONE

Behavioral Bugs:
- navigation and layout:
  - collapse misses Canvas
  - collapse hides topmost query/toolbar
  - topmost toolbar hides ChatGPT control (Share)
  - when outside conversation view, hide toolbars
- export:
  - filter out UI and extension stuff
  - allow targeted exports (stars, filter results, tags)
- keep tags and annotations displayed when editing DONE
- when user clicks a new focus that isn't a chat (project overview), clear toolbar state
- DOM and UI errors:
  - error in promise while loading extension (Extension context invalidated): promise: around getStore.  CLOSED? disappeared
  - MANY: The resource <URL> was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it has an appropriate `as` value and it is preloaded intentionally.
  - MANY: [Violation] Forced reflow while executing JavaScript took 47ms etc., possibly aggravated by tag and search panel. DONE

Codebase:

- add tests
  - unit via Jest MERGE add 
  - DOM via Puppeteer (Playwright has issue on MacOS)
- fix performance errors (see bugs)
- packaging for marketplace deployment MERGE

Features:

- settings DONE
- memory management:
  - delete local storage DONE
  - load / save file DONE
- metadata:
  - cardinal numbers for pairs (left aligned for prompts, same y as query message toolbar) DONE
  - message size DONE
  - tag and search results size DONE
- navigate by highlighted item:
  - if search results or tags, this means navigation runs via these. DONE
    - BUG: after search or tag selection, becomes unresponsive FIXED
  - export filters by focused items
  - overview ruler WIP
- export without UI content but with:
  - links to graphics
  - mathematical content, i.e., KaTeX
  - canvas and listings
- Text range markup within responses
- Cross-chat operations:
  - search including tags and annotations --> search results on dedicated dialog
  - create document from tags and annotations
- Export visible thread to Markdown (DOM-only)
  - Selection within thread: tags, stars, search results
  - Assemble across threads: export session
- Optional Shadow DOM for toolbar isolation
