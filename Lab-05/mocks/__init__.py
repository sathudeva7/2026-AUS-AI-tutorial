"""Mock backend for the Northbound overseas-education agent.

NorthboundClient takes an `agent_id` (who is acting — stamped on every
ToolCall row) and a `workspace` (which data dir to work in, under
`mocks/data/<workspace>/`). The student and counsellor agents share one
workspace so the counsellor can see what the student-facing agent did, while
each signs its own name in the audit trail. Omit `workspace` and it defaults
to `agent_id`, giving one isolated world per agent.

The canonical seeds at `mocks/seeds/*.json` are shared and read-only — every
workspace starts from the same catalogue and lead book. Conversations, audit
rows, follow-ups, escalations and bookings are NOT seeded; they start empty
and are created by the agent as it works.

Reset by calling `client.reset()` (or `reset_data_files(workspace)`); only
that workspace is touched.
"""

from mocks.client import (
    FactNotStated,
    NoCounsellorAvailable,
    NorthboundClient,
    NorthboundError,
    ShortlistUnavailable,
    reset_data_files,
)
from mocks.models import (
    CONFIDENCE_FLOOR,
    Counsellor,
    EligibilityResult,
    Escalation,
    Fact,
    Followup,
    Lead,
    LeadFacts,
    Message,
    Programme,
    Requirement,
    RequirementCheck,
    Shortlist,
    ShortlistEntry,
    Slot,
    ToolCall,
)

__all__ = [
    "CONFIDENCE_FLOOR",
    "Counsellor",
    "EligibilityResult",
    "Escalation",
    "Fact",
    "FactNotStated",
    "Followup",
    "Lead",
    "LeadFacts",
    "Message",
    "NoCounsellorAvailable",
    "NorthboundClient",
    "NorthboundError",
    "Programme",
    "Requirement",
    "RequirementCheck",
    "Shortlist",
    "ShortlistEntry",
    "ShortlistUnavailable",
    "Slot",
    "ToolCall",
    "reset_data_files",
]
