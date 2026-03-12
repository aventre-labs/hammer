# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? |
|---|------|-------|----------|--------|-----------|------------|
| D001 | M001 | arch | Smart staging approach | Exclusion filter (not file ownership tracking) | Covers 95% of the problem with minimal complexity. Fallback to git add -A on failure. | Yes — if exclusion filter proves insufficient |
| D002 | M001 | arch | worktree.ts migration strategy | Thin facade (keep exports, delegate to GitService) | Backward compatibility — 6+ existing callers don't need changes | Yes — if full migration desired later |
| D003 | M001 | arch | Merged branch lifecycle | Delete after squash merge (not preserve) | Squash commit is the permanent record. Branch sprawl has near-zero debugging value. | No |
| D004 | M001 | arch | Snapshot refs vs checkpoint commits | Hidden snapshot refs (refs/gsd/snapshots/) | Invisible recovery without cluttering branch history | No |
| D005 | M001 | scope | PR creation workflow | Deferred | Separate concern touching GitHub API, gh CLI, merge queue. Out of scope for trust boundary fix. | Yes — future milestone |
| D006 | M001 | scope | Milestone tags | Deferred | Low value relative to core trust boundary fix | Yes — future milestone |
| D007 | M001 | arch | Git Notes for metadata | Rejected | Fragile, poorly supported by tools, unreliable push/pull semantics | No |
| D008 | M001 | arch | Pre-merge verification timing | Phase 3 (enhanced features) | Core service + bug fixes first. Current workflow hasn't been catastrophic without guards. | No |
| D009 | M001 | arch | Doc fixes timing | Phase 1 (with bug fixes) | Pure text changes, zero risk, related to same git mechanics | No |
| D010 | M001 | arch | Test strategy | Unit tests with temp repos | Same proven pattern as existing worktree.test.ts | No |
| D011 | M001/S01 | arch | GitService reuses worktree.ts pure utilities | Import detectWorktreeName, getSliceBranchName, SLICE_BRANCH_RE from worktree.ts | These are pure functions with no side effects. Reimplementing would create drift. S02 facade wiring won't break these exports. | No |
| D012 | M001/S01 | arch | RUNTIME_EXCLUSION_PATHS defined independently | Define exclusion paths in git-service.ts independently of gitignore.ts BASELINE_PATTERNS | Keeps S01 self-contained without touching gitignore.ts. BASELINE_PATTERNS is unexported. Converge later if needed. | Yes — converge in future cleanup |
| D013 | M001/S01 | impl | COMMIT_TYPE_RULES includes plural keyword forms | Added "docs" and "tests" as explicit keywords alongside singular "doc" and "test" | Word-boundary regex `\bdoc\b` doesn't match "docs" — the trailing `s` is a word character. Plurals are common in slice titles. | No |
