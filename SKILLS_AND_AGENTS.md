# AURA-Dx — Skills, Agents & Commands Reference

A catalog of every skill, agent, and command available in this Claude Code environment.

---

## How It Works

| Thing       | Invoke via                                      | Runs as                          |
| ----------- | ----------------------------------------------- | -------------------------------- |
| **Skill**   | `/<skill-name>` in prompt, or auto-invoked      | Instructions in conversation     |
| **Agent**   | Claude dispatches for multi-step/parallel work  | Separate background agent        |
| **Command** | `/<command-name>` in prompt                     | Predefined workflow              |

---

## Agents

### Built-in Agents

| Agent               | What it's for                                                |
| ------------------- | ------------------------------------------------------------ |
| `claude`            | Catch-all general agent for any task                         |
| `Explore`           | Read-only broad search — find definitions, map directories   |
| `general-purpose`   | Complex research, multi-step tasks, full tool access         |
| `Plan`              | Software architect — designs implementation plans            |
| `claude-code-guide` | Answers questions about Claude Code itself                   |
| `statusline-setup`  | Configures the Claude Code status line setting               |

### ECC Agents (`ecc:`)

| Agent                       | What it's for                                              |
| --------------------------- | ---------------------------------------------------------- |
| `ecc:architect`             | System design, scalability, technical decisions             |
| `ecc:planner`               | Complex features, architectural changes, refactoring plans  |
| `ecc:code-reviewer`         | Quality, security, maintainability review                  |
| `ecc:typescript-reviewer`   | TypeScript — type safety, async, idioms                    |
| `ecc:react-reviewer`        | React/JSX — hooks, server components, a11y                 |
| `ecc:python-reviewer`       | Python — PEP 8, type hints, security                       |
| `ecc:security-reviewer`     | Vulnerabilities, auth flaws, injection risks               |
| `ecc:database-reviewer`     | SQL, query performance, schema, migrations                 |
| `ecc:cpp-reviewer`          | C++ — memory safety, modern idioms, concurrency            |
| `ecc:rust-reviewer`         | Rust — ownership, lifetimes, error handling                 |
| `ecc:go-reviewer`           | Go — idiomatic patterns, concurrency safety                |
| `ecc:kotlin-reviewer`       | Kotlin — null safety, coroutines                           |
| `ecc:vue-reviewer`          | Vue.js — Composition API, reactivity, templates            |
| `ecc:php-reviewer`          | PHP — modern idioms, security, performance                 |
| `ecc:django-reviewer`       | Django — ORM, views, security, testing                     |
| `ecc:fastapi-reviewer`      | FastAPI — async, dependency injection, Pydantic            |
| `ecc:healthcare-reviewer`   | Clinical safety, PHI compliance, HIPAA                     |
| `ecc:mle-reviewer`          | ML engineering — model code, training pipelines            |
| `ecc:rag-pipeline-reviewer` | RAG — retrieval, embedding, generation patterns            |
| `ecc:pr-test-analyzer`      | PR test coverage and quality analysis                      |
| `ecc:a11y-architect`        | WCAG 2.2 compliance for Web and Native                     |
| `ecc:build-error-resolver`  | Generic build/TS error resolution, minimal diffs           |
| `ecc:react-build-resolver`  | React build failures — Vite/webpack/Next/CRA               |
| `ecc:cpp-build-resolver`    | C++ build errors, CMake, linker problems                   |
| `ecc:dart-build-resolver`   | Dart/Flutter build failures                                |
| `ecc:django-build-resolver` | Django build/startup errors                                |
| `ecc:go-build-resolver`     | Go build errors, go vet warnings                           |
| `ecc:java-build-resolver`   | Java/Gradle build errors                                   |
| `ecc:kotlin-build-resolver` | Kotlin/Gradle build errors                                 |
| `ecc:pytorch-build-resolver`| PyTorch build/import errors                                |
| `ecc:rust-build-resolver`   | Rust build errors, borrow checker                          |
| `ecc:swift-build-resolver`  | Swift build errors                                         |
| `ecc:code-explorer`         | Trace execution paths, map architecture                    |
| `ecc:code-architect`        | Design feature architecture from existing patterns         |
| `ecc:code-simplifier`       | Simplify code for clarity, preserve behavior               |
| `ecc:refactor-cleaner`      | Dead code removal, dedup, consolidation                    |
| `ecc:performance-optimizer` | Bottlenecks, slow code, bundle size, memory leaks          |
| `ecc:silent-failure-hunter` | Swallowed errors, bad fallbacks                            |
| `ecc:comment-analyzer`      | Comment accuracy, completeness, comment rot                |
| `ecc:type-design-analyzer`  | Type encapsulation, invariant expression                   |
| `ecc:tdd-guide`             | Enforces write-tests-first, 80%+ coverage                  |
| `ecc:e2e-runner`            | Generate/maintain/run E2E tests                            |
| `ecc:doc-updater`           | Update codemaps and architecture docs                      |
| `ecc:docs-lookup`           | Fetch library/framework docs via Context7 MCP              |
| `ecc:seo-specialist`        | SEO audits, structured data, Core Web Vitals               |
| `ecc:spec-miner`            | Extract behavioral specs from codebase                     |
| `ecc:agent-evaluator`       | Score agent output on 5-axis rubric                        |
| `ecc:harness-optimizer`     | Improve agent harness config                               |
| `ecc:loop-operator`         | Operate autonomous agent loops                             |
| `ecc:marketing-agent`       | Marketing strategy, positioning, copy                      |
| `ecc:chief-of-staff`        | Triage email/Slack into 4 tiers, draft replies             |
| `ecc:network-architect`     | Enterprise/multi-site network design                       |
| `ecc:network-troubleshooter`| Connectivity/routing/DNS diagnosis                         |
| `ecc:network-config-reviewer`| Router/switch config review                               |
| `ecc:homelab-architect`     | Home/small-lab network plans with rollback                 |
| `ecc:opensource-sanitizer`  | Scan fork for leaked secrets/PII                           |
| `ecc:opensource-forker`     | Fork for open-sourcing — strip secrets, clean history      |
| `ecc:opensource-packager`   | Generate CLAUDE.md, README, LICENSE, CONTRIBUTING          |
| `ecc:gan-planner`           | GAN harness — prompt to spec to implement, iterate         |
| `ecc:gan-generator`         | Generator half of GAN harness                              |
| `ecc:gan-evaluator`         | Evaluator half of GAN harness                              |
| `ecc:harmonyos-app-resolver`| HarmonyOS ArkTS/ArkUI build resolution                     |

### Caveman Plugin Agents (`caveman:`)

| Agent                   | What it's for                                                        |
| ----------------------- | -------------------------------------------------------------------- |
| `cavecrew-builder`      | Surgical 1-2 file edits — typos, renames, single rewrites            |
| `cavecrew-investigator` | Read-only code locator — returns `file:line` table                   |
| `cavecrew-reviewer`     | Diff reviewer — one line per finding, severity-tagged                |

---

## Skills

### Core / Built-in

| Skill                      | What it's for                                                        |
| -------------------------- | -------------------------------------------------------------------- |
| `run`                      | Launch app to confirm change works in real runtime                   |
| `loop`                     | Run prompt/command on recurring interval (e.g. `loop 5m /foo`)       |
| `init`                     | Initialize / set up a new project                                    |
| `review`                   | Review code changes                                                  |
| `security-review`          | Security-focused code review                                         |
| `simplify`                 | Review changed code for reuse, simplification, efficiency            |
| `update-config`            | Configure Claude Code harness via `settings.json`                    |
| `keybindings-help`         | Customize keyboard shortcuts in keybindings.json                     |
| `fewer-permission-prompts` | Add allowlist to reduce permission prompts                           |
| `claude-api`               | Claude API / Anthropic SDK reference                                 |
| `dataviz`                  | Design-system-agnostic chart/graph/plot/dashboard method             |

---

## Commands

Commands are invoked via `/<command-name>`. They orchestrate multi-step workflows.

### Planning & Architecture

| Command            | What it's for                                                  |
| ------------------ | -------------------------------------------------------------- |
| `/plan`            | Create step-by-step implementation plan, wait for confirm      |
| `/plan-prd`        | Generate lean PRD, hand off to /plan                           |
| `/plan-canvas`     | Open plan in browser for annotate-and-approve review           |
| `/feature-dev`     | Guided feature development with architecture focus             |
| `/update-codemaps` | Generate token-lean architecture codemaps                      |
| `/update-docs`     | Sync docs from source-of-truth files                           |

### Orchestration (orch-* pipeline)

| Command              | What it's for                                                  |
| -------------------- | -------------------------------------------------------------- |
| `/orch-add-feature`  | Build new feature — research, plan, TDD, review, gated commit  |
| `/orch-build-mvp`    | Bootstrap working MVP from design/spec doc                     |
| `/orch-change-feature`| Alter existing feature — update tests, change impl, review    |
| `/orch-fix-defect`   | Fix bug — reproduce as failing test, fix to green, review      |
| `/orch-refine-code`  | Behavior-preserving refactor                                   |
| `/orch-review`       | Run review workflow over diff or GitHub PR                     |

### Multi-Model Workflows

| Command            | What it's for                                                  |
| ------------------ | -------------------------------------------------------------- |
| `/multi-plan`      | Create multi-model implementation plan                         |
| `/multi-execute`   | Execute multi-model plan (Claude writes files)                 |
| `/multi-backend`   | Backend-focused multi-model workflow                           |
| `/multi-frontend`  | Frontend-focused multi-model workflow                          |
| `/multi-workflow`  | Full multi-model — research, plan, execute, optimize, review   |

### GAN Loops

| Command       | What it's for                                                  |
| ------------- | -------------------------------------------------------------- |
| `/gan-build`  | Generator/evaluator build loop for implementation tasks        |
| `/gan-design` | Generator/evaluator design loop for frontend/visual work       |

### Code Review & Testing

| Command          | What it's for                                                  |
| ---------------- | -------------------------------------------------------------- |
| `/code-review`   | Review local changes or GitHub PR                              |
| `/review-pr`     | Comprehensive PR review using specialized agents               |
| `/react-review`  | React/JSX review — hooks, server components, a11y, security   |
| `/react-build`   | Fix React build failures (Vite/webpack/Next/CRA/Parcel)        |
| `/react-test`    | TDD for React — RTL tests first, then implement                |
| `/python-review` | Python review — PEP 8, type hints, security                    |
| `/fastapi-review`| FastAPI review — async, DI, Pydantic, security                 |
| `/vue-review`    | Vue.js review — Composition API, reactivity, performance       |
| `/go-review`     | Go review — idiomatic patterns, concurrency, error handling    |
| `/go-build`      | Fix Go build errors, go vet warnings                           |
| `/go-test`       | TDD for Go — table-driven tests first                          |
| `/rust-review`   | Rust review — ownership, lifetimes, unsafe usage               |
| `/rust-build`    | Fix Rust build errors, borrow checker issues                   |
| `/rust-test`     | TDD for Rust — tests first                                     |
| `/cpp-review`    | C++ review — memory safety, idioms, concurrency                |
| `/cpp-build`     | Fix C++ build errors, CMake, linker problems                   |
| `/cpp-test`      | TDD for C++ — GoogleTest first                                 |
| `/kotlin-review` | Kotlin review — null safety, coroutines, idioms                |
| `/kotlin-build`  | Fix Kotlin/Gradle build errors                                 |
| `/kotlin-test`   | TDD for Kotlin — Kotest first                                  |
| `/flutter-review`| Flutter/Dart review — widgets, state management, performance   |
| `/flutter-build` | Fix Dart analyzer errors and Flutter build failures            |
| `/flutter-test`  | Run Flutter/Dart tests, fix failures incrementally             |
| `/santa-loop`    | Dual-review convergence — two reviewers must both approve      |
| `/test-coverage` | Analyze coverage, generate missing tests                       |
| `/quality-gate`  | Run formatter quality gate, report remediation steps           |

### Build & Refactoring

| Command            | What it's for                                                  |
| ------------------ | -------------------------------------------------------------- |
| `/build-fix`       | Detect build system, fix build/type errors incrementally       |
| `/refactor-clean`  | Identify and remove dead code with verification                |
| `/harness-audit`   | Repository harness audit — prioritized scorecard              |

### Git & PR Workflow

| Command      | What it's for                                                  |
| ------------ | -------------------------------------------------------------- |
| `/pr`        | Create GitHub PR from current branch                           |
| `/prp-pr`    | Create GitHub PR (PRP variant)                                 |
| `/prp-commit`| Commit with natural language file targeting                     |
| `/prp-plan`  | Feature implementation plan with codebase analysis             |
| `/prp-implement`| Execute plan with validation loops                          |
| `/prp-prd`   | Interactive PRD generator — problem-first                      |

### Epic Management

| Command          | What it's for                                                  |
| ---------------- | -------------------------------------------------------------- |
| `/epic-claim`    | Claim epic issue, stamp ownership                              |
| `/epic-decompose`| Break epic into task children                                  |
| `/epic-publish`  | Publish epic update to issue and local cache                   |
| `/epic-review`   | Mark epic review status                                        |
| `/epic-sync`     | Sync epic from GitHub                                          |
| `/epic-unblock`  | Reopen epics whose dependencies are closed                     |
| `/epic-validate` | Validate epic readiness and dependencies                       |

### Security

| Command          | What it's for                                                  |
| ---------------- | -------------------------------------------------------------- |
| `/security-scan` | Run AgentShield against agent/hook/MCP/secret surfaces         |

### Learning & Sessions

| Command            | What it's for                                                  |
| ------------------ | -------------------------------------------------------------- |
| `/learn`           | Extract reusable patterns from session                         |
| `/learn-eval`      | Extract patterns, self-evaluate, determine save location        |
| `/evolve`          | Analyze instincts, suggest evolved structures                   |
| `/instinct-status` | Show learned instincts with confidence                          |
| `/instinct-export` | Export instincts to file                                        |
| `/instinct-import` | Import instincts from file or URL                               |
| `/promote`         | Promote project instincts to global                             |
| `/prune`           | Delete instincts older than 30 days                             |
| `/projects`        | List known projects and instinct stats                          |
| `/save-session`    | Save session state for future resumption                         |
| `/resume-session`  | Load recent session and resume with context                      |
| `/sessions`        | Manage session history and metadata                              |

### Hooks & Config

| Command             | What it's for                                                  |
| ------------------- | -------------------------------------------------------------- |
| `/hookify`          | Create hooks to prevent unwanted behaviors                      |
| `/hookify-configure`| Enable/disable hookify rules interactively                       |
| `/hookify-list`     | List all configured hookify rules                                |
| `/hookify-help`     | Get help with the hookify system                                 |

### DevOps & Infrastructure

| Command      | What it's for                                                  |
| ------------ | -------------------------------------------------------------- |
| `/pm2`       | Generate PM2 service commands for detected services            |
| `/setup-pm`  | Configure preferred package manager (npm/pnpm/yarn/bun)        |

### Project Setup

| Command         | What it's for                                                  |
| --------------- | -------------------------------------------------------------- |
| `/project-init` | Detect stack, produce ECC onboarding plan                      |
| `/auto-update`  | Pull latest ECC changes, reinstall managed targets             |
| `/ecc-guide`    | Navigate ECC agents, skills, commands, hooks, docs             |

### Cost & Quality

| Command        | What it's for                                                  |
| -------------- | -------------------------------------------------------------- |
| `/cost-report` | Generate cost report from ECC cost-tracker                     |
| `/skill-create`| Extract coding patterns from git history into SKILL.md         |
| `/skill-health`| Skill portfolio health dashboard                               |
| `/model-route` | Recommend best model tier for current task                     |

### Side Tasks

| Command  | What it's for                                                  |
| -------- | -------------------------------------------------------------- |
| `/aside`  | Quick side question without losing current context             |
| `/jira`   | Retrieve/update Jira tickets, analyze requirements             |

### Marketing

| Command               | What it's for                                                  |
| --------------------- | -------------------------------------------------------------- |
| `/marketing-campaign` | Full campaign — positioning, landing page, emails, social, ads |

---

## Project-Scoped Skills

These live in `.claude/skills/` within this project.

### UI / Design

| Skill                          | What it's for                                                  |
| ------------------------------ | -------------------------------------------------------------- |
| `ui-ux-pro-max`               | Design database — 84 styles, 192 palettes, 74 fonts, 22 stacks |
| `impeccable`                  | Design/audit/polish any frontend interface                     |
| `apple-design`                | Apple-style design — springs, sheets, translucent materials    |
| `emil-design-eng`             | Emil Kowalski's UI polish philosophy                           |
| `animation-vocabulary`        | Reverse-lookup glossary for naming motion effects              |
| `find-animation-opportunities`| Find places that should animate but don't                     |
| `improve-animations`          | Senior motion advisor — audit + implementation plans           |
| `review-animations`           | Review animation code against high craft bar                   |
| `pick-ui-library`             | Pick right library for frontend task from curated list         |
| `prototype`                   | Build multiple UI versions behind visual picker                |
| `brandkit`                    | Premium brand-kit image generation                             |
| `industrial-brutalist-ui`     | Swiss print + military terminal aesthetics                     |
| `gpt-taste`                   | Elite UX/UI + GSAP motion, AIDA structure                      |
| `image-to-code`               | Generate design images, analyze, implement to match            |
| `imagegen-frontend-mobile`    | Premium mobile screen concepts — images only                   |
| `imagegen-frontend-web`       | Premium website design references per section                  |
| `minimalist-ui`               | Clean editorial — monochrome, typographic contrast             |
| `full-output-enforcement`     | Override LLM truncation, enforce complete output               |
| `redesign-existing-projects`  | Upgrade existing app to premium quality                        |
| `high-end-visual-design`      | High-end agency design — fonts, spacing, shadows               |
| `stitch-design-taste`         | Stitch DESIGN.md — premium anti-generic UI                     |
| `design-taste-frontend`       | Anti-slop frontend for landing pages and redesigns             |
| `design-taste-frontend-v1`    | Original v1 taste-skill (backward compat)                      |
| `design-md`                   | Synthesize Stitch project into DESIGN.md                       |
| `enhance-prompt`              | Transform vague UI ideas into Stitch-optimized prompts         |
| `react-vite-dashboard`        | Stitch to React + Vite dashboard with TanStack Query           |
| `remotion`                    | Walkthrough videos from Stitch via Remotion                    |
| `shadcn-ui`                   | shadcn/ui integration and customization guidance              |
| `stitch-code-to-design`       | Convert frontend code to Stitch Design                         |
| `stitch-extract-design-md`    | Extract DESIGN.md from frontend source code                    |
| `stitch-extract-static-html`  | Extract self-contained static HTML from built app              |
| `stitch-generate-design`      | Generate/edit screens via Stitch MCP                           |
| `stitch-loop`                 | Iterative Stitch build with autonomous loop pattern            |
| `stitch-manage-design-system` | Manage Stitch design systems via MCP tools                     |
| `stitch-react-components`     | Stitch designs to React components                             |
| `stitch-react-native`         | Stitch HTML to React Native components                         |
| `stitch-upload-to-stitch`     | Upload assets to Stitch project                                |
| `taste-design`                | Stitch DESIGN.md — premium anti-generic UI                     |
| `web-design-guidelines`       | Review UI against Web Interface Guidelines                     |

### Vercel

| Skill                           | What it's for                                                  |
| ------------------------------- | -------------------------------------------------------------- |
| `deploy-to-vercel`              | Deploy app/site to Vercel                                      |
| `vercel-cli-with-tokens`        | Vercel CLI with token-based auth                               |
| `vercel-composition-patterns`   | React/Next.js composition patterns                             |
| `vercel-optimize`               | Vercel cost + performance optimization                         |
| `vercel-react-best-practices`   | React/Next.js performance from Vercel Engineering              |
| `vercel-react-native-skills`    | React Native / Expo for Vercel                                 |
| `vercel-react-view-transitions` | Page transitions via View Transition API                       |

### Supabase

| Skill                              | What it's for                                                  |
| ---------------------------------- | -------------------------------------------------------------- |
| `supabase`                         | Any Supabase task — DB, Auth, Edge Functions, Realtime, CLI    |
| `supabase-postgres-best-practices` | Postgres best practices — schema, RLS, migrations, indexing    |

### Security

| Skill           | What it's for                                                  |
| --------------- | -------------------------------------------------------------- |
| `vibesec-skill` | Secure web application development                            |

### Strix Security

| Skill                                   | What it's for                                                  |
| --------------------------------------- | -------------------------------------------------------------- |
| `strix:penetration-testing-with-strix`  | Pentest web app/API — validates OWASP Top 10+                 |
| `strix:managed-pentesting-with-strix`   | Managed pentest-as-a-service via app.strix.ai                  |
| `strix:ci-security-scanning-with-strix` | Security scanning in CI/CD pipelines                           |
| `strix:fix-security-vulnerabilities-with-strix` | Fix vulns found by Strix — triage, patch               |

### Writing / Docs

| Skill                | What it's for                                                  |
| -------------------- | -------------------------------------------------------------- |
| `writing-guidelines` | Review docs/prose for voice, tone, style compliance            |

### Anthropic Skills (`anthropic-skills:`)

| Skill                           | What it's for                                                  |
| ------------------------------- | -------------------------------------------------------------- |
| `anthropic-skills:algorithmic-art` | Algorithmic art with p5.js                                   |
| `anthropic-skills:brand-guidelines` | Anthropic brand colors/typography                           |
| `anthropic-skills:canvas-design` | Visual art in .png and .pdf                                  |
| `anthropic-skills:claude-api`    | Claude API / Anthropic SDK reference                          |
| `anthropic-skills:doc-coauthoring` | Structured documentation co-authoring workflow              |
| `anthropic-skills:docx`          | Create/edit Word documents (.docx/.dotx)                      |
| `anthropic-skills:frontend-design` | Distinctive visual design guidance                          |
| `anthropic-skills:internal-comms` | Internal comms — status reports, newsletters, FAQs          |
| `anthropic-skills:mcp-builder`   | Build MCP servers for LLM external service interaction         |
| `anthropic-skills:pdf`           | Read/create/merge/split/OCR PDF files                          |
| `anthropic-skills:pptx`          | Create/edit PowerPoint presentations (.pptx/.potx)            |
| `anthropic-skills:skill-creator` | Create/improve skills, measure performance, run evals          |
| `anthropic-skills:slack-gif-creator` | Animated GIFs optimized for Slack                          |
| `anthropic-skills:theme-factory` | Style artifacts with 10 pre-set themes                        |
| `anthropic-skills:web-artifacts-builder` | Multi-component claude.ai HTML artifacts             |
| `anthropic-skills:webapp-testing` | Test local web apps via Playwright                          |
| `anthropic-skills:xlsx`         | Create/edit spreadsheets (.xlsx, .csv, .tsv)                  |

### Caveman Plugin Skills (`caveman:`)

| Skill                     | What it's for                                       |
| ------------------------- | --------------------------------------------------- |
| `caveman:caveman`         | Terse caveman-style communication mode              |
| `caveman:caveman-commit`  | Terse commit message generation                     |
| `caveman:caveman-review`  | Caveman-style code review                           |
| `caveman:caveman-stats`   | Token usage and savings for the session             |
| `caveman:caveman-help`    | Quick-reference card for caveman commands           |
| `caveman:caveman-compress`| Compress memory files to save tokens                |
| `caveman:cavecrew`        | Route to caveman cavecrew agents                    |

### Other Skills

| Skill         | What it's for                                                  |
| ------------- | -------------------------------------------------------------- |
| `find-skills` | Discover and install agent skills                              |
| `i-have-adhd` | ADHD-friendly output — lead with action, suppress tangents     |

---

## GStack Skills (`gstack:`)

| Skill                              | What it's for                                        |
| ---------------------------------- | ---------------------------------------------------- |
| `gstack:gstack`                    | Router for gstack skill suite                        |
| `gstack:autoplan`                  | Auto-review pipeline with auto-decisions             |
| `gstack:benchmark`                 | Performance regression detection                     |
| `gstack:benchmark-models`          | Cross-model benchmark for gstack skills              |
| `gstack:browse`                    | Headless browser for QA testing                      |
| `gstack:deploy-to-vercel`          | Deploy to Vercel                                     |
| `gstack:find-skills`               | Discover and install agent skills                    |
| `gstack:supabase`                  | Supabase integration                                 |
| `gstack:vercel-composition-patterns`| Vercel composition patterns                          |
| `gstack:vercel-react-best-practices`| React/Next.js performance guidelines                |
| `gstack:web-quality-audit`         | Performance, accessibility, SEO audit                |

---

## Source Locations

| Location                          | Contents                                               |
| --------------------------------- | ------------------------------------------------------ |
| `~/.claude/skills/ECC/`          | ECC agents (~68), skills (~280+), commands (~94)       |
| `~/.claude/skills/anthropic-skills/` | Anthropic official skills (17)                     |
| `~/.claude/skills/caveman/`      | Caveman plugin — communication, agents, skills         |
| `~/.claude/skills/i-have-adhd/`  | ADHD output formatting                                |
| `~/.claude/skills/strix/`        | Strix security scanning                               |
| `~/.agents/skills/gstack/`       | GStack suite — browse, deploy, benchmark, QA           |
| `~/.agents/skills/supabase/`     | Supabase integration                                  |
| `.claude/skills/` (project)      | 46 project-scoped design/UI/Vercel skills              |
| Built-in                          | `run`, `claude-api`, `dataviz`, `loop`, `init`, etc.  |
| `superpowers:` plugin            | Brainstorming, TDD, debugging, planning, review        |

---

*Last updated: 2026-08-16*
