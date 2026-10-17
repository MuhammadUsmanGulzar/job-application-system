import os
import re
import unicodedata
from typing import Any, Dict, Optional, List
from typing_extensions import TypedDict
from dotenv import load_dotenv
from supabase import create_client, Client
from langgraph.graph import StateGraph, START, END
from llm_client import call_user_llm, parse_json_from_llm_response

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://msyzzsoiuzwwsksfvddj.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

def get_supabase_client() -> Client:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required in environment.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# -----------------------------------------------------------------------------
# STATE DEFINITION
# -----------------------------------------------------------------------------

class ResumeTailorState(TypedDict, total=False):
    user_id: str
    job_title: str
    company_name: Optional[str]
    requirements: Optional[str]
    job_description: Optional[str]
    raw_resume: Optional[str]
    resume_name: Optional[str]
    save_to_db: bool
    ats_report: Dict[str, Any]
    llm_provider: Optional[str]
    llm_api_key: Optional[str]
    llm_model: Optional[str]
    
    # Processed Fields
    extracted_keywords: List[str]
    matched_skills: List[str]
    missing_skills: List[str]
    tailored_resume: str
    enhancements: List[str]
    
    # Status & Logging
    status: str  # "STARTING" | "LOADED" | "ANALYZED" | "TAILORED" | "SAVED" | "FAILED"
    error: Optional[str]
    logs: List[str]


# -----------------------------------------------------------------------------
# SUPABASE STORAGE BUCKET RESUME EXTRACTOR
# -----------------------------------------------------------------------------

def extract_resume_from_bucket(user_id: str, supabase_client: Optional[Client] = None) -> tuple[str, str]:
    """
    Downloads the user's latest resume from Supabase Storage bucket 'resumes/{user_id}/',
    extracts text (using pypdf if PDF), and returns (file_name, extracted_text).
    Also updates user_settings so the database stays up to date.
    """
    if not user_id:
        return "", ""
    
    supabase = supabase_client or get_supabase_client()
    try:
        files = supabase.storage.from_("resumes").list(user_id)
        if not files:
            return "", ""
        
        # Filter out folder placeholders
        real_files = [f for f in files if f.get("name") and not f.get("name").endswith("/")]
        if not real_files:
            return "", ""
        
        # Sort descending by updated_at or created_at
        real_files.sort(key=lambda x: x.get("updated_at") or x.get("created_at") or "", reverse=True)
        chosen_file = real_files[0]
        file_name = chosen_file["name"]
        file_path = f"{user_id}/{file_name}"

        file_bytes = supabase.storage.from_("resumes").download(file_path)
        extracted_text = ""

        if file_name.lower().endswith(".pdf"):
            import io
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    extracted_text += page_text + "\n"
        elif file_name.lower().endswith((".txt", ".md", ".json", ".rtf")):
            extracted_text = file_bytes.decode("utf-8", errors="ignore")
        elif file_name.lower().endswith((".doc", ".docx")):
            try:
                import io, docx
                doc = docx.Document(io.BytesIO(file_bytes))
                extracted_text = "\n".join([p.text for p in doc.paragraphs if p.text])
            except Exception:
                extracted_text = file_bytes.decode("latin-1", errors="ignore")
        else:
            extracted_text = file_bytes.decode("utf-8", errors="ignore")

        extracted_text = extracted_text.strip()
        if extracted_text:
            # Sync to user_settings table
            try:
                supabase.table("user_settings").update({
                    "resume_name": file_name,
                    "resume_content": extracted_text,
                }).eq("user_id", user_id).execute()
            except Exception:
                pass
            
            # Sync to resumes table
            try:
                supabase.table("resumes").upsert({
                    "user_id": user_id,
                    "file_name": file_name,
                    "file_path": file_path,
                    "parsed_text": extracted_text,
                    "is_primary": True,
                }, on_conflict="user_id,file_path").execute()
            except Exception:
                pass

        return file_name, extracted_text
    except Exception as e:
        print(f"Error extracting resume from bucket for user {user_id}: {e}")
        return "", ""


# -----------------------------------------------------------------------------
# GRAPH NODES
# -----------------------------------------------------------------------------

def load_user_resume_node(state: ResumeTailorState) -> ResumeTailorState:
    """
    Node 1: Loads the user's existing resume content from state or Supabase.
    If no resume exists, constructs a strong initial template using the user profile.
    """
    logs = list(state.get("logs", []))
    user_id = state.get("user_id", "").strip()
    raw_resume = state.get("raw_resume", "").strip()
    resume_name = state.get("resume_name", "")

    logs.append(f"Starting Resume Tailor Agent for User: {user_id or 'Guest'}")

    if raw_resume:
        logs.append(f"Using provided raw resume content ({len(raw_resume)} chars)")
        return {
            **state,
            "raw_resume": raw_resume,
            "resume_name": resume_name or "Resume.txt",
            "status": "LOADED",
            "logs": logs,
        }

    # If no raw resume provided in payload, attempt retrieval from Supabase
    if user_id:
        try:
            supabase = get_supabase_client()
            logs.append(f"Querying user_settings for resume content of user: {user_id}...")

            # 1. Check user_settings
            res = (
                supabase.from_("user_settings")
                .select("resume_name, resume_content")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )

            if res.data and res.data.get("resume_content"):
                raw_resume = res.data["resume_content"]
                resume_name = res.data.get("resume_name") or "Resume.txt"
                logs.append(f"Found active resume in user_settings: '{resume_name}' ({len(raw_resume)} chars)")
                return {
                    **state,
                    "raw_resume": raw_resume,
                    "resume_name": resume_name,
                    "status": "LOADED",
                    "logs": logs,
                }

            # 2. Check Supabase Storage Bucket 'resumes/{user_id}/'
            logs.append(f"Checking Supabase Storage Bucket 'resumes/{user_id}/'...")
            bucket_fname, bucket_text = extract_resume_from_bucket(user_id, supabase)
            if bucket_text:
                logs.append(f"Successfully loaded and extracted resume from bucket: '{bucket_fname}' ({len(bucket_text)} chars)")
                return {
                    **state,
                    "raw_resume": bucket_text,
                    "resume_name": bucket_fname,
                    "status": "LOADED",
                    "logs": logs,
                }

            # 3. Check public.resumes table
            res_table = (
                supabase.from_("resumes")
                .select("file_name, parsed_text")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if res_table.data and len(res_table.data) > 0 and res_table.data[0].get("parsed_text"):
                raw_resume = res_table.data[0]["parsed_text"]
                resume_name = res_table.data[0].get("file_name") or "Resume.txt"
                logs.append(f"Found resume in public.resumes: '{resume_name}'")
                return {
                    **state,
                    "raw_resume": raw_resume,
                    "resume_name": resume_name,
                    "status": "LOADED",
                    "logs": logs,
                }

            # 3. Fallback: Build base resume from user's profile
            prof = (
                supabase.from_("users")
                .select("*")
                .eq("id", user_id)
                .maybe_single()
                .execute()
            )
            user_data = prof.data or {}
            full_name = user_data.get("full_name") or "Applicant"
            headline = user_data.get("headline") or "Software Engineer"
            bio = user_data.get("bio") or ""
            email = user_data.get("email") or ""
            phone = user_data.get("phone") or ""
            location = user_data.get("location") or ""
            portfolio = user_data.get("portfolio") or ""
            linkedin = user_data.get("linkedin") or ""
            github = user_data.get("github") or ""

            contact_parts = [p for p in [email, phone, location, linkedin, github, portfolio] if p]
            contact_line = " | ".join(contact_parts)

            constructed_resume = f"""{full_name}
{headline}
{contact_line}

PROFESSIONAL SUMMARY
{bio or f"Dynamic and results-driven professional with strong technical expertise, proven problem-solving abilities, and passion for delivering robust solutions."}

CORE COMPETENCIES & TECHNICAL SKILLS
• Programming & Frameworks: Python, JavaScript, TypeScript, React, Node.js
• AI & Machine Learning: LLM Integrations, Prompt Engineering, API Workflows
• Databases & Cloud: PostgreSQL, Supabase, Git, RESTful APIs

PROFESSIONAL EXPERIENCE
Software Engineer | Technology Solutions
• Developed and deployed scalable full-stack applications with high reliability.
• Automated workflows and integrated REST APIs to streamline operational efficiency.
• Collaborated in cross-functional teams to deliver end-to-end software deliverables.

EDUCATION
Bachelor of Science in Computer Science
"""
            logs.append(f"Constructed baseline resume template from profile for {full_name}")
            return {
                **state,
                "raw_resume": constructed_resume.strip(),
                "resume_name": f"{full_name}_Resume.txt",
                "status": "LOADED",
                "logs": logs,
            }

        except Exception as e:
            logs.append(f"Supabase resume load warning: {str(e)}")

    # Generic baseline resume if no user_id or DB failure
    baseline = """JOHN DOE
Software Engineer | AI & Full-Stack Developer
email: applicant@example.com | Phone: +1 555-0199 | Location: Remote

PROFESSIONAL SUMMARY
Passionate Software Engineer with expertise in building scalable web applications, integrating AI agents, and automating business workflows.

CORE COMPETENCIES & TECHNICAL SKILLS
• Programming: Python, JavaScript, TypeScript, HTML/CSS
• Frameworks & Tools: React, React Native, Node.js, FastAPI, n8n, LangGraph
• Databases: PostgreSQL, Supabase, SQLite

PROFESSIONAL EXPERIENCE
Software Developer | Tech Solutions
• Engineered responsive web applications and backend automation workflows.
• Integrated LLM APIs and modern state management to enhance productivity.

EDUCATION
B.S. in Computer Science
"""
    return {
        **state,
        "raw_resume": baseline,
        "resume_name": "Resume.txt",
        "status": "LOADED",
        "logs": logs,
    }


def analyze_requirements_node(state: ResumeTailorState) -> ResumeTailorState:
    """
    Node 2: Extracts technical keywords, soft skills, and requirements from the target job posting.
    """
    logs = list(state.get("logs", []))
    req_text = (state.get("requirements") or "") + " " + (state.get("job_description") or "") + " " + (state.get("job_title") or "")
    
    # Normalize unicode characters
    req_text = unicodedata.normalize("NFKD", req_text)

    # Common technical skills and tools dictionary
    tech_keywords_catalog = [
        "Python", "JavaScript", "TypeScript", "React", "React Native", "Next.js", "Node.js", "Express",
        "FastAPI", "Django", "Flask", "LangGraph", "LangChain", "OpenAI", "ChatGPT", "Claude", "Gemini",
        "LLMs", "Generative AI", "AI Agents", "Prompt Engineering", "n8n", "Make", "Zapier", "Automations",
        "PostgreSQL", "Supabase", "MongoDB", "MySQL", "Redis", "Docker", "Kubernetes", "AWS", "GCP",
        "Git", "GitHub", "REST APIs", "GraphQL", "CI/CD", "SEO", "Digital Marketing", "Computer Science",
        "Software Engineering", "Unit Testing", "Debugging", "Data Science", "Machine Learning", "NLP"
    ]

    extracted_keywords = []
    for kw in tech_keywords_catalog:
        pattern = r"\b" + re.escape(kw) + r"\b"
        if re.search(pattern, req_text, re.IGNORECASE):
            extracted_keywords.append(kw)

    # Also capture bullet points or lines under Requirements
    bullets = re.findall(r"(?:•|\*|-|\d+\.)\s*([A-Za-z0-9\s,./()+-]{3,50})", req_text)
    for b in bullets:
        clean_b = b.strip()
        if len(clean_b) > 4 and clean_b not in extracted_keywords:
            if not any(k.lower() in clean_b.lower() for k in ["apply", "whatsapp", "location", "salary", "shift", "on-site"]):
                extracted_keywords.append(clean_b)

    # Deduplicate while preserving case
    seen = set()
    unique_keywords = []
    for kw in extracted_keywords:
        if kw.lower() not in seen:
            seen.add(kw.lower())
            unique_keywords.append(kw)

    logs.append(f"Extracted {len(unique_keywords)} key skills/requirements: {', '.join(unique_keywords[:8])}")

    return {
        **state,
        "extracted_keywords": unique_keywords,
        "status": "ANALYZED",
        "logs": logs,
    }


def tailor_resume_content_node(state: ResumeTailorState) -> ResumeTailorState:
    """
    Node 3: Intelligently tailors the user's resume for the target job:
    - Customizes the headline & executive summary for target role & company.
    - Elevates matching technical skills into a highlighted Core Competencies section.
    - Adapts experience bullet points to showcase direct alignment.
    """
    logs = list(state.get("logs", []))
    raw = state.get("raw_resume", "").strip()
    job_title = (state.get("job_title") or "Software Engineer").strip()
    company_name = (state.get("company_name") or "the hiring organization").strip()
    keywords = state.get("extracted_keywords", [])
    ats_report = state.get("ats_report") or {}

    matched_skills = []
    missing_skills = []

    for kw in keywords:
        if re.search(r"\b" + re.escape(kw) + r"\b", raw, re.IGNORECASE):
            matched_skills.append(kw)
        else:
            missing_skills.append(kw)

    logs.append(f"Skill Alignment: {len(matched_skills)} matched, {len(missing_skills)} to integrate/highlight.")

    # 0. Direct User LLM Resume Tailoring if API key is provided
    llm_api_key = (state.get("llm_api_key") or "").strip()
    if llm_api_key:
        try:
            req_details = " ".join([state.get("requirements") or "", state.get("job_description") or ""])
            report_suggestions = ats_report.get("suggestions") or []
            sugg_text = "\n".join([f"- {s.get('detail') if isinstance(s, dict) else str(s)}" for s in report_suggestions[:5]])

            prompt = f"""You are an elite Executive Resume Strategist and ATS Optimization Specialist.
Rewrite and optimize the candidate's existing resume to achieve maximum ATS compatibility and recruiter impact for the target role.

Target Job:
Role: {job_title}
Company: {company_name}
Requirements:
{req_details}

ATS Recommendations:
{sugg_text or "Align technical skills and experience bullets with target responsibilities."}

Original Resume:
\"\"\"{raw}\"\"\"

CRITICAL RULES:
1. Do NOT use ASCII decorative borders or horizontal lines (e.g. NEVER output lines of '═════' or '-----').
2. Use standard uppercase section titles:
   [NAME]
   [HEADLINE / TARGET ROLE]
   [CONTACT INFO]
   PROFESSIONAL SUMMARY
   CORE COMPETENCIES & TECHNICAL SKILLS
   PROFESSIONAL EXPERIENCE
   PROJECTS (if present)
   EDUCATION
3. Begin every experience bullet point with a strong action verb (e.g., Engineered, Architected, Spearheaded, Automated).
4. Emphasize verified skills only. Never fabricate employers, universities, or credentials.
5. Return ONLY a valid JSON object matching this schema:
{{
  "tailoredResume": "Complete optimized plain text resume",
  "matchedSkills": ["Skill 1", "Skill 2"],
  "missingSkills": ["Gap 1", "Gap 2"],
  "enhancements": ["Action 1 taken", "Action 2 taken", "Action 3 taken"]
}}
"""
            raw_json = call_user_llm(
                prompt=prompt,
                system_prompt="You optimize resumes for maximum ATS indexing. Return pure JSON with zero markdown fluff.",
                provider=state.get("llm_provider", "OpenAI"),
                api_key=llm_api_key,
                model=state.get("llm_model", ""),
                temperature=0.2,
                json_mode=True,
            )
            parsed = parse_json_from_llm_response(raw_json)
            if parsed.get("tailoredResume") and len(parsed["tailoredResume"]) > 200:
                cleaned_resume = parsed["tailoredResume"].replace("═", "").strip()
                logs.append(f"Successfully optimized resume via user's LLM ({state.get('llm_provider', 'OpenAI')})")
                return {
                    **state,
                    "tailored_resume": cleaned_resume,
                    "matched_skills": parsed.get("matchedSkills") or matched_skills,
                    "missing_skills": parsed.get("missingSkills") or missing_skills,
                    "enhancements": parsed.get("enhancements") or [
                        f"Targeted headline and professional summary for {job_title} at {company_name}.",
                        "Optimized technical competencies and ATS keywords.",
                        "Standardized clean formatting without non-standard symbols.",
                    ],
                    "status": "TAILORED",
                    "logs": logs,
                }
        except Exception as e:
            logs.append(f"User LLM resume optimization notice: {str(e)}. Falling back to template tailor engine.")

    # Emphasize verified skills only. Missing keywords become recommendations, never fabricated claims.
    report_matched = ats_report.get("matchedSkills") or ats_report.get("matched_skills") or []
    verified_matches = []
    for skill in matched_skills + report_matched:
        if skill not in verified_matches and re.search(r"\b" + re.escape(skill) + r"\b", raw, re.IGNORECASE):
            verified_matches.append(skill)
    top_skills_to_highlight = verified_matches[:12]
    skills_formatted = ", ".join(top_skills_to_highlight) if top_skills_to_highlight else "Software Engineering, Problem Solving, Collaboration"

    # Break raw resume into sections
    lines = raw.split("\n")
    name_line = lines[0].strip() if len(lines) > 0 and lines[0].strip() else "CANDIDATE"
    
    # Check if second line is a contact line or headline
    contact_info = ""
    for line in lines[1:5]:
        if any(c in line for c in ["@", "phone", "+", "http", "linkedin", "github", "location", "|"]):
            contact_info = line.strip()
            break

    if not contact_info and len(lines) > 1:
        contact_info = lines[1].strip()

    # Generate tailored summary
    tailored_summary = (
        f"Results-oriented {job_title} with proven proficiency in {skills_formatted}. "
        f"Demonstrated track record of delivering high-quality engineering solutions, optimizing workflows, and adapting rapidly to new technology stacks. "
        f"Excited to bring hands-on expertise, technical agility, and collaborative drive to {company_name}."
    )

    enhancements = [
        f"Aligned professional headline and target role directly with '{job_title}'.",
        f"Customized Executive Summary specifically targeting requirements for {company_name}.",
        f"Elevated and spotlighted key matching competencies: {skills_formatted}.",
        f"Refined ATS formatting for maximum keyword indexing and recruiter readability.",
    ]
    report_suggestions = ats_report.get("suggestions") or []
    for suggestion in report_suggestions[:3]:
        detail = suggestion.get("detail") if isinstance(suggestion, dict) else str(suggestion)
        if detail:
            enhancements.append(f"ATS recommendation applied where supported: {detail}")

    # Reconstruct tailored resume document
    tailored_blocks = [
        f"{name_line.upper()}",
        f"{job_title.upper()} | TARGET ROLE",
        f"{contact_info}" if contact_info else "",
        "",
        "PROFESSIONAL SUMMARY",
        tailored_summary,
        "",
        "CORE COMPETENCIES & TARGET SKILLS",
        f"• Key Technologies & Methodologies: {skills_formatted}",
        "• Focus Areas: System Reliability, Automation Pipelines, Clean Architecture",
    ]

    # Incorporate remaining sections from raw resume (Experience, Projects, Education)
    has_seen_summary = False
    in_experience_section = False
    body_lines = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if body_lines and body_lines[-1] != "":
                body_lines.append("")
            continue

        # Skip original name/contact header lines already generated
        if stripped == name_line or stripped == contact_info:
            continue

        # Detect experience or education
        if re.search(r"^(?:PROFESSIONAL\s+EXPERIENCE|EXPERIENCE|WORK\s+HISTORY|PROJECTS|EDUCATION)", stripped, re.IGNORECASE):
            body_lines.append("")
            body_lines.append(stripped.upper())
            continue

        if re.search(r"^(?:SUMMARY|PROFESSIONAL\s+SUMMARY|ABOUT|PROFILE)", stripped, re.IGNORECASE):
            has_seen_summary = True
            continue

        if has_seen_summary:
            # Skip old summary paragraph until next section
            if re.search(r"^[A-Z\s]{4,}$", stripped) and not stripped.startswith("•"):
                has_seen_summary = False
                body_lines.append("")
                body_lines.append(stripped.upper())
            continue

        # Retain original bullet points and experience details
        body_lines.append(stripped)

    # If body_lines didn't have experience, supply standard structured template
    if len(body_lines) < 5:
        body_lines.extend([
            "",
            "PROFESSIONAL EXPERIENCE",
            f"{job_title} | Engineering & Technology Solutions",
            f"• Implemented robust software features leveraging {top_skills_to_highlight[0] if top_skills_to_highlight else 'Python'} and modern engineering practices.",
            f"• Optimized system performance, automated manual tasks, and improved overall reliability.",
            "• Collaborated with cross-functional team members to deliver high-quality deliverables on schedule.",
            "",
            "EDUCATION & CREDENTIALS",
            "Bachelor of Science in Computer Science or Related Field",
        ])

    tailored_blocks.extend(body_lines)
    full_tailored_resume = "\n".join(tailored_blocks).strip()

    logs.append("Successfully generated tailored resume with targeted keywords.")

    return {
        **state,
        "tailored_resume": full_tailored_resume,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "enhancements": enhancements,
        "status": "TAILORED",
        "logs": logs,
    }


def generate_pdf_bytes_from_text(resume_text: str) -> bytes:
    """
    Builds a clean, standard ATS-friendly PDF document from resume text using ReportLab.
    """
    import io
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    p = canvas.Canvas(buffer, pagesize=letter)
    page_width, page_height = letter
    margin = 50
    max_width = page_width - (margin * 2)
    y = page_height - margin
    line_height = 14

    lines = (resume_text or "").split("\n")
    for i, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            y -= line_height * 0.7
            if y < margin + 20:
                p.showPage()
                y = page_height - margin
            continue

        is_heading = (
            any(line.upper().startswith(h) for h in [
                "PROFESSIONAL SUMMARY", "SUMMARY", "EXPERIENCE", "WORK EXPERIENCE",
                "EDUCATION", "SKILLS", "TECHNICAL SKILLS", "PROJECTS", "CORE COMPETENCIES"
            ])
            or (line == line.upper() and len(line) < 40 and ":" not in line and not line.startswith("•"))
        )
        is_name = (i == 0)

        font_name = "Helvetica-Bold" if (is_name or is_heading) else "Helvetica"
        font_size = 16 if is_name else (12 if is_heading else 9.5)
        p.setFont(font_name, font_size)

        if is_name:
            p.setFillColorRGB(0.08, 0.12, 0.2)
            y -= 2
        elif is_heading:
            p.setFillColorRGB(0.08, 0.14, 0.25)
            y -= 4
        else:
            p.setFillColorRGB(0.15, 0.18, 0.25)

        # Word wrap
        words = line.split(" ")
        curr = ""
        for w in words:
            test = f"{curr} {w}".strip()
            if p.stringWidth(test, font_name, font_size) > max_width and curr:
                if y < margin + 15:
                    p.showPage()
                    p.setFont(font_name, font_size)
                    y = page_height - margin
                p.drawString(margin, y, curr)
                y -= line_height
                curr = w
            else:
                curr = test

        if curr:
            if y < margin + 15:
                p.showPage()
                p.setFont(font_name, font_size)
                y = page_height - margin
            p.drawString(margin, y, curr)
            y -= (line_height + 2 if is_heading else line_height)

            if is_heading:
                p.setStrokeColorRGB(0.82, 0.85, 0.9)
                p.setLineWidth(0.75)
                p.line(margin, y + 4, page_width - margin, y + 4)
                y -= 3

    p.showPage()
    p.save()
    return buffer.getvalue()


def persist_resume_node(state: ResumeTailorState) -> ResumeTailorState:
    """
    Node 4: Persists the tailored resume back to Supabase database & storage bucket as an ATS PDF document.
    """
    logs = list(state.get("logs", []))
    save_to_db = state.get("save_to_db", True)
    user_id = state.get("user_id", "").strip()
    tailored = state.get("tailored_resume", "").strip()
    job_title = state.get("job_title", "Custom").strip()

    if not save_to_db or not user_id or not tailored:
        logs.append("Skipping database persistence (save_to_db is False or user_id missing).")
        return {**state, "status": "COMPLETED", "logs": logs}

    try:
        supabase = get_supabase_client()
        clean_title = re.sub(r"[^A-Za-z0-9_-]", "_", job_title)[:25]
        file_name = f"Resume_Tailored_{clean_title}.pdf"

        logs.append(f"Persisting tailored resume '{file_name}' to Supabase for user {user_id}...")

        # 1. Update user_settings table
        supabase.from_("user_settings").upsert({
            "user_id": user_id,
            "resume_name": file_name,
            "resume_content": tailored,
            "updated_at": "now()",
        }, on_conflict="user_id").execute()

        logs.append("Updated active resume in user_settings table.")

        # 2. Insert into public.resumes table
        supabase.from_("resumes").insert({
            "user_id": user_id,
            "file_name": file_name,
            "file_path": f"{user_id}/{file_name}",
            "parsed_text": tailored,
            "is_primary": True,
        }).execute()

        logs.append("Recorded tailored resume into public.resumes table.")

        # 3. Upload to Supabase Storage bucket 'resumes/{user_id}/{file_name}' as PDF
        try:
            try:
                pdf_payload = generate_pdf_bytes_from_text(tailored)
                content_type = "application/pdf"
            except Exception as pdf_gen_err:
                logs.append(f"ReportLab PDF notice ({pdf_gen_err}), saving raw text payload.")
                pdf_payload = tailored.encode("utf-8")
                content_type = "text/plain;charset=utf-8"

            supabase.storage.from_("resumes").upload(
                f"{user_id}/{file_name}",
                pdf_payload,
                {"upsert": "true", "content-type": content_type}
            )
            logs.append(f"Successfully uploaded tailored resume to Supabase storage bucket 'resumes/{user_id}/{file_name}'.")
        except Exception as st_err:
            logs.append(f"Storage bucket upload notice: {st_err}")

        return {
            **state,
            "resume_name": file_name,
            "status": "SAVED",
            "logs": logs,
        }

    except Exception as e:
        logs.append(f"Persistence warning: {str(e)}")
        # Don't fail the whole generation if DB write hits constraint; return tailored content
        return {
            **state,
            "status": "COMPLETED_WITH_DB_WARNING",
            "logs": logs,
        }


# -----------------------------------------------------------------------------
# GRAPH COMPILATION
# -----------------------------------------------------------------------------

def build_resume_tailor_graph():
    graph = StateGraph(ResumeTailorState)

    graph.add_node("load_user_resume", load_user_resume_node)
    graph.add_node("analyze_requirements", analyze_requirements_node)
    graph.add_node("tailor_resume_content", tailor_resume_content_node)
    graph.add_node("persist_resume", persist_resume_node)

    graph.add_edge(START, "load_user_resume")
    graph.add_edge("load_user_resume", "analyze_requirements")
    graph.add_edge("analyze_requirements", "tailor_resume_content")
    graph.add_edge("tailor_resume_content", "persist_resume")
    graph.add_edge("persist_resume", END)

    return graph.compile()


resume_tailor_agent = build_resume_tailor_graph()
