# AGENTS & CODING RULES (SYSTEM DIRECTIVES)

You are an expert AI software engineer. You must strictly follow these rules and engineering principles across all interactions.

---

## 1. Tool Usage & File Editing (CRITICAL — ZERO TOLERANCE)

- **Mandatory Native Editor Usage:** Always use the built-in IDE tools (`replace_file_content`, `multi_replace_file_content`, `write_to_file`) for all source code modifications.
- **Strict Prohibition on Patch Scripts:** NEVER create, generate, or execute temporary patch scripts (e.g., `patch.py`, `patch_*.py`, `temp_edit.py`, bash/PowerShell replacement scripts) to modify code or perform regex replacements.
- **Strict Prohibition on Terminal File Edits:** NEVER run shell commands (`cat`, `sed`, `Set-Content`, `echo >`, `python -c "..."`) to modify, overwrite, or patch codebase files.
- **Preserve Code Integrity:** Always read surrounding context before making edits. Never accidentally remove comments, adjacent functions, type signatures, or cause unintended regressions.

---

## 2. Agent Skills & Workflow Discipline (Addy Osmani's Methodology)

Adhere strictly to the core workflows defined in the `agent-skills` suite:

### A. Spec & Plan First (`spec-driven-development`, `planning-and-task-breakdown`)
- For any complex feature, architectural change, or multi-file refactor, produce a clear specification and step-by-step plan before writing code.
- Wait for user feedback/approval on `implementation_plan.md` when making structural or ambiguous modifications.

### B. Test-Driven & Systematic Verification (`test-driven-development`, `debugging-and-error-recovery`)
- **No Assumptions / Zero False Reporting:** NEVER claim a test passed or say "100% passing" without actually running the automated test suite.
- **Full Suite Execution:** Always execute both backend tests (e.g., `python -m unittest discover -s tests -t tests`) and frontend tests (e.g., `npm test` in `webui`) before concluding changes.
- **Root-Cause Fixing:** When tests fail, diagnose and fix the actual root cause in the implementation. Never alter or disable tests just to bypass failures.

### C. Incremental Implementation (`incremental-implementation`)
- Deliver changes in small, verified, coherent units.
- Avoid massive, monolithic changes across multiple subsystems at once. Validate each layer before moving to the next.

### D. Quality & Self-Review (`code-review-and-quality`, `doubt-driven-development`)
- Conduct an adversarial self-review of your changes before finalizing.
- Check for edge cases, missing error handling, leftover debug code, memory leaks, and deprecation warnings.
- Keep the workspace clean: remove temporary artifacts, scratch files, and verify no untracked junk files are left behind.

---

## 3. The 3 Non-Negotiable Quality Gates & Definition of Done (CRITICAL MANDATE)

Every agent (Gemini, Claude, Codex, etc.) across any interaction is **strictly forbidden** from declaring a task "finished", claiming code is "ready to commit", or attempting any git commit/push without passing all 3 quality gates:

### Gate 1: Static Analysis & Clean Hygiene
- **Frontend Linter (`npm run lint --prefix webui`)**: Must pass with 0 errors and 0 warnings. Absolutely zero undeclared variables (`no-undef`), zero scoping errors, zero duplicate keys (`no-dupe-keys`).
- **Python Syntax (`python -m py_compile`)**: All modified Python files must compile cleanly with zero syntax errors.

### Gate 2: Real DOM & Automated Behavioral Testing
- **100% Passing Test Suites**: Both backend (`python -m unittest discover -s tests -t tests`) and frontend (`npm test --prefix webui`) must pass 100%.
- **Real DOM Interaction Rule (ZERO TOLERANCE FOR SYNTHETIC ACTION BYPASSES)**:
  - Any user-clickable element (buttons, tabs, timeline pins, list cards, menus) **MUST** be tested via real DOM events (`node.click()`, `fireEvent`, `dispatchEvent`).
  - **Strictly Prohibited**: Directly invoking action handlers with fake mock objects (e.g. `action({ dataset: ... })`). Synthetic bypasses mask dead DOM event listeners, `innerHTML` replacement regressions, and lexical scoping crashes.

### Gate 3: Production Build & Real Runtime Sanity
- **Production Asset Compilation**: Any frontend change must successfully compile into the production bundle (`npm run build --prefix webui`).
- **Runtime Sanity & Smoke Check**: Verify real execution (via preview server `tools/run_web_preview.py` or dev server). Console must be clean with zero fatal exceptions or unhandled promise rejections.

### 🎯 Definition of Done (DoD)
A task is ONLY complete when all three gates have been executed sequentially and verified with evidence:
`Gate 1 (Lint Clean)` ➔ `Gate 2 (Real DOM Tests Pass)` ➔ `Gate 3 (Production Bundle Builds & Runtime Verified)`.

---

## 4. Communication & Execution Style

- Be direct, factual, and concise.
- Provide clear diffs and test logs when reporting completed work.
- **Strict Prohibition on Unsolicited Git Commit/Push (ZERO TOLERANCE):** NEVER run `git commit`, `git push`, `git commit -am`, or any command that creates commits or pushes code to remote repositories unless the user explicitly instructs to commit or push in their current request. All AI models (Gemini / Claude / etc.) must strictly wait for explicit user approval/instruction before executing any git commit or push commands.
