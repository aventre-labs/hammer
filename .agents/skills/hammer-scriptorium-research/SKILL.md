---
name: hammer-scriptorium-research
description: Ensures agents building hammer use scriptorium MCP as a research/context-gathering reference during hammer research phases only, while keeping hammer runtime independent and implementing comparable IAM/Omega/Trinity/VOLVOX features natively. Use when researching, planning, or implementing hammer IAM/Omega/Trinity/VOLVOX architecture.
---

<objective>
When building hammer, use scriptorium MCP as an external reference instrument during research/context-gathering phases. Do not add this skill, scriptorium MCP config, scriptorium packages, or scriptorium runtime dependencies to hammer. Hammer should implement many comparable awareness features natively instead of delegating to scriptorium at runtime.
</objective>

<when_to_use>
Use this skill whenever the work is part of hammer and involves research, planning, architecture discovery, IAM/Omega/Trinity/VOLVOX behavior, public awareness tools, prompt/workflow semantics, context policy, or subagent policy.
</when_to_use>

<core_rules>
- During hammer research phases, first check available MCP servers and use the scriptorium MCP if it is configured and relevant.
- Treat scriptorium as the authoritative implementation-detail reference for IAM/Omega/Trinity/VOLVOX behavior, but as a context/reference source rather than production architecture for hammer.
- Any hammer IAM/Omega/Trinity/VOLVOX implementation detail that deviates from scriptorium reference behavior must be explicitly reconciled before verification can pass.
- Scriptorium MCP is user-approved for hammer research/planning and should be used without manual re-approval when available.
- Never add scriptorium MCP as a hammer runtime dependency.
- Never make hammer require this skill to operate.
- Prefer native hammer implementations for IAM-style features: Omega Protocol, Runes, SAVESUCCESS, Trinity metadata, VOLVOX lifecycle, public awareness tools, context routing, and structured diagnostics.
- If scriptorium is unavailable, continue with local codebase/context research and explicitly note that scriptorium context could not be consulted.
</core_rules>

<process>
1. Call `mcp_servers` to check whether a scriptorium MCP server is available.
2. If present, call `mcp_discover` for the scriptorium server before using any of its tools.
3. Use only the scriptorium tools needed to understand the relevant IAM/Omega/Trinity/VOLVOX concept or compare hammer's intended behavior with known reference behavior.
4. Translate findings into hammer-native design constraints, files, seams, tests, and no-degradation diagnostics.
5. In the research output, separate "Scriptorium reference findings" from "Hammer implementation recommendation" so planners do not accidentally depend on scriptorium.
6. Verify no implementation plan requires shipping scriptorium MCP, this skill, or external scriptorium packages inside hammer.
</process>

<success_criteria>
- Research artifacts mention whether scriptorium MCP was consulted or unavailable.
- Any scriptorium-derived insight is converted into a hammer-native implementation recommendation.
- Verification plans include a scriptorium-parity gate for IAM/Omega/Trinity/VOLVOX implementation details; unresolved deviations are blockers, not warnings.
- No hammer source, package metadata, runtime command, prompt, workflow, template, or generated artifact requires scriptorium MCP or this skill.
- Hammer remains runtime-independent while gaining comparable native awareness capabilities where required by the milestone.
</success_criteria>
