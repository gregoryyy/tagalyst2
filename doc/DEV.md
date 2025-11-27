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

## Natural-language compiler

In a way, an LLM becomes a compiler for natural language, extending the classic toolchain toward the level where software concepts are conceived: A traditional compiler automates only the final step from a rigorously structured programming language to machine code. With LLMs, automation moves higher up the abstraction ladder: Specifications now come from humans and from domain-specific language that may be conceptual rather than technical. The human architect defines intent, constraints, and UX; the LLM—acting as encyclopedic assistant, reviewer, and junior developer—translates this intent into code; and the human guides and corrects the result. 

One of the reasons why product managers and developers exist is translation between knowledge domains. When the users know what they want -- due to their own domain experience, they cannot specify it to the machine, not even to developers because they tend to have a different mindset. Product managers help translate the user needs and requirements (often elicit the true needs), and developers need to formalize this into actual design and code (often elicit the true architecture). LLMs excel at bridging a large part of the gap between users and machine.

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

# Lessons learnt

Some of these are reminders of previous experience, some are new to the workflow used in this project.

## What works
- **Ask open questions** about how to design a system or feature and filter the answer
  - Be specific, refer to specific locations
  - The LLM will give some average engineer's opinion, ask back to get answers of a very top engineer
  - Be critical if the response isn't satisfactory --> rephrase
- **Plan work beforehand** and document it in a text
  - Ask for plan suggestions
  - Refer to the plan in steps, you can number them
  - Adjust steps as needed and according to the success of previous steps
- **Reference context** after first describing it
  - Files and their meaning within the codebase are known well
  - Introduce terminology to refer to
  - Ask about the best terminology and use it
  - First mention wider context, like "part 1 step 1" and then "step 2" only
- **Start with analysis** to setup up context
  - For new project, specify the goals
  - For project continued in a new conversation, start with "analyze codebase"
  - Query design improvements regularly, specify nonfunctional qualities

## Caution
- **Copilot not Autopilot** is the name of the game
  - 100% automated code from natural language to maintainable codebase is unrealistic
  - Implementation often misses the 100% mark
  - --> Review, test visually and perform formal tests is important -- LLMs can hugely help coming up with tests according to your specifications 
- **LLM positivity** misleads to implement complex things that don't work
  - Sometimes simple solutions get bloated by incremental code -- similar to manually written code bases
  - --> Question responses with a designer mind and domain expert
- **Context** sometimes overwhelms the model
  - Size is a key factor: Check percentage of context window
  - Sometimes randomly context derails the conversation, possibly mixing too many things.
  - --> Start fresh conversation if it becomes cluttered and imprecise
- **Task completion** needs to be checked
  - Often tasks discussed or specified as steps are not completed
  - Esp. tests autogenerated are often too trivial
  - --> Ask back what work is open or tests should be more specific
  - --> The more specific you are, the better the result or a specific justification why something is future work
- **Avoid destructive automation** for safety reasons
  - Agents deleting files, external API calls or repository maintenance.
  - --> Set up for manual approval or keep this as a manual step.

## Bottom line
- **LLMs transform your content** into whatever form and with whatever side-conditions: code, queries, documentation. 
  - For code, this means they capture the meaning of a specification and the structure of any existing codebase, meanwhile also larger codebases. 
  - For queries, LLMs can translate this to locations in the code or respond with knowledge captured in their training set or other context documents -- including coding guidelines, design rules and similar
  - For system behavior, they reproduce what you've specified, if you haven't specified anything, they most likely revert to their training data.
  - **Errors do happen**, as with every translation or summarization, for lack of specification and random reasons (hallucinations)
- **LLMs don't think for you** when you develop your project
  - There are no symbols and no notion of true and false, just content transformations and combinations, see above
  - Rules are reproduced as continuations and sometimes combined, in often relevant, sometimes funny ways because the logic is not reasoned about: LLMs performance collapses in non-trivial deductions, like multi-hop reasoning; contradictions in context lead to unpredictable results
  - **Ask about coverage** of a particular prompt or task has in the context, which consists of the codebase, the LLM training, your previous conversation. If the coverage is too shallow for the task at hand, responses resort to averaging or randomizing model knowledge.

Grand total: LLMs revolutionize software engineering, but they don't replace (yet) good design ideas and engineering. They are extremely powerful content transformation engines. LLM-based coding will produce *very* different results if done by a non-expert and an expert developer.

In practical terms for you as developers: Keep AI on a short leash: Do the thinking, especially about purpose and larger context of your work that the LLM cannot know, use plans/fixtures/tests as explainable ground truth. Question results, never trust totally.

LLM-copiloted code can absolutely be maintainable, even for non-UI use cases.
