"""The Northbound backend, exposed over MCP.

One server, two tool sets. Which one it registers is decided at startup by
the NORTHBOUND_ROLE env var, injected from `agent.role` in the profile.

To run standalone (for debugging):
    NORTHBOUND_ROLE=student python -m mcp_servers.northbound
"""
