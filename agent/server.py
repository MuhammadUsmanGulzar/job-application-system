import os
import argparse
import re
from typing import Any, Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from graph import app_agent
from state import ApplicationAgentState
from job_parser_agent import job_parser_agent, JobParserState
from resume_tailor_agent import resume_tailor_agent, ResumeTailorState, extract_resume_from_bucket, get_supabase_client
from ats_agent import ats_agent, AtsAgentState
from llm_client import call_user_llm

app = FastAPI(title="LangGraph Job Application Email & Parser Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SendEmailRequest(BaseModel):
    application_id: str
    user_id: str

class JobParserRequest(BaseModel):
    raw_text: str
    user_id: str = ""
    send_webhook: bool = False
    save_to_db: bool = False
    llm_provider: str = "OpenAI"
    llm_api_key: str = ""
    llm_model: str = ""

class EmailGenerateRequest(BaseModel):
    job_title: str = "Software Engineer"
    company_name: str = "Hiring Team"
    recipient_email: str = ""
    requirements: str = ""
    description: str = ""
    resume_content: str = ""
    full_name: str = ""
    headline: str = ""
    user_email: str = ""
    phone: str = ""
    linkedin: str = ""
    portfolio: str = ""
    github: str = ""
    llm_provider: str = "OpenAI"
    llm_api_key: str = ""
    llm_model: str = ""

class ResumeTailorRequest(BaseModel):
    user_id: str = ""
    job_title: str = "Software Engineer"
    company_name: str = ""
    requirements: str = ""
    job_description: str = ""
    raw_resume: str = ""
    resume_name: str = ""
    save_to_db: bool = True
    ats_report: Dict[str, Any] = Field(default_factory=dict)
    llm_provider: str = "OpenAI"
    llm_api_key: str = ""
    llm_model: str = ""

class AtsAnalysisRequest(BaseModel):
    user_id: str = ""
    application_id: str = ""
    job_title: str = ""
    company_name: str = ""
    requirements: str = ""
    job_description: str = ""
    raw_resume: str = ""
    resume_name: str = ""
    stage: str = "before"
    save_to_db: bool = True
    llm_provider: str = "OpenAI"
    llm_api_key: str = ""
    llm_model: str = ""

class ResumeBucketSyncRequest(BaseModel):
    user_id: str

class ResumeFileUrlRequest(BaseModel):
    user_id: str
    file_name: str = ""

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "LangGraph Email, Parser, ATS & Resume Tailor Agents"}

@app.post("/api/agent/analyze-ats")
def analyze_resume_ats(req: AtsAnalysisRequest):
    """Runs the ATS agent and optionally stores the report against an application."""
    if req.stage not in ("before", "after"):
        raise HTTPException(status_code=400, detail="stage must be 'before' or 'after'.")
    if not (req.requirements.strip() or req.job_description.strip() or req.job_title.strip()):
        raise HTTPException(status_code=400, detail="Job title, requirements, or description is required.")

    initial_state: AtsAgentState = {
        "user_id": req.user_id,
        "application_id": req.application_id,
        "job_title": req.job_title,
        "company_name": req.company_name,
        "requirements": req.requirements,
        "job_description": req.job_description,
        "raw_resume": req.raw_resume,
        "resume_name": req.resume_name,
        "stage": req.stage,
        "save_to_db": req.save_to_db,
        "llm_provider": req.llm_provider,
        "llm_api_key": req.llm_api_key,
        "llm_model": req.llm_model,
        "status": "STARTING",
        "logs": [],
    }
    result = ats_agent.invoke(initial_state)
    if result.get("status") == "FAILED":
        raise HTTPException(status_code=400, detail={"error": result.get("error"), "logs": result.get("logs", [])})

    return {
        "success": True,
        "status": result.get("status"),
        "stage": result.get("stage", req.stage),
        "score": result.get("score", 0),
        "score_breakdown": result.get("score_breakdown", {}),
        "matched_skills": result.get("matched_skills", []),
        "missing_skills": result.get("missing_skills", []),
        "resume_skills": result.get("resume_skills", []),
        "suggestions": result.get("suggestions", []),
        "summary": result.get("summary", ""),
        "analyzed_at": result.get("analyzed_at"),
        "logs": result.get("logs", []),
    }

@app.post("/api/agent/get-resume-file-url")
def get_resume_file_url_endpoint(req: ResumeFileUrlRequest):
    """
    Generates a secure signed URL for viewing the user's PDF resume in the browser/app.
    """
    if not req.user_id:
        raise HTTPException(status_code=400, detail="user_id is required.")
    
    supabase = get_supabase_client()
    file_name = req.file_name.strip()

    if not file_name:
        # Query bucket for user's primary/latest resume
        try:
            files = supabase.storage.from_("resumes").list(req.user_id)
            real_files = [f for f in files if f.get("name") and not f.get("name").endswith("/")]
            if real_files:
                real_files.sort(key=lambda x: x.get("updated_at") or x.get("created_at") or "", reverse=True)
                file_name = real_files[0]["name"]
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Storage list error: {str(e)}")

    if not file_name:
        raise HTTPException(status_code=404, detail="No resume file found in storage.")

    path = f"{req.user_id}/{file_name}"
    try:
        res = supabase.storage.from_("resumes").create_signed_url(path, 7200)
        signed_url = res.get("signedURL") or res.get("signedUrl")
        return {
            "success": True,
            "file_name": file_name,
            "signed_url": signed_url,
            "is_pdf": file_name.lower().endswith(".pdf"),
            "file_path": path,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate signed URL: {str(e)}")

@app.post("/api/agent/sync-resume-from-bucket")
def sync_resume_from_bucket_endpoint(req: ResumeBucketSyncRequest):
    """
    Downloads the respective user's resume from Supabase Storage bucket 'resumes/{user_id}/',
    extracts the text content (from PDF, docx, or txt), syncs user_settings,
    and returns the resume name and extracted text.
    """
    if not req.user_id:
        raise HTTPException(status_code=400, detail="user_id is required.")
    
    file_name, extracted_text = extract_resume_from_bucket(req.user_id)
    if not extracted_text:
        return {
            "success": False,
            "message": f"No resume files found in bucket 'resumes/{req.user_id}/'",
            "resume_name": "",
            "resume_content": "",
        }
    
    # Also generate signed URL for PDF viewer
    signed_url = ""
    try:
        supabase = get_supabase_client()
        res = supabase.storage.from_("resumes").create_signed_url(f"{req.user_id}/{file_name}", 7200)
        signed_url = res.get("signedURL") or res.get("signedUrl") or ""
    except Exception:
        pass

    return {
        "success": True,
        "resume_name": file_name,
        "resume_content": extracted_text,
        "signed_url": signed_url,
        "is_pdf": file_name.lower().endswith(".pdf"),
        "length": len(extracted_text),
        "source": "supabase_bucket",
    }

@app.post("/api/agent/tailor-resume")
def trigger_agent_tailor_resume(req: ResumeTailorRequest):
    """
    Invokes the LangGraph Resume Tailor Agent to analyze the target job requirements,
    tailor the user's resume headline, summary, and technical competencies,
    and persist the customized resume to Supabase user_settings / resumes table.
    """
    initial_state: ResumeTailorState = {
        "user_id": req.user_id,
        "job_title": req.job_title,
        "company_name": req.company_name,
        "requirements": req.requirements,
        "job_description": req.job_description,
        "raw_resume": req.raw_resume,
        "resume_name": req.resume_name,
        "ats_report": req.ats_report,
        "save_to_db": req.save_to_db,
        "llm_provider": req.llm_provider,
        "llm_api_key": req.llm_api_key,
        "llm_model": req.llm_model,
        "status": "STARTING",
        "logs": [],
    }

    result = resume_tailor_agent.invoke(initial_state)

    if result.get("status") == "FAILED":
        raise HTTPException(status_code=400, detail={
            "error": result.get("error"),
            "logs": result.get("logs"),
        })

    return {
        "success": True,
        "status": result.get("status"),
        "resume_name": result.get("resume_name"),
        "tailored_resume": result.get("tailored_resume"),
        "matched_skills": result.get("matched_skills", []),
        "missing_skills": result.get("missing_skills", []),
        "enhancements": result.get("enhancements", []),
        "logs": result.get("logs", []),
    }

@app.post("/api/agent/parse-job")
def trigger_agent_parse_job(req: JobParserRequest):
    """
    Invokes the LangGraph Job Parser Agent to normalize unicode,
    extract structured fields (company, title, recipient email, requirements),
    optionally store in Supabase, and dispatch to n8n webhook.
    """
    initial_state: JobParserState = {
        "raw_text": req.raw_text,
        "user_id": req.user_id,
        "save_to_db": req.save_to_db,
        "send_webhook": req.send_webhook,
        "llm_provider": req.llm_provider,
        "llm_api_key": req.llm_api_key,
        "llm_model": req.llm_model,
        "status": "STARTING",
        "logs": [],
    }

    result = job_parser_agent.invoke(initial_state)

    if result.get("status") == "FAILED":
        raise HTTPException(status_code=400, detail={
            "error": result.get("error"),
            "logs": result.get("logs"),
        })

    return {
        "success": True,
        "status": result.get("status"),
        "job_title": result.get("job_title"),
        "company_name": result.get("company_name"),
        "recipient_email": result.get("recipient_email"),
        "requirements": result.get("requirements"),
        "description": result.get("description"),
        "application_id": result.get("application_id"),
        "webhook_sent": result.get("webhook_sent", False),
        "logs": result.get("logs"),
    }


@app.post("/api/agent/send-email")
def trigger_agent_send_email(req: SendEmailRequest):
    """
    Invokes the LangGraph Agent to autonomously fetch application data,
    verify Gmail OAuth credentials, send the email via Gmail API, and update the database.
    """
    initial_state: ApplicationAgentState = {
        "application_id": req.application_id,
        "user_id": req.user_id,
        "status": "STARTING",
        "logs": [],
    }

    result = app_agent.invoke(initial_state)

    if result.get("status") == "FAILED":
        raise HTTPException(status_code=400, detail={
            "error": result.get("error"),
            "logs": result.get("logs"),
        })

    return {
        "success": True,
        "status": result.get("status"),
        "gmail_message_id": result.get("gmail_message_id"),
        "recipient": result.get("recipient_email"),
        "subject": result.get("email_subject"),
        "logs": result.get("logs"),
    }

@app.post("/api/agent/generate-email")
def generate_email_endpoint(req: EmailGenerateRequest):
    """
    Direct Application Email Generation Agent using the user's configured LLM API.
    """
    if not req.llm_api_key:
        raise HTTPException(status_code=400, detail="Missing user LLM API key.")

    sender_name = req.full_name or "Applicant"
    job_title = req.job_title or "Software Engineer"
    company_name = req.company_name or "Hiring Team"

    prompt = f"""You are an elite career strategist. Write a high-converting, professional, tailored job application email for:
Applicant: {sender_name} ({req.headline or job_title})
Email: {req.user_email} | Phone: {req.phone}
Target Position: {job_title} at {company_name}
Recruiter Email: {req.recipient_email}

Job Requirements & Scope:
{req.requirements}
{req.description}

Applicant's Resume Context:
{req.resume_content[:2500] if req.resume_content else 'Experienced software professional.'}

Guidelines:
1. Subject line must be compelling, concise, and professional (e.g. "Application for {job_title} - {sender_name}").
2. The body must open with high energy and direct statement of value.
3. Highlight 2-3 specific achievements or technical qualifications directly matching the requirements.
4. Keep paragraphs readable (3-4 concise paragraphs max).
5. Professional sign-off including applicant name and contact details.

Format output as:
Subject: <Subject line>

<Body of the email>
"""

    try:
        raw_output = call_user_llm(
            prompt=prompt,
            system_prompt="You write compelling, recruiter-ready job application emails without placeholder brackets.",
            provider=req.llm_provider,
            api_key=req.llm_api_key,
            model=req.llm_model,
            temperature=0.3,
            json_mode=False,
        )

        subject = f"Application for {job_title} - {sender_name}"
        body = raw_output.strip()

        subj_match = re.search(r"^Subject:\s*(.*)$", body, re.MULTILINE | re.IGNORECASE)
        if subj_match:
            subject = subj_match.group(1).strip()
            body = re.sub(r"^Subject:\s*.*(?:\r?\n)+", "", body, count=1, flags=re.IGNORECASE).strip()

        return {
            "success": True,
            "subject": subject,
            "body": body,
            "full_email": f"Subject: {subject}\n\n{body}",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM email generation error: {str(e)}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LangGraph Job Application Agent")
    parser.add_argument("--app-id", help="Application UUID to send")
    parser.add_argument("--user-id", help="User UUID who owns the application")
    parser.add_argument("--serve", action="store_true", help="Start the FastAPI web server")
    parser.add_argument("--port", type=int, default=8000, help="Port to serve on")

    args = parser.parse_args()

    if args.serve:
        print(f"Starting LangGraph Agent server on http://localhost:{args.port}...")
        uvicorn.run("server:app", host="0.0.0.0", port=args.port, reload=True)
    elif args.app_id and args.user_id:
        print(f"Executing LangGraph agent for App: {args.app_id}, User: {args.user_id}...")
        state: ApplicationAgentState = {
            "application_id": args.app_id,
            "user_id": args.user_id,
            "status": "STARTING",
            "logs": [],
        }
        output = app_agent.invoke(state)
        print("\n--- AGENT RESULT ---")
        print(f"Status: {output.get('status')}")
        if output.get('error'):
            print(f"Error: {output.get('error')}")
        else:
            print(f"Gmail Message ID: {output.get('gmail_message_id')}")
        print("\nLogs:")
        for log in output.get("logs", []):
            print("  ", log)
    else:
        print("Usage:")
        print("  Run as server:  python server.py --serve")
        print("  Run one-off:    python server.py --app-id <UUID> --user-id <UUID>")
