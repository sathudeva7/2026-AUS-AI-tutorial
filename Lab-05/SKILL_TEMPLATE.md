---
name: [skill-name]
description: [One sentence. Use when ... — the activation criteria and what this skill orchestrates. The agent uses this description to match the skill to a situation, so be specific about WHEN it applies.]
---

<!-- Save this as `skills/<skill-name>/SKILL.md`. The `name` in frontmatter must
     match the directory name and use lowercase + hyphens only (Strands convention,
     enforced by AgentSkills). -->

# [skill-name]

[One-line description of what high-level flow this skill orchestrates.]

## High-level flow

1. [Step — name the tool to call and what to check in the result]
2. [Step]
3. [Step]
4. [Step]
5. [Confirm in reply with specifics]

## Decision branches

- **[Condition]** → [Action]
- **[Condition]** → [Action]

## Anti-patterns

- ❌ [Mistake to avoid, with reason if non-obvious]
- ❌ [Mistake to avoid]

## Communication

[Tone, what must be in the reply, what NOT to say.]

## When this skill doesn't fit

[Escape valve. When to escalate instead of forcing this skill.]

## Related policies (consulted by this skill)

- `[policy_name]` — [what rule this skill consults from it]

---

<!--
HANDS-ON GUIDE — delete this comment block after writing your skill.

For the §2 hands-on, the minimum viable skill is:

1. **Frontmatter** — fill in `name` and `description`. The description is HOW the agent decides
   to load your skill into context. Be specific about the trigger ("Use when the customer asks
   to change a shipping address...").

2. **High-level flow** — 4-6 steps. Name the tools to call. Be clear about what to check.

3. **Decision branches** — at least 2 paths based on order state or customer intent.

4. **Anti-patterns** — at least 2. Why this matters: it tells the agent what NOT to do, which
   is harder for an LLM to infer from positive instructions alone.

You can leave "Communication", "When this skill doesn't fit", and "Related policies" as
placeholders for now — production skills fill them all in, but the agent will use your starter
skill the moment you save it.

The KEY THING: skills are HIGH-LEVEL orchestration. Don't put policy content into the skill —
look policies up via `search_policy_kb`. The skill says "check the policy and follow it"; the
policy says "the rule is X."
-->
