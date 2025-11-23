# Development Approach (Tagalyst 2)

This project blends natural-language collaboration with disciplined engineering practice. We combine architectural intent, iterative planning, and AI assistance to move from ideas to tested code and UI behavior.

## AI vs. Human Roles
The LLM acts as:
- encyclopedia (design references and background),
- static code analyzer (sizing design quality and coupling),
- debugging assistant (dev-time and run-time errors),
- search assistant (locating code/behavior),
- junior coding partner (beyond scaffolding/boilerplate), and
- expert design reviewer (augmenting the experienced human designer).

The human engineer acts as:
- architect and product owner (intent, constraints, UX goals),
- reviewer/QA (code, behavior, UI),
- planner (defining and adjusting goals/steps),
- systems integrator (wiring, dependencies, release readiness).

## Hypothesis
The difference between vibe coding and AI-assisted engineering is the human-led understanding of objectives, engineering methods, constraints and context.


## Workflow
- **Objectives, constraints, UX intent, designs** are made explicit and written down and part of the LLM context.
- **Conversation-driven input:** Requirements and design intent arrive as natural-language from architect/engineer. They translate into full-code changes. Discussion is at a high-level design as well as a technical level, like instructing and discussing with a junior engineer.
  - **Filtered AI suggestions and human adjustments:** Ask open questions to LLM and analyze them against knowledge about software engineering practice and domain context. Human adjustments guide the AI of the default path.
  - **Continuous review:** We review outputs at code, debug, and UI levels and feed back findings in natural language. The loop surfaces regressions and UX mismatches early.
- **Design guidance via LLM:** We ask the LLM for patterns and tradeoffs, then filter and channel that guidance into actionable design plans; AI advice is treated as input and expert knowledge, not authority. We posit that this makes the difference between unmaintainable vibe-codebases and a rapid-development cycle aiming for production quality.
  - **Plan before larger actions:** Define goals and sub-steps, document them, so the LLM can refer to them as explicit context. Re-plan when assumptions change.
  - **Execution with tests:** Implement planned steps, set up or extend tests, and aim for behavioral coverage (BDD loop mindset) so features are validated by observable behavior.
  - **Branch and review:** Use issue-linked branches; review code/debug/UI outputs before merge. Rebase/sync to keep parallel AI/human work aligned.
- **Tool support:** VS Code + Codex for agentic edits, Jest for fast feedback, Puppeteer/HTML captures for DOM fixtures, and GitHub issues/PRs as the workflow spine.
  - **Github flow:** Using issues as main artifacts for requirements, with feature branches implementing into them.
  - **VS Code with OpenAI Codex on `gpt-5.1-codex-max`:** Used as agentic interface but with human approval for destructive actions and an eye on the context size (balancing between context knowledge and deteriorating accuracy). 
  - **Parallel branches:** Since the system requires response time and human review is relatively quick, two or more parallel branches can be worked on, allowing multiple AI junior coders to work in parallel.

## Quality Principles
- **Intentional architecture:** Keep adapters/services/controllers aligned with the documented structure (see `doc/ARCH.md`), and isolate ChatGPT-specific DOM details behind adapters.
- **Feedback integration:** Treat manual understanding of objectives and context as the key differentiator from “vibe coding”; use AI to accelerate, not to guess requirements.
- **Validation:** Prefer fast local tests and UI checks; use fixtures and real DOM captures where possible to ground changes.
