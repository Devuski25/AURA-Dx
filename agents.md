# COUGHPH Agents

## 1. Triage (`@triage`)
**Orchestrator** — Runs the full problem-discovery-to-fix pipeline.

Coordinates **Problemator → The-Thinker → Agent-Creator (if needed) → Fix → Verify**. Users can run a full scan, jump straight to fixing a known problem, or focus discovery on a specific area.

| Usage | Description |
|-------|-------------|
| `@triage find problems` | Full pipeline: scan → analyze → create agents → fix → verify |
| `@triage fix [description]` | Start from analysis with a known problem |
| `@triage check [area]` | Focus discovery on frontend/backend/database/infra |

---

## 2. Problemator (`@problemator`)
**Problem Finder** — Systematically scans the codebase to find bugs, security issues, performance problems, UX flaws, code quality issues, and architectural gaps.

Investigates all layers (frontend, backend, database, inference, config) using structured techniques. Outputs problems in a formatted JSON report with severity, category, location, and suggested fix.

---

## 3. The-Thinker (`@the-thinker`)
**Agent Matcher** — Analyzes a problem and determines the best agent to fix it.

Checks `.opencode/agents/` for an existing agent whose expertise matches the problem domain. If none fits, outputs detailed requirements for a new agent (name suggestion, description, permissions, expertise areas, behaviors). Never fixes problems directly — only decides.

---

## 4. Agent-Creator (`@agent-creator`)
**Agent Builder** — Creates new agent definition files from requirements.

Writes a new `.opencode/agents/{name}.md` file with proper frontmatter (description, mode, permissions) and detailed instructions. Follows permission guidelines (minimal by default) and includes a quality checklist. Assigns the specific fix task to the newly created agent.

---

## 5. Database Master (`@database-master`)
**Database Specialist** — Handles SQL, schema design, migrations, and database troubleshooting.

Expertise includes query optimization, RLS policies, indexing strategies, Supabase-specific knowledge (Auth, Postgres, Realtime), data modeling, and migration management. Asks before running destructive operations and provides alternative approaches.

---

## 6. Debug Assistant (`@debug-assistant`)
**Debug Specialist** — Systematically diagnoses and resolves errors, crashes, and unexpected behavior.

Follows a 5-step approach: Reproduce → Isolate → Root Cause → Fix → Verify. Checks type mismatches, null/undefined values, missing imports, async/await issues, env config, API mismatches, DB connection issues, CORS/auth token problems, React stale closures, and Python import cycles.

---

## 7. Code Reviewer (`@code-reviewer`)
**Code Quality Reviewer** — Reviews code for correctness, security, performance, maintainability, best practices, type safety, and error handling across all stack layers.

Categorizes issues by severity (critical, major, minor, suggestion), references specific file paths and line numbers, and suggests concrete fixes. Does not make changes — reports findings only.

---

## 8. Browser Agent (`@agent-browser`)
**Browser Automation** — Fast browser automation CLI for AI agents. Chrome/Chromium via CDP with accessibility-tree snapshots and compact `@eN` element refs.

Capabilities:
- **Web interaction**: navigate pages, fill forms, click buttons, take screenshots
- **Data extraction**: scrape pages, extract structured data
- **QA & testing**: exploratory testing, dogfooding, bug hunts, app quality reviews
- **Electron apps**: automate VS Code, Slack, Discord, Figma, Notion, Spotify
- **Slack**: check unreads, send messages, search conversations
- **Cloud browsers**: Vercel Sandbox microVMs, AWS Bedrock AgentCore
- **Observability**: built-in dashboard on port 4848 with session status and stream traffic

Usage: `agent-browser <command>` with specialized skills via `agent-browser skills get <topic>` (core, electron, slack, dogfood, derive-client, vercel-sandbox, agentcore).
