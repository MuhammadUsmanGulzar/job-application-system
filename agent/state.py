from typing import Optional, List
from typing_extensions import TypedDict

class ApplicationAgentState(TypedDict, total=False):
    """
    Represents the full state passed between nodes in the LangGraph agent.
    """
    application_id: str
    user_id: str
    job_title: Optional[str]
    company_name: Optional[str]
    recipient_email: Optional[str]
    email_subject: Optional[str]
    email_body: Optional[str]
    application_email_id: Optional[str]

    # Credentials retrieved from user_settings
    sender_email: Optional[str]
    refresh_token: Optional[str]
    client_id: Optional[str]
    client_secret: Optional[str]

    # Resume attachment
    attachment_bytes: Optional[bytes]
    attachment_filename: Optional[str]

    # Execution outcomes
    gmail_message_id: Optional[str]
    status: str  # "STARTING" | "VALIDATED" | "AUTHENTICATED" | "SENT" | "FAILED"
    error: Optional[str]
    logs: List[str]
