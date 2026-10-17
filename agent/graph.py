import os
from datetime import datetime
from dotenv import load_dotenv
from supabase import create_client, Client
from langgraph.graph import StateGraph, START, END

from state import ApplicationAgentState
from gmail_tool import send_email_via_gmail_api

load_dotenv()

# Supabase Initialization
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://msyzzsoiuzwwsksfvddj.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

def get_supabase_client() -> Client:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY environment variable is required.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# -----------------------------------------------------------------------------
# GRAPH NODES
# -----------------------------------------------------------------------------

def fetch_application_node(state: ApplicationAgentState) -> ApplicationAgentState:
    """Node 1: Fetches job application details and the generated email from Supabase."""
    logs = state.get("logs", [])
    logs.append(f"[{datetime.now().isoformat()}] Step 1: Fetching application details from Supabase...")

    app_id = state["application_id"]
    user_id = state["user_id"]

    try:
        supabase = get_supabase_client()

        # 1. Fetch application record
        app_res = supabase.table("applications").select("*").eq("id", app_id).eq("user_id", user_id).single().execute()
        app_data = app_res.data
        if not app_data:
            return {
                **state,
                "status": "FAILED",
                "error": f"Application {app_id} not found for user {user_id}",
                "logs": logs,
            }

        # 2. Fetch corresponding generated email
        email_res = (
            supabase.table("application_emails")
            .select("*")
            .eq("application_id", app_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        email_data = email_res.data[0] if email_res.data else {}

        recipient_email = app_data.get("recipient_email")
        job_title = app_data.get("job_title", "Job Application")
        company_name = app_data.get("company_name", "Hiring Company")

        email_subject = email_data.get("subject") or f"Application for {job_title} at {company_name}"
        email_body = email_data.get("body") or app_data.get("generated_email")

        if not recipient_email:
            return {
                **state,
                "status": "FAILED",
                "error": "Recipient email address is missing from the application.",
                "logs": logs,
            }

        if not email_body:
            return {
                **state,
                "status": "FAILED",
                "error": "No generated email body found to send.",
                "logs": logs,
            }

        logs.append(f"Application fetched: Recipient={recipient_email}, Subject={email_subject}")

        # 3. Retrieve user's resume PDF from Supabase storage
        attachment_bytes = None
        attachment_filename = None
        try:
            resume_res = (
                supabase.table("resumes")
                .select("file_name, file_path")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if resume_res.data:
                resume_row = resume_res.data[0]
                attachment_filename = resume_row.get("file_name") or "Resume.pdf"
                file_path = resume_row.get("file_path")
                if file_path:
                    attachment_bytes = supabase.storage.from_("resumes").download(file_path)
                    logs.append(f"Resume PDF loaded: {attachment_filename} ({len(attachment_bytes)} bytes)")
        except Exception as resume_err:
            logs.append(f"Notice: Could not load resume PDF: {str(resume_err)}")

        return {
            **state,
            "job_title": job_title,
            "company_name": company_name,
            "recipient_email": recipient_email,
            "email_subject": email_subject,
            "email_body": email_body,
            "application_email_id": email_data.get("id"),
            "attachment_bytes": attachment_bytes,
            "attachment_filename": attachment_filename,
            "status": "VALIDATED",
            "logs": logs,
        }

    except Exception as e:
        logs.append(f"Error in fetch_application_node: {str(e)}")
        return {**state, "status": "FAILED", "error": str(e), "logs": logs}


def fetch_credentials_node(state: ApplicationAgentState) -> ApplicationAgentState:
    """Node 2: Retrieves user's connected Gmail OAuth refresh token from user_settings."""
    logs = state.get("logs", [])
    logs.append(f"[{datetime.now().isoformat()}] Step 2: Fetching user Gmail credentials...")

    user_id = state["user_id"]
    try:
        supabase = get_supabase_client()
        settings_res = supabase.table("user_settings").select("*").eq("user_id", user_id).single().execute()
        settings = settings_res.data or {}

        refresh_token = settings.get("google_refresh_token")
        if not refresh_token:
            return {
                **state,
                "status": "FAILED",
                "error": "User has not connected a Gmail account. Please connect Gmail in Settings first.",
                "logs": logs,
            }

        # Fallback to server master credentials
        client_id = (
            os.getenv("GOOGLE_CLIENT_ID")
            or settings.get("google_client_id")
        )
        client_secret = (
            os.getenv("GOOGLE_CLIENT_SECRET")
            or settings.get("google_client_secret")
        )
        sender_email = settings.get("google_sender_email") or "me"

        if not client_id or not client_secret:
            return {
                **state,
                "status": "FAILED",
                "error": "Google OAuth client credentials are not configured.",
                "logs": logs,
            }

        logs.append(f"Credentials loaded for sender: {sender_email}")

        return {
            **state,
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
            "sender_email": sender_email,
            "status": "AUTHENTICATED",
            "logs": logs,
        }

    except Exception as e:
        logs.append(f"Error in fetch_credentials_node: {str(e)}")
        return {**state, "status": "FAILED", "error": str(e), "logs": logs}


def send_email_node(state: ApplicationAgentState) -> ApplicationAgentState:
    """Node 3: Executes autonomous Gmail dispatch via Gmail REST API."""
    logs = state.get("logs", [])
    logs.append(f"[{datetime.now().isoformat()}] Step 3: Sending email via Gmail REST API...")

    try:
        msg_id = send_email_via_gmail_api(
            refresh_token=state["refresh_token"],
            client_id=state["client_id"],
            client_secret=state["client_secret"],
            sender_email=state["sender_email"],
            recipient_email=state["recipient_email"],
            subject=state["email_subject"],
            body_text_or_html=state["email_body"],
            attachment_bytes=state.get("attachment_bytes"),
            attachment_filename=state.get("attachment_filename"),
        )

        logs.append(f"Email successfully sent with attachment! Gmail Message ID: {msg_id}")

        return {
            **state,
            "gmail_message_id": msg_id,
            "status": "SENT",
            "logs": logs,
        }

    except Exception as e:
        logs.append(f"Gmail send error: {str(e)}")
        return {
            **state,
            "status": "FAILED",
            "error": f"Failed to send email via Gmail API: {str(e)}",
            "logs": logs,
        }


def update_database_node(state: ApplicationAgentState) -> ApplicationAgentState:
    """Node 4: Updates status in Supabase applications and application_emails tables."""
    logs = state.get("logs", [])
    logs.append(f"[{datetime.now().isoformat()}] Step 4: Updating status in database...")

    try:
        supabase = get_supabase_client()
        now_iso = datetime.now().isoformat()

        # Update applications table
        supabase.table("applications").update({
            "status": "Applied",
            "applied_at": now_iso,
        }).eq("id", state["application_id"]).execute()

        # Update application_emails table
        if state.get("application_email_id"):
            supabase.table("application_emails").update({
                "status": "sent",
                "sent_at": now_iso,
            }).eq("id", state["application_email_id"]).execute()

        logs.append("Database records successfully updated to Applied.")
        return {**state, "logs": logs}

    except Exception as e:
        logs.append(f"Database update warning: {str(e)}")
        return {**state, "logs": logs}


def handle_error_node(state: ApplicationAgentState) -> ApplicationAgentState:
    """Error Node: Catches and logs errors encountered anywhere in the workflow."""
    logs = state.get("logs", [])
    error_msg = state.get("error", "Unknown workflow error")
    logs.append(f"[{datetime.now().isoformat()}] Agent Terminated with Error: {error_msg}")
    print(f"[LangGraph Agent Error]: {error_msg}")
    return {**state, "status": "FAILED", "logs": logs}


# -----------------------------------------------------------------------------
# CONDITIONAL ROUTING LOGIC
# -----------------------------------------------------------------------------

def route_after_fetch_app(state: ApplicationAgentState) -> str:
    if state.get("status") == "FAILED":
        return "handle_error"
    return "fetch_credentials"

def route_after_fetch_creds(state: ApplicationAgentState) -> str:
    if state.get("status") == "FAILED":
        return "handle_error"
    return "send_email"

def route_after_send(state: ApplicationAgentState) -> str:
    if state.get("status") == "FAILED":
        return "handle_error"
    return "update_database"


# -----------------------------------------------------------------------------
# BUILD THE LANGGRAPH AGENT WORKFLOW
# -----------------------------------------------------------------------------

def build_job_apply_agent():
    workflow = StateGraph(ApplicationAgentState)

    # 1. Register Nodes
    workflow.add_node("fetch_application", fetch_application_node)
    workflow.add_node("fetch_credentials", fetch_credentials_node)
    workflow.add_node("send_email", send_email_node)
    workflow.add_node("update_database", update_database_node)
    workflow.add_node("handle_error", handle_error_node)

    # 2. Connect Edges & Conditional Routing
    workflow.add_edge(START, "fetch_application")

    workflow.add_conditional_edges(
        "fetch_application",
        route_after_fetch_app,
        {
            "fetch_credentials": "fetch_credentials",
            "handle_error": "handle_error",
        }
    )

    workflow.add_conditional_edges(
        "fetch_credentials",
        route_after_fetch_creds,
        {
            "send_email": "send_email",
            "handle_error": "handle_error",
        }
    )

    workflow.add_conditional_edges(
        "send_email",
        route_after_send,
        {
            "update_database": "update_database",
            "handle_error": "handle_error",
        }
    )

    workflow.add_edge("update_database", END)
    workflow.add_edge("handle_error", END)

    return workflow.compile()


# Compiled Singleton Graph
app_agent = build_job_apply_agent()
