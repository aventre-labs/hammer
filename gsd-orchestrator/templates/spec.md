# [Product Name] — Hammer Spec Template

> Hammer/IAM awareness: this spec is the provenance root for the build. Include verification expectations and no-degradation blockers before running `hammer headless`.

## Outcome
[One paragraph explaining what a user can accomplish when the build is done. Be concrete: "A CLI tool that converts CSV files to JSON" instead of "A data transformation solution".]

## User Requirements
- [User can do one specific and observable thing.]
- [User can do another specific thing.]
- [System performs an automatic behavior.]
- [System handles a named error case gracefully.]

## Technical Constraints
- Language/runtime: [Node.js, Python, Go, Rust, etc.]
- Framework: [Express, FastAPI, none, etc.]
- External dependencies: [APIs, databases, services, filesystem constraints]
- Environment: [Node >= 22, Python 3.12+, supported OS, deployment target]
- Security/privacy/performance: [requirements that cannot be degraded]

## Verification Expectations
- [Command, test suite, browser flow, API request, or observable behavior that proves success.]
- [Negative test for malformed input, dependency failure, or boundary condition.]
- [Operational check such as health endpoint, logs, or generated summary evidence.]

## Awareness and Provenance
- [What IAM/Omega/Trinity/VOLVOX context, source evidence, or decision provenance must be preserved.]
- [What missing evidence should block the run instead of falling back silently.]
- [What summaries should record so the next agent can audit the result.]

## Out of Scope
- [Explicit exclusion 1 to prevent scope creep.]
- [Explicit exclusion 2.]
