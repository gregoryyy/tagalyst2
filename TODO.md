# Tasks for Tagalyst 2


Bugs:

- navigation and layout:
  - collapse misses Canvas
  - collapse hides topmost query/toolbar
  - topmost toolbar hides ChatGPT control (Share)
- export:
  - filter out UI and extension stuff
  - allow targeted exports (stars, filter results, tags)
- keep tags and annotations displayed when editing DONE
- when user clicks a new focus that isn't a chat (project overview), clear toolbar state
- error in promise while loading extension

Features:

- cardinal numbers for pairs (left aligned for prompts, same y as query message toolbar)
- navigate by highlighted item:
  - if search results or tags, this means navigation runs via these.
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
