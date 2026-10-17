import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict

from resume_tailor_agent import extract_resume_from_bucket, get_supabase_client


SKILL_CATALOG = [
    "Python", "JavaScript", "TypeScript", "Java", "C#", "C++", "SQL", "HTML", "CSS",
    "React", "React Native", "Next.js", "Vue", "Angular", "Node.js", "Express",
    "FastAPI", "Django", "Flask", "LangGraph", "LangChain", "OpenAI", "LLMs",
    "Generative AI", "AI Agents", "Prompt Engineering", "Machine Learning", "NLP",
    "Data Science", "Pandas", "NumPy", "TensorFlow", "PyTorch", "n8n", "Zapier",
    "PostgreSQL", "Supabase", "MongoDB", "MySQL", "Redis", "Docker", "Kubernetes",
    "AWS", "Azure", "GCP", "Git", "GitHub", "REST APIs", "GraphQL", "CI/CD",
    "Agile", "Scrum", "Unit Testing", "Automation", "SEO", "Digital Marketing",
    "Communication", "Leadership", "Problem Solving", "Teamwork",
]


class AtsAgentState(TypedDict, total=False):
    user_id: str
    application_id: str
    job_title: str
    company_name: str
    requirements: str
    job_description: str
    raw_resume: str
    resume_name: str
    stage: str
    save_to_db: bool
    required_skills: List[str]
    resume_skills: List[str]
    matched_skills: List[str]
    missing_skills: List[str]
    score: int
    score_breakdown: Dict[str, int]
    suggestions: List[Dict[str, str]]
    summary: str
    analyzed_at: str
    status: str
    error: Optional[str]
    logs: List[str]


def _contains(text: str, term: str) -> bool:
    pattern = r"(^|[^a-z0-9])" + re.escape(term).replace(r"\ ", r"[\s/-]+") + r"([^a-z0-9]|$)"
    return bool(re.search(pattern, text, re.IGNORECASE))


def _clamp(value: float) -> int:
    return max(0, min(100, round(value)))


def load_resume_node(state: AtsAgentState) -> AtsAgentState:
    logs = list(state.get("logs", []))
    raw_resume = (state.get("raw_resume") or "").strip()
    user_id = (state.get("user_id") or "").strip()
    resume_name = (state.get("resume_name") or "").strip()

    if raw_resume:
        logs.append(f"Loaded provided resume text ({len(raw_resume)} characters).")
        return {**state, "raw_resume": raw_resume, "resume_name": resume_name or "Resume.txt", "status": "RESUME_LOADED", "logs": logs}

    if user_id:
        try:
            supabase = get_supabase_client()
            settings = (
                supabase.from_("user_settings")
                .select("resume_name, resume_content")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
            if settings.data and settings.data.get("resume_content"):
                raw_resume = settings.data["resume_content"]
                resume_name = settings.data.get("resume_name") or "Resume.txt"
            else:
                resume_name, raw_resume = extract_resume_from_bucket(user_id, supabase)
        except Exception as error:
            logs.append(f"Resume lookup warning: {error}")

    if not raw_resume:
        return {**state, "status": "FAILED", "error": "No resume content is available for ATS analysis.", "logs": logs}

    logs.append(f"Loaded resume '{resume_name}' for ATS analysis.")
    return {**state, "raw_resume": raw_resume, "resume_name": resume_name or "Resume.txt", "status": "RESUME_LOADED", "logs": logs}


def extract_signals_node(state: AtsAgentState) -> AtsAgentState:
    if state.get("status") == "FAILED":
        return state

    logs = list(state.get("logs", []))
    job_text = unicodedata.normalize(
        "NFKD",
        " ".join([
            state.get("job_title") or "",
            state.get("requirements") or "",
            state.get("job_description") or "",
        ]),
    )
    resume_text = unicodedata.normalize("NFKD", state.get("raw_resume") or "")
    required_skills = [skill for skill in SKILL_CATALOG if _contains(job_text, skill)]
    resume_skills = [skill for skill in SKILL_CATALOG if _contains(resume_text, skill)]
    matched_skills = [skill for skill in required_skills if _contains(resume_text, skill)]
    missing_skills = [skill for skill in required_skills if not _contains(resume_text, skill)]

    logs.append(f"ATS Agent found {len(matched_skills)} matched and {len(missing_skills)} missing job skills.")
    return {
        **state,
        "required_skills": required_skills,
        "resume_skills": resume_skills,
        "matched_skills": matched_skills,
        "missing_skills": missing_skills,
        "status": "SIGNALS_EXTRACTED",
        "logs": logs,
    }


def score_resume_node(state: AtsAgentState) -> AtsAgentState:
    if state.get("status") == "FAILED":
        return state

    raw_resume = state.get("raw_resume") or ""
    resume_lower = raw_resume.lower()
    job_text = " ".join([state.get("requirements") or "", state.get("job_description") or ""])
    required_skills = state.get("required_skills", [])
    matched_skills = state.get("matched_skills", [])
    resume_skills = state.get("resume_skills", [])

    skills_score = (len(matched_skills) / len(required_skills) * 100) if required_skills else min(82, 45 + len(resume_skills) * 4)
    title_terms = [term for term in re.split(r"[^a-z0-9+#.]+", (state.get("job_title") or "").lower()) if len(term) > 2]
    title_matches = [term for term in title_terms if term in resume_lower]
    title_score = (len(title_matches) / len(title_terms) * 100) if title_terms else 65

    experience_required = bool(re.search(r"(?:[2-9]|10)\+?\s*(?:years?|yrs?)", job_text, re.IGNORECASE))
    has_experience = bool(re.search(r"\b(experience|employment|work history|professional experience)\b", raw_resume, re.IGNORECASE))
    experience_score = 82 if has_experience and experience_required else 90 if has_experience else 38

    education_required = bool(re.search(r"\b(bachelor|master|degree|bsc|bs|msc|phd)\b", job_text, re.IGNORECASE))
    has_education = bool(re.search(r"\b(education|bachelor|master|degree|bsc|bs|msc|phd|university|college)\b", raw_resume, re.IGNORECASE))
    education_score = 100 if education_required and has_education else 30 if education_required else 92 if has_education else 75

    section_hits = sum(1 for section in ["summary", "skills", "experience", "education"] if section in resume_lower)
    has_contact = bool(re.search(r"@|linkedin|github|https?://|\+?\d[\d\s()-]{7,}", raw_resume, re.IGNORECASE))
    good_length = 900 <= len(raw_resume) <= 9000
    formatting_score = _clamp(30 + section_hits * 13 + (10 if has_contact else 0) + (8 if good_length else 0))

    breakdown = {
        "skills": _clamp(skills_score),
        "title": _clamp(title_score),
        "experience": _clamp(experience_score),
        "education": _clamp(education_score),
        "formatting": formatting_score,
    }
    overall = _clamp(
        breakdown["skills"] * 0.5
        + breakdown["title"] * 0.15
        + breakdown["experience"] * 0.15
        + breakdown["education"] * 0.1
        + breakdown["formatting"] * 0.1
    )

    return {**state, "score": overall, "score_breakdown": breakdown, "status": "SCORED"}


def recommend_improvements_node(state: AtsAgentState) -> AtsAgentState:
    if state.get("status") == "FAILED":
        return state

    score = state.get("score", 0)
    breakdown = state.get("score_breakdown", {})
    missing = state.get("missing_skills", [])
    suggestions: List[Dict[str, str]] = []

    if missing:
        suggestions.append({
            "priority": "high",
            "title": "Close the keyword gap",
            "detail": f"Add evidence for {', '.join(missing[:5])} only where those skills are genuinely part of your experience.",
            "action": "skills",
        })
    if breakdown.get("title", 0) < 70:
        suggestions.append({
            "priority": "high",
            "title": "Align the headline",
            "detail": f"Use '{state.get('job_title') or 'the target role'}' naturally in the headline or summary when accurate.",
            "action": "headline",
        })
    if breakdown.get("experience", 0) < 60:
        suggestions.append({
            "priority": "high",
            "title": "Add relevant experience evidence",
            "detail": "Show relevant roles or projects using concise bullets with tools, actions, and measurable outcomes.",
            "action": "experience",
        })
    if breakdown.get("formatting", 0) < 75:
        suggestions.append({
            "priority": "medium",
            "title": "Improve ATS structure",
            "detail": "Use standard Summary, Skills, Experience, Projects, and Education headings with simple bullets.",
            "action": "format",
        })
    suggestions.append({
        "priority": "medium",
        "title": "Quantify impact",
        "detail": "Strengthen relevant bullets with outcomes such as speed, revenue, reliability, users, or time saved.",
        "action": "impact",
    })

    summary = (
        "Strong match. Focus on proof, clarity, and final review before applying."
        if score >= 80
        else "Promising match with specific keyword and positioning gaps to close."
        if score >= 60
        else "The resume needs targeted restructuring before this application is competitive."
    )
    return {
        **state,
        "suggestions": suggestions,
        "summary": summary,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "status": "RECOMMENDED",
    }


def persist_report_node(state: AtsAgentState) -> AtsAgentState:
    if state.get("status") == "FAILED" or not state.get("save_to_db"):
        return state

    user_id = state.get("user_id") or ""
    application_id = state.get("application_id") or ""
    if not user_id or not application_id:
        return state

    report = {
        "stage": state.get("stage", "before"),
        "score": state.get("score", 0),
        "scoreBreakdown": state.get("score_breakdown", {}),
        "matchedSkills": state.get("matched_skills", []),
        "missingSkills": state.get("missing_skills", []),
        "resumeSkills": state.get("resume_skills", []),
        "suggestions": state.get("suggestions", []),
        "summary": state.get("summary", ""),
        "resumeName": state.get("resume_name", ""),
        "analyzedAt": state.get("analyzed_at"),
        "source": "langgraph-ats-agent",
    }
    is_after = state.get("stage") == "after"
    update_payload: Dict[str, Any] = {
        "ats_analyzed_at": state.get("analyzed_at"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if is_after:
        update_payload.update({
            "tailored_ats_score": state.get("score", 0),
            "tailored_ats_report": report,
            "tailored_resume_content": state.get("raw_resume", ""),
        })
    else:
        update_payload.update({
            "ats_score": state.get("score", 0),
            "ats_report": report,
            "resume_snapshot": state.get("raw_resume", ""),
        })

    logs = list(state.get("logs", []))
    try:
        supabase = get_supabase_client()
        supabase.from_("applications").update(update_payload).eq("id", application_id).eq("user_id", user_id).execute()
        supabase.from_("application_ats_reports").insert({
            "user_id": user_id,
            "application_id": application_id,
            "stage": state.get("stage", "before"),
            "score": state.get("score", 0),
            "score_breakdown": state.get("score_breakdown", {}),
            "matched_skills": state.get("matched_skills", []),
            "missing_skills": state.get("missing_skills", []),
            "suggestions": state.get("suggestions", []),
            "summary": state.get("summary", ""),
            "resume_name": state.get("resume_name", ""),
            "resume_snapshot": state.get("raw_resume", ""),
            "source": "langgraph-ats-agent",
        }).execute()
        logs.append("Persisted ATS report to the application history.")
    except Exception as error:
        logs.append(f"ATS persistence warning: {error}")

    return {**state, "status": "COMPLETED", "logs": logs}


def build_ats_agent():
    graph = StateGraph(AtsAgentState)
    graph.add_node("load_resume", load_resume_node)
    graph.add_node("extract_signals", extract_signals_node)
    graph.add_node("score_resume", score_resume_node)
    graph.add_node("recommend_improvements", recommend_improvements_node)
    graph.add_node("persist_report", persist_report_node)
    graph.add_edge(START, "load_resume")
    graph.add_edge("load_resume", "extract_signals")
    graph.add_edge("extract_signals", "score_resume")
    graph.add_edge("score_resume", "recommend_improvements")
    graph.add_edge("recommend_improvements", "persist_report")
    graph.add_edge("persist_report", END)
    return graph.compile()


ats_agent = build_ats_agent()
