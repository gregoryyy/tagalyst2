# TODOs and Roadmap for Tagalyst 2

Bugs:

Refactor to ts: DONE
- like for like DONE
- iterative changes see ARCH.md DONE

Refactor to split modules:
- document content.ts
- create a refactor map: refactor.md
  - split files
  - 

Behavioral Bugs:
- navigation and layout:
  - collapse misses Canvas
  - collapse hides topmost query/toolbar DONE
  - topmost toolbar hides ChatGPT control (Share) DONE
  - when outside conversation view, hide toolbars
- export:
  - filter out UI and extension stuff DONE
  - handle LaTeX export DONE
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
  - no star leads to navigate between plain (user) messages
    - BUG: Opening a chat should recognize if there's a star already
  - export filters by focused items DONE
    - BUG: control stuff included, no full markup FIXED
  - overview ruler ONGOING --> feature/overview_ruler
    - more expressive overview ruler content, hover expand option
    - act like a scrollbar:click into track navigates, drag on thumb
      - BUG: no reasonable dragging
    - act like a diff ruler: click on focus item navigates
- export without UI content but with:
  - links to graphics
  - mathematical content, i.e., KaTeX DONE
  - canvas and listings DONE
- Text range markup within responses DONE --> feature/text_highlight
  - annotate markup DONE
  - show highlights in overview ruler --> after merge feature/text_highlight, feature/overview_ruler DONE
- Cross-chat operations:
  - search including tags and annotations --> search results on dedicated dialog
  - create document from tags and annotations
- Export visible thread to Markdown (DOM-only) DONE
  - Selection within thread: tags, stars, search results
  - Assemble across threads: export session
- Optional Shadow DOM for toolbar isolation

Moonshots:
- text-based interface that allows text-based interaction with the texts
  - using WebLLM with finetuning
  - command API to internal extension functions
- user agent
  - use case: create glossary of what has been discussed
- generalize for arbitrary web pages:
  - meta-layer over browsing data
    - similar to Hypothesis but sleeker
    - less about sharing than organizing
