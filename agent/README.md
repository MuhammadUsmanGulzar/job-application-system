# LangGraph Job Application Agents

This service uses **LangGraph** StateGraphs for job parsing, ATS scoring, evidence-based resume optimization, and application email delivery.

---

## ATS workflow

```
[START]
   │
   ▼
[load_resume]
   ▼
[extract_signals]
   ▼
[score_resume]
   ▼
[recommend_improvements]
   ▼
[persist_report]
   │
   ▼
 [END]
```

---

## 1. Installation

```bash
cd agent
pip install -r requirements.txt
```

---

## 2. Configuration (`.env`)

Copy `.env.example` to `.env`:

```env
SUPABASE_URL=https://msyzzsoiuzwwsksfvddj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

---

## 3. Running the Agent

### Option A: Run as a Microservice / API
```bash
python server.py --serve --port 8000
```

Trigger via HTTP POST:
```bash
curl -X POST http://localhost:8000/api/agent/analyze-ats \
     -H "Content-Type: application/json" \
     -d '{"job_title":"Backend Engineer","requirements":"Python, FastAPI, PostgreSQL","raw_resume":"...","stage":"before"}'

curl -X POST http://localhost:8000/api/agent/send-email \
     -H "Content-Type: application/json" \
     -d '{"application_id": "<APPLICATION_UUID>", "user_id": "<USER_UUID>"}'
```

### Option B: Run Directly from Command Line
```bash
python server.py --app-id <APPLICATION_UUID> --user-id <USER_UUID>
```
