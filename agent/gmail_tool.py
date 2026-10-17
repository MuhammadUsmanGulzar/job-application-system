import base64
from typing import Optional
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication
from email.header import Header
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

def send_email_via_gmail_api(
    refresh_token: str,
    client_id: str,
    client_secret: str,
    sender_email: str,
    recipient_email: str,
    subject: str,
    body_text_or_html: str,
    attachment_bytes: Optional[bytes] = None,
    attachment_filename: Optional[str] = None,
) -> str:
    """
    Refreshes access token and sends email via official Gmail REST API,
    with optional resume PDF attachment.
    Returns: Gmail message ID
    """
    # 1. Initialize Google Credentials with refresh token
    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=["https://www.googleapis.com/auth/gmail.send"],
    )

    # 2. Force token refresh to verify access
    request = Request()
    creds.refresh(request)

    # 3. Construct message body (HTML + Plaintext)
    msg_body = MIMEMultipart("alternative")
    msg_body.attach(MIMEText(body_text_or_html, "plain", "utf-8"))

    formatted_html = (
        body_text_or_html
        if "<div" in body_text_or_html or "<p" in body_text_or_html
        else f"<div style='font-family: Arial, sans-serif; font-size: 15px; line-height: 1.6; color: #1e293b;'>{body_text_or_html.replace(chr(10), '<br/>')}</div>"
    )
    msg_body.attach(MIMEText(formatted_html, "html", "utf-8"))

    # 4. Attach to outer multipart/mixed if attachment exists
    if attachment_bytes and attachment_filename:
        msg = MIMEMultipart("mixed")
        msg["From"] = sender_email
        msg["To"] = recipient_email
        msg["Subject"] = Header(subject or "Job Application", "utf-8").encode()
        msg.attach(msg_body)

        pdf_part = MIMEApplication(attachment_bytes, _subtype="pdf")
        pdf_part.add_header(
            "Content-Disposition",
            "attachment",
            filename=attachment_filename
        )
        msg.attach(pdf_part)
    else:
        msg = msg_body
        msg["From"] = sender_email
        msg["To"] = recipient_email
        msg["Subject"] = Header(subject or "Job Application", "utf-8").encode()

    # Encode message as base64url
    raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

    # 5. Dispatch via Gmail API
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    result = service.users().messages().send(
        userId="me",
        body={"raw": raw_message}
    ).execute()

    return result.get("id")
