"""Token accounting — what each turn cost, in tokens and in money.

Two jobs, kept apart because they fail differently:

- Counting tokens is EXACT. The provider reports usage on every response and
  Strands accumulates it; there is no estimation anywhere in this module.
- Pricing is a LOOKUP against a table in this file, and a table of prices goes
  stale the moment a provider changes one. So an unknown model returns `None`
  rather than a plausible number, and the UI shows tokens with no cost beside
  them. A missing price is obvious; a wrong one gets quoted in a meeting.

PRICES BELOW ARE NOT AUTHORITATIVE. Check them against the provider's own
pricing page before anyone reads a number off this dashboard and believes it.
They are per MILLION tokens, in USD, which is how providers publish them.
"""

from __future__ import annotations

from dataclasses import dataclass

# USD per 1,000,000 tokens: (input, output).
#
# Cached input is billed at a discount by most providers; `CACHE_READ_DISCOUNT`
# below applies a flat one rather than carrying a third column, because the
# exact multiplier varies and a rough discount on a small number beats an
# invented precision.
PRICES: dict[str, tuple[float, float]] = {
    "gpt-5.4": (1.25, 10.00),
    "gpt-5.4-mini": (0.25, 2.00),
    "gpt-5": (1.25, 10.00),
    "gpt-5-mini": (0.25, 2.00),
}

# Applied to `cacheReadInputTokens`, which are also counted in `inputTokens`.
# The correction is therefore negative: cached tokens were billed at full rate
# in the input figure, and this refunds the difference.
CACHE_READ_DISCOUNT = 0.10  # cached reads cost ~10% of a fresh input token


@dataclass(frozen=True)
class Usage:
    """One turn's token usage, split by where it was spent.

    `planner_*` is separate on purpose. The planner is a second LLM call the
    lab can toggle off, and "the planner costs 15% of every turn" is one of
    the more useful things this whole feature can show. Rolling it into the
    total would hide exactly the number worth seeing.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    planner_input_tokens: int = 0
    planner_output_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return (
            self.input_tokens
            + self.output_tokens
            + self.planner_input_tokens
            + self.planner_output_tokens
        )

    def cost_usd(self, model: str) -> float | None:
        """Cost of this turn, or None when the model is not in PRICES."""
        price = PRICES.get(model)
        if price is None:
            return None
        rate_in, rate_out = price
        billable_in = self.input_tokens + self.planner_input_tokens
        billable_out = self.output_tokens + self.planner_output_tokens
        cost = (billable_in * rate_in + billable_out * rate_out) / 1_000_000
        # Refund the difference on tokens that were served from cache.
        cost -= (self.cached_tokens * rate_in * (1 - CACHE_READ_DISCOUNT)) / 1_000_000
        return max(cost, 0.0)

    def planner_cost_usd(self, model: str) -> float | None:
        price = PRICES.get(model)
        if price is None:
            return None
        rate_in, rate_out = price
        return (
            self.planner_input_tokens * rate_in
            + self.planner_output_tokens * rate_out
        ) / 1_000_000

    def as_dict(self, model: str) -> dict:
        """The wire shape the UI reads. `cost_usd` is null for an unpriced
        model — the UI renders tokens and omits the money rather than
        inventing a figure."""
        return {
            "model": model,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cached_tokens": self.cached_tokens,
            "planner_input_tokens": self.planner_input_tokens,
            "planner_output_tokens": self.planner_output_tokens,
            "total_tokens": self.total_tokens,
            "cost_usd": self.cost_usd(model),
            "planner_cost_usd": self.planner_cost_usd(model),
            "priced": model in PRICES,
        }


def snapshot(agent) -> tuple[int, int, int]:
    """Read an agent's lifetime token counters.

    `accumulated_usage` accumulates for the LIFE of the Agent object, and
    main.py caches one Agent per lead across requests. So a single reading is
    a running total, not a turn — take one before the turn and one after, and
    subtract. Getting this wrong shows turn 5 costing five turns' worth, which
    looks like a runaway loop and is not.
    """
    metrics = getattr(agent, "event_loop_metrics", None)
    usage = getattr(metrics, "accumulated_usage", None) or {}
    return (
        int(usage.get("inputTokens", 0) or 0),
        int(usage.get("outputTokens", 0) or 0),
        int(usage.get("cacheReadInputTokens", 0) or 0),
    )


def delta(before: tuple[int, int, int], after: tuple[int, int, int]) -> Usage:
    """This turn's usage: after minus before, floored at zero.

    The floor matters because `agent.messages` can be trimmed by the sliding
    window between readings, and a provider that reports nothing leaves the
    counters flat. A negative token count is never real.
    """
    return Usage(
        input_tokens=max(0, after[0] - before[0]),
        output_tokens=max(0, after[1] - before[1]),
        cached_tokens=max(0, after[2] - before[2]),
    )
