"""Scoped agent identity.

The agent has its OWN identity (not the student's, not the counsellor's).
`confidence_floor` is the scope ceiling enforced by `can_present_shortlist()`
— the shortlist tool uses it to return a structured refusal rather than hand
a student a set of matches the agent isn't confident enough to stand behind.

In production this identity would be issued by your IDP as a scoped service
principal; here it's loaded from agent-profile.yaml.
"""

from dataclasses import dataclass


@dataclass
class AgentIdentity:
    agent_id: str
    name: str
    tenant_name: str
    role: str = "student"  # student | counsellor
    confidence_floor: float = 0.6

    def can_present_shortlist(self, confidence: float) -> tuple[bool, str | None]:
        """Returns (allowed, reason_if_not). The reason becomes the `detail`
        field of the structured refusal the model reads, so it has to say
        what to do next rather than just report a number.

        `confidence_floor` arrives already clamped: `profile.load_profile`
        raises any configured value up to `models.CONFIDENCE_FLOOR`, so this
        can never be more permissive than the backend that also checks it.
        """
        if not 0.0 <= confidence <= 1.0:
            return False, (
                f"confidence must be between 0 and 1, got {confidence}"
            )
        if confidence < self.confidence_floor:
            return False, (
                f"shortlist confidence of {confidence:.2f} is below the agent's "
                f"floor of {self.confidence_floor:.2f}"
            )
        return True, None
