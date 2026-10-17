import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  ActivityIndicator,
  Modal,
  useWindowDimensions
} from 'react-native';
import RenderHtml from 'react-native-render-html';
import { supabase } from './supabase';
import { 
  getSettings, 
  saveSettings, 
  getApplications, 
  saveApplication, 
  deleteApplication, 
  uploadResumeFile,
  getProfile,
  saveProfile,
  defaultProfile,
  fetchLatestApplicationEmail,
  createApplication,
  updateApplicationGeneratedEmail,
  updateApplicationStatus,
  updateFullApplication,
  htmlToPlainText,
  subscribeToApplications,
  mapApplicationRow,
  fetchUserResume,
  updateResumeContent,
  tailorResumeForJob,
  syncResumeFromBucket,
  getResumeFileUrl
} from './services/storage';
import { LLM_PROVIDERS_CONFIG, performLlmJobParse, performLlmEmailGeneration } from './services/ai';
import { sendEmail } from './services/email';
import {
  initSession,
  clearSessionTimestamps,
  checkSessionStatus,
  setupSessionTracking,
} from './services/sessionManager';
import CustomAlertModal from './components/CustomAlertModal';
import AtsDashboard from './components/AtsDashboard';
import { analyzeResumeForJob } from './services/ats';

export const getStatusBadgeStyle = (status) => {
  switch (status) {
    case 'Applied': return { backgroundColor: '#dcfce7', color: '#166534', border: '#86efac' };
    case 'Interviewing': return { backgroundColor: '#ede9fe', color: '#6b21a8', border: '#c4b5fd' };
    case 'Accepted': return { backgroundColor: '#ccfbf1', color: '#115e59', border: '#5eead4' };
    case 'Rejected': return { backgroundColor: '#fee2e2', color: '#991b1b', border: '#fca5a5' };
    case 'Generating': return { backgroundColor: '#fef3c7', color: '#92400e', border: '#fde68a' };
    case 'Generated': return { backgroundColor: '#dbeafe', color: '#1e40af', border: '#bfdbfe' };
    default: return { backgroundColor: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
  }
};

export const SAMPLE_HIRING_POST = `[Techies Global](https://www.linkedin.com/company/techies-global/) Lahore is looking for 𝗔𝗜 𝗘𝘅𝗽𝗲𝗿𝘁 (𝗣𝗮𝗿𝘁 𝘁𝗶𝗺𝗲 𝗡𝗶𝗴𝗵𝘁 𝗦𝗵𝗶𝗳𝘁 𝟭 𝗮𝗺 𝘁𝗼 𝟱 𝗮𝗺) On-Site𝗞𝗲𝘆 𝗥𝗲𝘀𝗽𝗼𝗻𝘀𝗶𝗯𝗶𝗹𝗶𝘁𝗶𝗲𝘀 • Research and evaluate emerging AI tools, platforms, and technologies relevant to digital marketing. • Implement AI-powered workflows to improve productivity and reduce repetitive manual tasks. • Develop and optimize prompts for ChatGPT, Claude, Gemini, and other generative AI platforms. • Use AI for content generation, content optimization, research, ideation, and quality improvement. • Assist the marketing team with AI-driven SEO, keyword research, competitor analysis, and content strategies. • Develop AI-based automation workflows using tools such as Make, Zapier, n8n, or similar platforms. • Identify opportunities to automate internal agency processes and client deliverables. • Experiment with AI agents, custom GPTs, chatbots, and AI assistants. • Integrate AI tools with existing marketing and business workflows where appropriate. • Monitor AI-generated content for accuracy, originality, brand alignment, and quality. • Stay updated with the latest developments in generative AI, LLMs, AI automation, and marketing technology. • Train and guide team members on effective use of AI tools. • Maintain documentation of AI workflows, prompts, automations, and best practices. • Support management in identifying new AI-powered services that can be offered to clients.𝗥𝗲𝗾𝘂𝗶𝗿𝗲𝗱 𝗦𝗸𝗶𝗹𝗹𝘀 & 𝗤𝘂𝗮𝗹𝗶𝗳𝗶𝗰𝗮𝘁𝗶𝗼𝗻𝘀Bachelor's degree in Computer Science, Artificial Intelligence, Software Engineering, IT, Marketing Technology, or a related field is preferred.𝗔𝗽𝗽𝗹𝘆 𝗮𝘁: 𝗺𝗮𝗻𝗮𝗴𝗶𝗻𝗴𝗱𝗶𝗿𝗲𝗰𝘁𝗼𝗿@𝘁𝗲𝗰𝗵𝗶𝗲𝘀𝗴𝗹𝗼𝗯𝗮𝗹.𝗰𝗼𝗺𝗪𝗵𝗮𝘁𝘀𝗮𝗽𝗽: 𝟬𝟯𝟬𝟴 𝟰𝟬𝟭𝟵𝟬𝟱𝟳𝗟𝗼𝗰𝗮𝘁𝗶𝗼𝗻: Wapda Town Phase 1 Lahore.`;

export const isValidCompanyName = (name) => {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 35) return false;
  const blacklist = [
    'ai integration', 'hiring company', 'on-site', 'remote', 'hybrid', 'location', 
    'our client', 'the moment', 'least', 'first', 'our team', 'the team', 'and', 'with', 
    'grow your career', 'career', 'python', 'we', 'us', 'who', 'fast-growing'
  ];
  if (blacklist.some(b => trimmed.toLowerCase().includes(b))) return false;
  if (/^(?:and|or|the|a|an|in|on|at|to|for|with|by|our)\b/i.test(trimmed)) return false;
  return true;
};

export const parseRawHiringPost = (raw) => {
  if (!raw || !raw.trim()) {
    return null;
  }

  // 1. Normalize unicode characters (NFKD converts mathematical bold/sans chars into standard ASCII)
  let text = raw.normalize('NFKD');
  text = text.replace(/•/g, '\n• ').replace(/·/g, '\n· ');

  // 2. Recipient Email extraction
  const emailMatch = text.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?:com|org|net|co\.uk|co|io|pk|edu|gov|tech|ai|dev|global)/i
  );
  const recipientEmail = emailMatch ? emailMatch[0].trim() : '';

  // 3. Company Name extraction
  let companyName = '';
  // Markdown link: [Company](url)
  const mdMatch = text.match(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/);
  if (mdMatch && isValidCompanyName(mdMatch[1])) {
    companyName = mdMatch[1].trim();
  }

  // "Company is hiring / looking for" (e.g. "Neuralige is looking for...")
  if (!companyName) {
    const isHiringMatch = text.match(/([A-Z][A-Za-z0-9&.\s]{1,30})\s+(?:is\s+(?:hiring|looking for|seeking))/i);
    if (isHiringMatch && isValidCompanyName(isHiringMatch[1])) {
      companyName = isHiringMatch[1].trim();
    }
  }

  // "Join Company", "welcome to Company"
  if (!companyName) {
    const joinMatch = text.match(/(?:join|joining|welcome to)\s+([A-Z][A-Za-z0-9&.\s]{2,25})/i);
    if (joinMatch && isValidCompanyName(joinMatch[1])) {
      companyName = joinMatch[1].trim();
    }
  }

  // "at Company", "company: Company"
  if (!companyName) {
    const atMatch = text.match(/(?:at|company:?|organization:?)\s+([A-Z][A-Za-z0-9&.\s]{2,25})/);
    if (atMatch && isValidCompanyName(atMatch[1])) {
      companyName = atMatch[1].trim();
    }
  }

  // Fallback: Check recipient email domain (e.g. hr@neuralige.com -> Neuralige)
  if ((!companyName || companyName === 'Hiring Company') && recipientEmail) {
    const emailParts = recipientEmail.split('@');
    if (emailParts.length === 2) {
      const domain = emailParts[1].toLowerCase().trim();
      const domainName = domain.split('.')[0];
      const genericDomains = ['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud', 'proton', 'mail'];
      if (domainName && !genericDomains.includes(domainName)) {
        companyName = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      }
    }
  }

  // 4. Job Title extraction
  let jobTitle = '';
  // Check explicit hiring headline first: e.g. "We’re Hiring: Associate Software Engineer (Python & AI)"
  const hiringHeaderMatch = text.match(/(?:we['’]?re\s+hiring|hiring|opening|job\s+opportunity)[:\s]+([^\n\r.]+)/i);
  if (hiringHeaderMatch) {
    jobTitle = hiringHeaderMatch[1].trim();
  }

  if (!jobTitle) {
    const titleMatch = text.match(
      /(?:looking for|hiring(?:\s+for)?|position(?:\s+of)?|role(?:\s+of)?|opening for)\s+([A-Za-z0-9\s()\/,+-]+?)(?=(?:\s+On-Site|\s+Remote|\s+Hybrid|\s+Location|Key Responsibilities|Responsibilities|Requirements|\.|\n|$))/i
    );
    if (titleMatch) {
      jobTitle = titleMatch[1].trim();
    }
  }

  const knownRoleMatch = text.match(
    /\b(?:Senior|Junior|Lead|Associate|Staff|Principal)?\s*(?:Software Engineer|Software Developer|Full[- ]?Stack Developer|Frontend Developer|Backend Developer|Python Developer|AI Engineer|AI Expert|Machine Learning Engineer|Data Scientist|Data Analyst|DevOps Engineer|QA Engineer|Mobile Developer|React Developer|Node\.js Developer)\b/i
  );

  if (jobTitle) {
    // Cut off qualification clauses like 'with a strong foundation...', 'who...', 'having...'
    jobTitle = jobTitle.split(/\s+(?:with|who|having|to join|responsible for|seeking)\b/i)[0].trim();
    // Strip leading filler adjectives like 'an enthusiastic', 'a skilled', etc.
    jobTitle = jobTitle.replace(/^(?:an?|the)\s+(?:enthusiastic|motivated|passionate|experienced|talented|skilled|dynamic|exceptional|energetic|dedicated|driven|seasoned)?\s*/i, '').trim();
    // Strip trailing punctuation
    jobTitle = jobTitle.replace(/[,;:-]+$/, '').trim();
  }

  if ((!jobTitle || jobTitle.length > 50) && knownRoleMatch) {
    jobTitle = knownRoleMatch[0].trim();
  } else if (knownRoleMatch && jobTitle.toLowerCase().includes(knownRoleMatch[0].toLowerCase())) {
    if (jobTitle.length > knownRoleMatch[0].length + 35) {
      jobTitle = knownRoleMatch[0].trim();
    }
  }

  if (!jobTitle) {
    const firstLine = text.split('\n')[0];
    jobTitle = firstLine.substring(0, 50).trim();
  }

  // 5. Requirements extraction
  let requirements = '';
  const reqMatch = text.match(
    /(?:Key Responsibilities|Responsibilities|Required Skills|Requirements)[:\s]*([\s\S]*?)(?=(?:Apply at|Location|Whatsapp|Salary|How to Apply|$))/i
  );
  if (reqMatch) {
    requirements = reqMatch[1].trim();
  } else {
    requirements = text.slice(0, 500);
  }

  return {
    jobTitle: jobTitle || 'Software Engineer',
    companyName: companyName || 'Hiring Company',
    recipientEmail: recipientEmail || '',
    requirements: requirements.trim(),
    description: text.trim(),
  };
};

export default function AppWeb() {
  const { width } = useWindowDimensions();
  const isCompact = width < 980;
  const isMobile = width < 640;

  // Custom Alert & Popup State
  const [alertConfig, setAlertConfig] = useState({
    visible: false,
    title: '',
    message: '',
    type: 'info',
    confirmText: '',
    cancelText: 'Cancel',
    onConfirm: null,
    onCancel: null,
  });

  const showAlert = React.useCallback((message, title = 'Notice', type = 'info') => {
    setAlertConfig({
      visible: true,
      title,
      message,
      type,
      confirmText: 'Got it',
      cancelText: 'Cancel',
      onConfirm: () => setAlertConfig(prev => ({ ...prev, visible: false })),
      onCancel: null,
    });
  }, []);

  const showSuccess = React.useCallback((message, title = 'Success') => {
    showAlert(message, title, 'success');
  }, [showAlert]);

  const showError = React.useCallback((message, title = 'Notice') => {
    showAlert(message, title, 'error');
  }, [showAlert]);

  const showConfirm = React.useCallback(({ title = 'Are you sure?', message, confirmText = 'Confirm', onConfirm }) => {
    setAlertConfig({
      visible: true,
      title,
      message,
      type: 'confirm',
      confirmText,
      cancelText: 'Cancel',
      onConfirm: () => {
        setAlertConfig(prev => ({ ...prev, visible: false }));
        if (onConfirm) onConfirm();
      },
      onCancel: () => setAlertConfig(prev => ({ ...prev, visible: false })),
    });
  }, []);

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');

  // Active navigation tab: 'apply' | 'history' | 'profile' | 'settings'
  const [activeTab, setActiveTab] = useState('apply');

  // Candidate Profile State
  const [profile, setProfile] = useState(defaultProfile);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState('');

  // User Settings & Integrations
  const [settings, setSettings] = useState({
    llmProvider: 'OpenAI',
    llmApiKey: '',
    llmModel: 'gpt-4o-mini',
    googleSenderEmail: '',
    googleClientId: '',
    googleClientSecret: '',
    resumeName: '',
    resumeContent: '',
  });
  const [isSavingResume, setIsSavingResume] = useState(false);
  const [isSavingLlm, setIsSavingLlm] = useState(false);
  const [isSavingGoogle, setIsSavingGoogle] = useState(false);
  const [showLlmApiKey, setShowLlmApiKey] = useState(false);

  const [resumeFeedback, setResumeFeedback] = useState('');
  const [llmFeedback, setLlmFeedback] = useState('');
  const [googleFeedback, setGoogleFeedback] = useState('');

  const [showGmailGuide, setShowGmailGuide] = useState(true);
  const [guideMethod, setGuideMethod] = useState('appPassword');

  // Raw Job Post AI Parser Agent State
  const [rawJobPost, setRawJobPost] = useState('');
  const [isParsingRawPost, setIsParsingRawPost] = useState(false);
  const [parsedSummary, setParsedSummary] = useState(null);
  const [rawPostMessage, setRawPostMessage] = useState('');

  // Job Application Form State
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [requirements, setRequirements] = useState('');
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showCountdownPopup, setShowCountdownPopup] = useState(false);
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const [generatedResult, setGeneratedResult] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [isAnalyzingAts, setIsAnalyzingAts] = useState(false);
  const [atsReport, setAtsReport] = useState(null);
  const [atsBaselineReport, setAtsBaselineReport] = useState(null);
  const [atsApplicationId, setAtsApplicationId] = useState('');
  const pollIntervalRef = useRef(null);

  // Resume Viewer & AI Tailor Agent State
  const [isTailoringResume, setIsTailoringResume] = useState(false);
  const [resumeTailorResult, setResumeTailorResult] = useState(null);
  const [resumeViewMode, setResumeViewMode] = useState('pdf'); // 'pdf' | 'preview' | 'edit'
  const [resumeEditText, setResumeEditText] = useState('');
  const [resumePdfUrl, setResumePdfUrl] = useState('');
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [isSavingResumeText, setIsSavingResumeText] = useState(false);
  const [isSyncingBucket, setIsSyncingBucket] = useState(false);

  // Application-Specific Picked Resume State
  const [pickedResumeSource, setPickedResumeSource] = useState('master'); // 'master' | 'tailored'
  const [tailoredResumeName, setTailoredResumeName] = useState('');
  const [tailoredResumeContent, setTailoredResumeContent] = useState('');
  const [tailoredResumeBucketPath, setTailoredResumeBucketPath] = useState('');
  const [showPickedResumePreviewModal, setShowPickedResumePreviewModal] = useState(false);

  const getPickedResume = () => {
    if (pickedResumeSource === 'tailored' && tailoredResumeContent) {
      return {
        source: 'tailored',
        name: tailoredResumeName || 'Resume_Tailored_ATS.pdf',
        content: tailoredResumeContent,
        bucketPath: tailoredResumeBucketPath || (session?.user?.id ? `resumes/${session.user.id}/${tailoredResumeName || 'Resume_Tailored_ATS.pdf'}` : `resumes/${tailoredResumeName || 'Resume_Tailored_ATS.pdf'}`),
        isAtsOptimized: true,
      };
    }
    const masterName = settings.resumeName || 'Master Resume.txt';
    return {
      source: 'master',
      name: masterName,
      content: settings.resumeContent || '',
      bucketPath: session?.user?.id ? `resumes/${session.user.id}/${masterName}` : `resumes/${masterName}`,
      isAtsOptimized: false,
    };
  };

  useEffect(() => {
    if (settings?.resumeContent) {
      setResumeEditText(settings.resumeContent);
    }
  }, [settings?.resumeContent]);

  // Load PDF signed URL whenever session or resumeName changes
  const loadResumePdfUrl = async (customName = '') => {
    if (!session?.user?.id) return;
    setIsLoadingPdf(true);
    try {
      const info = await getResumeFileUrl(session.user.id, customName || settings.resumeName);
      if (info && info.url) {
        setResumePdfUrl(info.url);
      }
    } catch (_e) {
    } finally {
      setIsLoadingPdf(false);
    }
  };

  useEffect(() => {
    if (session?.user?.id) {
      loadResumePdfUrl(settings.resumeName);
    }
  }, [session?.user?.id, settings.resumeName, activeTab]);

  // Auto-sync resume from storage bucket if user has no resume text loaded
  useEffect(() => {
    if (activeTab === 'resume' && session?.user?.id && (!settings?.resumeContent || !resumePdfUrl) && !isSyncingBucket) {
      handleSyncResumeFromBucket();
    }
  }, [activeTab, session?.user?.id]);

  const clearApplicationForm = () => {
    setJobTitle('');
    setCompanyName('');
    setRecipientEmail('');
    setRequirements('');
    setDescription('');
    setParsedSummary(null);
    setRawPostMessage('');
    setAtsReport(null);
    setAtsBaselineReport(null);
    setAtsApplicationId('');
    setTailoredResumeName('');
    setTailoredResumeContent('');
    setTailoredResumeBucketPath('');
    setPickedResumeSource('master');
    setResumeTailorResult(null);
  };

  const handleLoadSamplePost = () => {
    setRawJobPost(SAMPLE_HIRING_POST);
    setRawPostMessage('Loaded sample Techies Global job posting.');
    setParsedSummary(null);
  };

  const handleClearRawPost = () => {
    setRawJobPost('');
    setParsedSummary(null);
    setRawPostMessage('');
  };

  const handleParseAndPopulate = async (andSubmit = false) => {
    if (!rawJobPost.trim()) {
      showError('Please paste a raw job posting first.', 'Input Required');
      return;
    }

    setIsParsingRawPost(true);
    setRawPostMessage('');

    let extracted = null;

    // 1. Direct LLM Job Parsing Agent using user's LLM API if key is present
    if (settings.llmApiKey && settings.llmApiKey.trim().length > 5) {
      try {
        const aiParsed = await performLlmJobParse({
          rawText: rawJobPost,
          provider: settings.llmProvider,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
        });
        if (aiParsed && aiParsed.jobTitle) {
          extracted = aiParsed;
        }
      } catch (parseErr) {
        console.warn('Direct LLM job parsing notice:', parseErr.message);
      }
    }

    // 2. Attempt LangGraph Python server endpoint if active locally
    if (!extracted) {
      try {
        const resp = await fetch('http://localhost:8000/api/agent/parse-job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            raw_text: rawJobPost,
            user_id: '',
            send_webhook: false,
            save_to_db: false,
            llm_provider: settings.llmProvider,
            llm_api_key: settings.llmApiKey,
            llm_model: settings.llmModel,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          extracted = {
            jobTitle: data.job_title || '',
            companyName: data.company_name || '',
            recipientEmail: data.recipient_email || '',
            requirements: data.requirements || '',
            description: data.description || rawJobPost,
          };
        }
      } catch (_agentErr) {
        // Local agent offline
      }
    }

    // 3. Client-side pattern parsing logic fallback
    if (!extracted) {
      extracted = parseRawHiringPost(rawJobPost);
    }

    if (extracted) {
      setJobTitle(extracted.jobTitle);
      setCompanyName(extracted.companyName);
      setRecipientEmail(extracted.recipientEmail);
      setRequirements(extracted.requirements);
      setDescription(extracted.description);
      setParsedSummary(extracted);
      setRawPostMessage(`Extracted: ${extracted.jobTitle} at ${extracted.companyName} (${extracted.recipientEmail || 'No email'})`);

      if (andSubmit) {
        setIsParsingRawPost(false);
        if (isGenerating) {
          setShowCountdownPopup(true);
          return;
        }
        await handleAnalyzeResumeMatch(extracted);
        return;
      }
    }

    setIsParsingRawPost(false);
  };

  // Stopwatch timer for n8n AI email generation
  useEffect(() => {
    let interval = null;
    if (isGenerating) {
      interval = setInterval(() => {
        setGenerationSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating]);

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const formatTime = (totalSecs) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Applications History State (Synced with Supabase DB)
  const [applications, setApplications] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [isEditingApplication, setIsEditingApplication] = useState(false);
  const [editForm, setEditForm] = useState({
    jobTitle: '',
    companyName: '',
    recipientEmail: '',
    generatedEmail: '',
  });
  const [isSavingEdits, setIsSavingEdits] = useState(false);
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState(null);



  useEffect(() => {
    if (selectedRecord) {
      setEditForm({
        jobTitle: selectedRecord.jobTitle || '',
        companyName: selectedRecord.companyName || '',
        recipientEmail: selectedRecord.recipientEmail || '',
        generatedEmail: htmlToPlainText(selectedRecord.generatedEmail),
      });
    } else {
      setIsEditingApplication(false);
    }
  }, [selectedRecord?.id, selectedRecord?.generatedEmail]);

  const loadUserData = React.useCallback(async (userId, userEmail) => {
    const userSettings = await getSettings(userId);
    setSettings(userSettings);
    const userProfile = await getProfile(userId, userEmail);
    setProfile(userProfile);
    const userApps = await getApplications(userId);
    setApplications(userApps);
    setLastSyncedTime(new Date());
  }, []);

  const handleSignOut = async () => {
    await clearSessionTimestamps();
    await supabase.auth.signOut();
    setSession(null);
    setIsAuthenticated(false);
  };

  // Auth session listener with session timeout enforcement (4h inactivity + 7d max limit)
  useEffect(() => {
    let isSubscribed = true;

    const handleSession = async (currentSession) => {
      if (!currentSession) {
        if (isSubscribed) {
          setSession(null);
          setIsAuthenticated(false);
        }
        await clearSessionTimestamps();
        return;
      }

      // Check if session has exceeded 4 hours inactivity or 7 days limit
      const status = await checkSessionStatus();
      if (status.expired) {
        console.warn('Session expired:', status.reason);
        await clearSessionTimestamps();
        await supabase.auth.signOut();
        if (isSubscribed) {
          setSession(null);
          setIsAuthenticated(false);
          setAuthError(status.reason);
        }
        return;
      }

      // Valid session: initialize/touch timestamps
      await initSession(currentSession.user?.id);
      if (isSubscribed) {
        setSession(currentSession);
        setIsAuthenticated(true);
        if (currentSession.user?.id) {
          loadUserData(currentSession.user.id, currentSession.user.email);
        }
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    return () => {
      isSubscribed = false;
      subscription.unsubscribe();
    };
  }, [loadUserData]);

  // Active session tracking (listens to mouse, keys, clicks, and visibility change)
  useEffect(() => {
    if (!isAuthenticated) return;

    const cleanup = setupSessionTracking((reason) => {
      setSession(null);
      setIsAuthenticated(false);
      setAuthError(reason || 'Your session has expired. Please sign in again.');
      showError(reason || 'Your session has expired. Please sign in again.', 'Session Expired');
    });

    return cleanup;
  }, [isAuthenticated]);

  // Realtime Supabase DB Listener: automatically syncs applications & status changes
  useEffect(() => {
    let channel = null;
    if (session?.user?.id) {
      channel = subscribeToApplications(session.user.id, (_payload) => {
        getApplications(session.user.id).then((freshApps) => {
          setApplications(freshApps);
          setLastSyncedTime(new Date());
          setSelectedRecord((prev) => {
            if (!prev) return null;
            const updated = freshApps.find(a => a.id === prev.id);
            return updated ? { ...prev, ...updated, generatedEmail: updated.generatedEmail || prev.generatedEmail } : prev;
          });
        });

        if (_payload?.new && _payload.new.id) {
          const mapped = mapApplicationRow(_payload.new);
          setSelectedRecord((prev) => (prev && prev.id === mapped.id ? { ...prev, ...mapped, generatedEmail: mapped.generatedEmail || prev.generatedEmail } : prev));
          setGeneratedResult((prev) => (prev && prev.id === mapped.id ? { ...prev, ...mapped, generatedEmail: mapped.generatedEmail || prev.generatedEmail } : prev));
        }
      });
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [session?.user?.id]);

  const handleSyncHistory = async () => {
    if (!session?.user?.id) return;
    setIsSyncingHistory(true);
    try {
      const freshApps = await getApplications(session.user.id);
      setApplications(freshApps);
      setLastSyncedTime(new Date());
    } catch (err) {
      console.warn('Manual sync notice:', err);
    } finally {
      setIsSyncingHistory(false);
    }
  };

  const handleStatusChange = async (appId, newStatus) => {
    if (!session?.user?.id || !appId) return;
    try {
      const updatedList = await updateApplicationStatus(session.user.id, appId, newStatus);
      if (updatedList) setApplications(updatedList);
      if (selectedRecord?.id === appId) {
        setSelectedRecord((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
      if (generatedResult?.id === appId) {
        setGeneratedResult((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
    } catch (err) {
      console.warn('Status change notice:', err);
    }
  };

  // Handle OAuth redirect from URL parameters
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('gmail_success')) {
        setGoogleFeedback('Successfully connected to Gmail!');
        window.history.replaceState({}, document.title, window.location.pathname);
        if (session?.user?.id) {
          getSettings(session.user.id).then(setSettings);
        }
      } else if (params.get('gmail_error')) {
        setGoogleFeedback(`Gmail connection failed: ${params.get('gmail_error')}`);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, [session]);

  const handleConnectGmail = async () => {
    setGoogleFeedback('Opening Google authentication...');
    try {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://msyzzsoiuzwwsksfvddj.supabase.co';
      const response = await fetch(`${supabaseUrl}/functions/v1/gmail-oauth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSession.access_token}`
        },
        body: JSON.stringify({ action: 'start' })
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setGoogleFeedback(`Error: ${data.error || 'Failed to start OAuth'}`);
      }
    } catch (err) {
      setGoogleFeedback('Network error starting OAuth: ' + err.message);
    }
  };

  const handleDisconnectGmail = async () => {
    setGoogleFeedback('Disconnecting...');
    try {
      const { error } = await supabase
        .from('user_settings')
        .update({ google_refresh_token: null, google_connected_at: null })
        .eq('user_id', session.user.id);
      if (error) throw error;
      setSettings(prev => ({ ...prev, googleConnectedAt: null }));
      setGoogleFeedback('Disconnected successfully.');
    } catch (err) {
      setGoogleFeedback('Error disconnecting');
    }
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    setProfileFeedback('');
    try {
      await saveProfile(session?.user?.id, profile);
      setProfileFeedback('✓ Profile details saved successfully!');
      setTimeout(() => setProfileFeedback(''), 3500);
    } catch (err) {
      setProfileFeedback('Failed to save profile: ' + err.message);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSaveSection = async (section) => {
    if (section === 'resume') setIsSavingResume(true);
    if (section === 'llm') setIsSavingLlm(true);
    if (section === 'google') setIsSavingGoogle(true);

    const success = await saveSettings(session?.user?.id, settings);

    if (section === 'resume') {
      setIsSavingResume(false);
      setResumeFeedback(success ? '✓ Resume saved successfully!' : 'Failed to save');
      setTimeout(() => setResumeFeedback(''), 3000);
    }
    if (section === 'llm') {
      setIsSavingLlm(false);
      setLlmFeedback(success ? '✓ AI model preferences saved!' : 'Failed to save');
      setTimeout(() => setLlmFeedback(''), 3000);
    }
    if (section === 'google') {
      setIsSavingGoogle(false);
      setGoogleFeedback(success ? '✓ Gmail credentials saved!' : 'Failed to save');
      setTimeout(() => setGoogleFeedback(''), 3000);
    }
  };

  // Resume Upload (Web File Picker & Supabase Storage Bucket)
  const handleUploadResumeWeb = () => {
    if (typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.txt,.pdf,.doc,.docx,.md';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async (event) => {
            const content = event.target.result;
            const updated = {
              ...settings,
              resumeName: file.name,
              resumeContent: typeof content === 'string' ? content : `[Uploaded file: ${file.name}]`,
            };
            setSettings(updated);

            // Upload directly to user's isolated folder in Supabase Storage bucket
            if (session?.user?.id) {
              try {
                await uploadResumeFile(session.user.id, file, file.name);
                await saveSettings(session.user.id, updated);
                setResumeFeedback(`Uploaded to cloud bucket: ${file.name}`);
              } catch (storageErr) {
                console.log('Bucket upload note:', storageErr.message);
                await saveSettings(session.user.id, updated);
                setResumeFeedback(`Saved resume: ${file.name}`);
              }
            } else {
              setResumeFeedback(`Uploaded resume: ${file.name}`);
            }
            setTimeout(() => setResumeFeedback(''), 3000);
          };
          reader.readAsText(file);
        }
      };
      input.click();
    }
  };

  const handleAnalyzeResumeMatch = async (overrideFields = null, options = {}) => {
    if (isAnalyzingAts) return null;

    const targetTitle = (overrideFields?.jobTitle || jobTitle || '').trim();
    const targetCompany = (overrideFields?.companyName || companyName || '').trim();
    const targetEmail = (overrideFields?.recipientEmail || recipientEmail || '').trim();
    const targetRequirements = (overrideFields?.requirements || requirements || '').trim();
    const targetDescription = (overrideFields?.description || description || '').trim();
    const picked = getPickedResume();
    const resumeContent = options.resumeContent ?? picked.content ?? '';
    const resumeName = options.resumeName ?? picked.name ?? 'Resume.txt';
    const stage = options.stage || 'before';

    if (!targetTitle || (!targetRequirements && !targetDescription)) {
      showError('Add a job title and requirements or description before running ATS analysis.', 'Job Details Needed');
      return null;
    }
    if (!resumeContent.trim()) {
      showError('Upload or add your resume content before running ATS analysis.', 'Resume Needed');
      return null;
    }

    let userId = session?.user?.id;
    if (!userId) {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      userId = freshSession?.user?.id;
    }

    setIsAnalyzingAts(true);
    try {
      let applicationId = options.applicationId || atsApplicationId;
      if (!applicationId) {
        const created = await createApplication(userId, {
          jobTitle: targetTitle,
          companyName: targetCompany,
          recipientEmail: targetEmail,
          requirements: targetRequirements,
          description: targetDescription,
          status: 'Draft',
        });
        applicationId = created.id;
        setAtsApplicationId(applicationId);
        if (created.application) {
          setApplications((current) => [created.application, ...current.filter((item) => item.id !== applicationId)]);
        }
      }

      const report = await analyzeResumeForJob({
        userId,
        applicationId,
        jobTitle: targetTitle,
        companyName: targetCompany,
        requirements: targetRequirements,
        description: targetDescription,
        resumeContent,
        resumeName,
        stage,
        llmProvider: settings.llmProvider,
        llmApiKey: settings.llmApiKey,
        llmModel: settings.llmModel,
      });

      setAtsReport(report);
      if (stage === 'before') setAtsBaselineReport(report);
      setApplications((current) => current.map((item) => item.id === applicationId
        ? {
            ...item,
            atsScore: stage === 'before' ? report.score : item.atsScore,
            atsReport: stage === 'before' ? report : item.atsReport,
            tailoredAtsScore: stage === 'after' ? report.score : item.tailoredAtsScore,
            tailoredAtsReport: stage === 'after' ? report : item.tailoredAtsReport,
          }
        : item));
      return { report, applicationId };
    } catch (error) {
      showError(`ATS analysis failed: ${error.message}`, 'Analysis Error');
      return null;
    } finally {
      setIsAnalyzingAts(false);
    }
  };

  const handleAgentOptimizeResume = async () => {
    if (isTailoringResume || isAnalyzingAts) return;
    if (!atsReport) {
      showError('Run the ATS analysis before asking the optimization agent to update your resume.', 'ATS Report Needed');
      return;
    }

    setIsTailoringResume(true);
    try {
      const result = await tailorResumeForJob({
        userId: session?.user?.id,
        jobTitle: jobTitle.trim() || 'Software Engineer',
        companyName: companyName.trim(),
        requirements: requirements.trim(),
        description: description.trim(),
        rawResume: settings.resumeContent || '',
        resumeName: settings.resumeName || 'Resume.txt',
        atsReport: atsBaselineReport || atsReport,
        llmProvider: settings.llmProvider,
        llmApiKey: settings.llmApiKey,
        llmModel: settings.llmModel,
      });

      if (!result.success || !result.tailoredResume) {
        throw new Error('The resume optimization agent did not return an updated resume.');
      }

      setTailoredResumeName(result.resumeName);
      setTailoredResumeContent(result.tailoredResume);
      setTailoredResumeBucketPath(result.bucketPath || (session?.user?.id ? `resumes/${session.user.id}/${result.resumeName}` : `resumes/${result.resumeName}`));
      setPickedResumeSource('tailored');
      setResumeEditText(result.tailoredResume);
      setResumeTailorResult(result);

      const analyzed = await handleAnalyzeResumeMatch(null, {
        applicationId: atsApplicationId,
        resumeContent: result.tailoredResume,
        resumeName: result.resumeName,
        stage: 'after',
      });
      if (analyzed?.report) {
        showSuccess(
          `ATS-optimized resume generated & saved in Supabase bucket (${result.bucketPath || result.resumeName})! Match score updated to ${analyzed.report.score}%. This tailored resume is now picked for your application.`,
          'Resume Optimized & Saved to Bucket'
        );
      }
    } catch (error) {
      showError(`Resume optimization failed: ${error.message}`, 'Optimization Error');
    } finally {
      setIsTailoringResume(false);
    }
  };

  // AI Resume Tailor Action: Tailors resume based on job title, company & requirements
  const handleTailorResumeForCurrentJob = async () => {
    if (isTailoringResume) return;
    const targetTitle = (jobTitle || 'Software Engineer').trim();
    const targetCompany = (companyName || '').trim();
    const targetReqs = (requirements || '').trim();
    const targetDesc = (description || '').trim();

    if (!targetReqs && !targetDesc && !targetTitle) {
      showError('Please enter a Job Title or paste job requirements first to tailor your resume.', 'Input Needed');
      return;
    }

    setIsTailoringResume(true);
    try {
      const result = await tailorResumeForJob({
        userId: session?.user?.id,
        jobTitle: targetTitle,
        companyName: targetCompany,
        requirements: targetReqs,
        description: targetDesc,
        rawResume: settings.resumeContent || '',
        resumeName: settings.resumeName || 'Resume.txt',
        atsReport: atsReport || null,
        llmProvider: settings.llmProvider,
        llmApiKey: settings.llmApiKey,
        llmModel: settings.llmModel,
      });

      if (result.success && result.tailoredResume) {
        setTailoredResumeName(result.resumeName);
        setTailoredResumeContent(result.tailoredResume);
        setTailoredResumeBucketPath(result.bucketPath || (session?.user?.id ? `resumes/${session.user.id}/${result.resumeName}` : `resumes/${result.resumeName}`));
        setPickedResumeSource('tailored');
        setResumeEditText(result.tailoredResume);
        setResumeTailorResult(result);
        showSuccess(
          `Resume tailored for ${targetTitle} at ${targetCompany || 'target company'} & saved in Supabase bucket (${result.bucketPath || result.resumeName})! Picked for this application.`,
          'Resume Tailored & Saved!'
        );
      } else {
        showError('Could not tailor resume. Please check your inputs.', 'Notice');
      }
    } catch (err) {
      showError('Error tailoring resume: ' + err.message, 'Tailor Error');
    } finally {
      setIsTailoringResume(false);
    }
  };

  const handleSaveResumeEdits = async () => {
    if (isSavingResumeText) return;
    setIsSavingResumeText(true);
    try {
      const updated = await updateResumeContent(session?.user?.id, resumeEditText, settings.resumeName);
      setSettings(updated);
      setResumeViewMode('preview');
      if (atsApplicationId && jobTitle.trim()) {
        const analyzed = await handleAnalyzeResumeMatch(null, {
          applicationId: atsApplicationId,
          resumeContent: resumeEditText,
          resumeName: updated.resumeName,
          stage: 'after',
        });
        showSuccess(
          analyzed?.report ? `Resume saved and re-scored at ${analyzed.report.score}% ATS match.` : 'Resume updated and saved to your profile!',
          'Saved'
        );
      } else {
        showSuccess('Resume updated and saved to your profile!', 'Saved');
      }
    } catch (err) {
      showError('Failed to save resume: ' + err.message, 'Save Error');
    } finally {
      setIsSavingResumeText(false);
    }
  };

  const handleDownloadResume = () => {
    const content = settings.resumeContent || resumeEditText;
    if (!content) {
      showError('No resume content to download. Please upload or create one first.', 'Notice');
      return;
    }
    if (typeof document !== 'undefined') {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = settings.resumeName || 'Resume.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showSuccess('Resume downloaded successfully!', 'Downloaded');
    }
  };

  const handleSyncResumeFromBucket = async () => {
    if (!session?.user?.id) {
      showError('Please sign in to load your resume from the cloud storage bucket.', 'Notice');
      return;
    }
    setIsSyncingBucket(true);
    try {
      const res = await syncResumeFromBucket(session.user.id);
      if (res && (res.resumeContent || res.signed_url)) {
        const updated = {
          ...settings,
          resumeName: res.resumeName,
          resumeContent: res.resumeContent,
        };
        setSettings(updated);
        setResumeEditText(res.resumeContent);
        if (res.signed_url) {
          setResumePdfUrl(res.signed_url);
        } else {
          loadResumePdfUrl(res.resumeName);
        }
        if (res.is_pdf || (res.resumeName && res.resumeName.toLowerCase().endsWith('.pdf'))) {
          setResumeViewMode('pdf');
        }
        showSuccess(`Loaded "${res.resumeName}" directly from your cloud storage bucket!`, 'Resume Loaded');
      } else {
        showError('No resume file found in your cloud storage bucket. Please upload a resume first.', 'Bucket Empty');
      }
    } catch (err) {
      showError('Failed to load resume from bucket: ' + err.message, 'Bucket Error');
    } finally {
      setIsSyncingBucket(false);
    }
  };

  // Submit Application, Immediately Save to 'applications' table, Start Timer/Loader & Trigger n8n
  const handleGenerateAndApply = async (overrideFields = null) => {
    if (isGenerating) {
      setShowCountdownPopup(true);
      return;
    }

    const activeJobTitle = (overrideFields?.jobTitle || jobTitle || '').trim();
    const activeCompanyName = (overrideFields?.companyName || companyName || '').trim();
    const activeRecipientEmail = (overrideFields?.recipientEmail || recipientEmail || '').trim();
    const activeRequirements = (overrideFields?.requirements || requirements || '').trim();
    const activeDescription = (overrideFields?.description || description || '').trim();

    if (!activeJobTitle) {
      showError('Please enter a Job Title.', 'Missing Field');
      return;
    }

    // 1. Ensure User ID from DB (Supabase Auth session)
    let userId = session?.user?.id;
    if (!userId) {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      userId = freshSession?.user?.id;
    }

    if (!userId) {
      showError('Authentication required. Please sign in to submit.', 'Authentication Required');
      return;
    }

    // 2. IMMEDIATELY SAVE FORM DETAILS IN TABLE 'applications' ON BUTTON CLICK
    let createdApp = null;
    let createdAppId = null;
    try {
      const result = await createApplication(userId, {
        jobTitle: activeJobTitle,
        companyName: activeCompanyName,
        recipientEmail: activeRecipientEmail,
        requirements: activeRequirements,
        description: activeDescription,
      });
      createdApp = result.application;
      createdAppId = result.id;
      setAtsApplicationId(createdAppId);

      if (createdApp?.status === 'Draft') {
        await updateApplicationStatus(userId, createdAppId, 'Generating');
      }

      // Instantly refresh applications state so it appears in history right away
      const refreshedList = await getApplications(userId);
      setApplications(refreshedList);
    } catch (saveErr) {
      console.warn('Initial application save warning:', saveErr.message);
    }

    // 3. Start timer, popup & loader immediately
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setIsGenerating(true);
    setShowCountdownPopup(true);
    setGenerationSeconds(0);
    setGeneratedResult(null);

    // Record submission time (buffered 5 seconds for server clock drift)
    const submitTime = new Date(Date.now() - 5000).toISOString();

    // 4. Prepare payload with ONLY userID, applicationID and form details
    const n8nWebhookUrl = 'https://n8n.flyinvict.com/webhook/8c9fe40a-79bb-49b7-9bdf-e9bba8bae6cc';

    const webhookPayload = {
      userID: userId,
      user_id: userId,
      applicationID: createdAppId,
      application_id: createdAppId,
      jobTitle: activeJobTitle,
      job_title: activeJobTitle,
      companyName: activeCompanyName,
      company_name: activeCompanyName,
      recipientEmail: activeRecipientEmail,
      recipient_email: activeRecipientEmail,
      requirements: activeRequirements,
      description: activeDescription,
      atsScore: atsReport?.score ?? null,
      ats_score: atsReport?.score ?? null,
      atsReport: atsReport || null,
      ats_report: atsReport || null,
      resumeName: getPickedResume().name,
      resume_name: getPickedResume().name,
      resumeContent: getPickedResume().content,
      resume_content: getPickedResume().content,
      pickedResumeSource: getPickedResume().source,
      picked_resume_source: getPickedResume().source,
      resumeBucketPath: getPickedResume().bucketPath,
      resume_bucket_path: getPickedResume().bucketPath,
    };

    let directWebhookContent = '';

    // Stop generation countdown timer and dismiss popup
    const stopGenerationTimer = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsGenerating(false);
      setShowCountdownPopup(false);
    };

    const extractEmailContent = (rawText) => {
      if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return '';
      try {
        const data = JSON.parse(rawText);
        if (typeof data === 'string') return data.trim();
        if (Array.isArray(data) && data.length > 0) {
          const first = data[0];
          if (typeof first === 'string') return first.trim();
          return (
            first.generated_email ||
            first.generatedEmail ||
            first.output ||
            first.text ||
            first.response ||
            first.body ||
            first.email ||
            first.email_body ||
            first.content ||
            first.result ||
            ''
          ).trim();
        }
        if (typeof data === 'object' && data !== null) {
          return (
            data.generated_email ||
            data.generatedEmail ||
            data.output ||
            data.text ||
            data.response ||
            data.body ||
            data.email ||
            data.email_body ||
            data.content ||
            data.result ||
            ''
          ).trim();
        }
      } catch (_) {
        if (rawText.length > 30) return rawText.trim();
      }
      return '';
    };

    const onEmailFound = async (generatedContent) => {
      stopGenerationTimer();

      // 1. Update the record in 'applications' table: status becomes 'Generated'
      if (createdAppId && generatedContent) {
        await updateApplicationGeneratedEmail(userId, createdAppId, generatedContent);
      }

      // 2. Refresh applications directly from 'applications' table in Supabase
      const refreshedList = await getApplications(userId);
      setApplications(refreshedList);

      // 3. Set generatedResult strictly preserving the generated email content
      const dbRecord = refreshedList.find(a => a.id === createdAppId);
      const finalResult = {
        ...(dbRecord || createdApp || {}),
        id: createdAppId || dbRecord?.id || Date.now().toString(),
        jobTitle: activeJobTitle,
        companyName: activeCompanyName || 'Hiring Company',
        recipientEmail: activeRecipientEmail,
        requirements: activeRequirements,
        description: activeDescription,
        generatedEmail: generatedContent || dbRecord?.generatedEmail || '',
        status: 'Generated',
        createdAt: dbRecord?.createdAt || createdApp?.createdAt || new Date().toISOString(),
      };
      setGeneratedResult(finalResult);
      // Immediately open email details modal for review/copy/sending
      setSelectedRecord(finalResult);
    };

    // 5. Direct Email Generation Agent using user's LLM API if key is present
    if (settings.llmApiKey && settings.llmApiKey.trim().length > 5) {
      try {
        const userProfile = await getProfile(userId, session?.user?.email || '');
        const emailResult = await performLlmEmailGeneration({
          jobTitle: activeJobTitle,
          companyName: activeCompanyName,
          recipientEmail: activeRecipientEmail,
          requirements: activeRequirements,
          description: activeDescription,
          resumeContent: getPickedResume().content || '',
          atsReport: atsReport || null,
          profile: userProfile,
          provider: settings.llmProvider,
          apiKey: settings.llmApiKey,
          model: settings.llmModel,
        });

        if (emailResult.success && emailResult.generatedEmail) {
          // Asynchronously notify webhook
          fetch(n8nWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...webhookPayload, generated_email: emailResult.generatedEmail }),
          }).catch(() => {});

          await onEmailFound(emailResult.generatedEmail);
          showSuccess(`Application email generated via ${settings.llmProvider}!`, 'Email Generated');
          return;
        }
      } catch (llmGenErr) {
        console.warn('Direct LLM email generation notice, falling back to webhook:', llmGenErr.message);
      }
    }

    // 6. Trigger the n8n webhook asynchronously
    fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
    })
      .then(async (wbRes) => {
        // Webhook responded back! Immediately stop the timer & countdown popup
        stopGenerationTimer();

        let extractedEmail = '';
        if (wbRes.ok) {
          try {
            const rawText = await wbRes.text();
            extractedEmail = extractEmailContent(rawText);
          } catch (_txtErr) {}
        }

        if (extractedEmail) {
          await onEmailFound(extractedEmail);
          return;
        }

        // Webhook completed: check if email was stored in DB directly
        const emailRecord = await fetchLatestApplicationEmail(userId, submitTime, createdAppId);
        if (emailRecord && emailRecord.fullEmail) {
          await onEmailFound(emailRecord.fullEmail);
          return;
        }

        if (createdAppId) {
          try {
            const { data: currentApp } = await supabase
              .from('applications')
              .select('*, application_emails(*)')
              .eq('id', createdAppId)
              .eq('user_id', userId)
              .single();

            if (currentApp) {
              const mapped = mapApplicationRow(currentApp);
              if (mapped && mapped.generatedEmail) {
                await onEmailFound(mapped.generatedEmail);
                return;
              }
            }
          } catch (_checkErr) {}
        }

        // Allow a small 400ms buffer in case DB write is finishing
        setTimeout(async () => {
          try {
            const retryEmail = await fetchLatestApplicationEmail(userId, submitTime, createdAppId);
            if (retryEmail && retryEmail.fullEmail) {
              await onEmailFound(retryEmail.fullEmail);
              return;
            }
            const refreshedList = await getApplications(userId);
            setApplications(refreshedList);
            const dbRec = refreshedList.find(a => a.id === createdAppId);
            if (dbRec && dbRec.generatedEmail) {
              setSelectedRecord(dbRec);
              setGeneratedResult(dbRec);
            }
          } catch (_) {}
        }, 400);
      })
      .catch((wbErr) => {
        console.warn('n8n Webhook trigger note:', wbErr.message);
      });

    // 6. Poll application_emails table in Supabase
    const pollStartTime = Date.now();
    const maxPollTimeMs = 120000; // 2 minutes

    pollIntervalRef.current = setInterval(async () => {
      // 1. Check application_emails table in Supabase by applicationId
      const emailRecord = await fetchLatestApplicationEmail(userId, submitTime, createdAppId);
      if (emailRecord && emailRecord.fullEmail) {
        await onEmailFound(emailRecord.fullEmail);
        return;
      }

      // 2. Check if direct response arrived from webhook
      if (directWebhookContent && directWebhookContent.trim()) {
        await onEmailFound(directWebhookContent);
        return;
      }

      // 3. Check if 'applications' table has updated generated email via join
      if (createdAppId) {
        try {
          const { data: currentApp } = await supabase
            .from('applications')
            .select('*, application_emails(*)')
            .eq('id', createdAppId)
            .eq('user_id', userId)
            .single();

          if (currentApp) {
            const mapped = mapApplicationRow(currentApp);
            if (mapped && mapped.generatedEmail) {
              await onEmailFound(mapped.generatedEmail);
              return;
            }
          }
        } catch (_checkErr) {}
      }

      // 4. Check timeout
      if (Date.now() - pollStartTime > maxPollTimeMs) {
        stopGenerationTimer();
        showError(
          'Email generation timed out waiting for output in application_emails table. Your application details are already saved in Applications history.',
          'Generation Notice'
        );
      }
    }, 2000);
  };

  // Send Email Action
  const handleSendEmail = async (appRecord) => {
    if (!appRecord || isSending) return;
    setIsSending(true);
    try {
      // If user edited fields before sending, persist them first so email uses human-corrected version!
      let activeRecord = { ...appRecord };
      if (isEditingApplication && editForm) {
        try {
          const updatedList = await updateFullApplication(session?.user?.id, appRecord.id, editForm);
          if (updatedList) setApplications(updatedList);
          activeRecord = {
            ...appRecord,
            jobTitle: editForm.jobTitle.trim() || appRecord.jobTitle,
            companyName: editForm.companyName.trim() || appRecord.companyName,
            recipientEmail: editForm.recipientEmail.trim() || appRecord.recipientEmail,
            generatedEmail: editForm.generatedEmail.trim() || appRecord.generatedEmail,
          };
          setSelectedRecord(activeRecord);
          setIsEditingApplication(false);
        } catch (_saveErr) {}
      }

      // Get the applications_email id
      const emailRecord = await fetchLatestApplicationEmail(session?.user?.id, null, activeRecord.id);
      const applications_email_id = emailRecord ? emailRecord.id : null;

      if (!applications_email_id) {
        console.warn('No applications_email id found for this record.');
      }

      if (settings?.googleConnectedAt) {
        const recipient = activeRecord.recipientEmail || activeRecord.recipient_email;
        if (!recipient) {
          throw new Error('Recipient email address is missing for this application.');
        }

        const jobTitle = activeRecord.jobTitle || activeRecord.job_title || 'Software Developer';
        const subject = emailRecord?.subject || `Job Application: ${jobTitle} - ${profile?.fullName || 'Applicant'}`;
        const body = activeRecord.generatedEmail || emailRecord?.body || 'Please find my job application attached.';

        await sendEmail({
          to: recipient,
          subject,
          body,
          applicationId: activeRecord.id,
          applicationEmailId: applications_email_id,
        });

        showSuccess('Application email sent directly via your connected Gmail!', 'Email Sent');
      } else {
        await fetch('https://n8n.flyinvict.com/webhook/42066edc-2634-4eec-9db9-6b20c2932d56', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            applications_email_id,
            user_id: session?.user?.id,
            application_id: activeRecord.id,
            jobTitle: activeRecord.jobTitle,
            companyName: activeRecord.companyName,
            recipientEmail: activeRecord.recipientEmail,
            email_body: activeRecord.generatedEmail,
          }),
        });
        showSuccess('Email triggered successfully via webhook!', 'Webhook Triggered');
      }

      // Update status to Applied in database & state immediately
      const appliedTime = new Date().toISOString();
      const updated = { ...activeRecord, status: 'Applied', appliedAt: appliedTime };
      const updatedList = await updateApplicationStatus(session?.user?.id, activeRecord.id, 'Applied');
      if (updatedList) setApplications(updatedList);

      // Clear the form fields and sync generated/selected state
      if (generatedResult?.id === activeRecord.id || !selectedRecord) {
        clearApplicationForm();
        setGeneratedResult(null);
      }

      if (selectedRecord?.id === activeRecord.id) {
        setSelectedRecord(updated);
      }
      if (generatedResult?.id === activeRecord.id) {
        setGeneratedResult(updated);
      }
    } catch (e) {
      showError('Failed to send email: ' + e.message, 'Send Error');
    } finally {
      setIsSending(false);
    }
  };

  // Save manual edits to application & email pitch
  const handleSaveEdits = async () => {
    if (!selectedRecord?.id || isSavingEdits) return;
    setIsSavingEdits(true);
    try {
      const updatedList = await updateFullApplication(session?.user?.id, selectedRecord.id, editForm);
      if (updatedList) setApplications(updatedList);
      const updatedRecord = {
        ...selectedRecord,
        jobTitle: editForm.jobTitle.trim() || selectedRecord.jobTitle,
        companyName: editForm.companyName.trim() || selectedRecord.companyName,
        recipientEmail: editForm.recipientEmail.trim() || selectedRecord.recipientEmail,
        generatedEmail: editForm.generatedEmail.trim() || selectedRecord.generatedEmail,
      };
      setSelectedRecord(updatedRecord);
      if (generatedResult?.id === selectedRecord.id) {
        setGeneratedResult(updatedRecord);
      }
      setIsEditingApplication(false);
      showSuccess('Application updated successfully!', 'Saved');
    } catch (err) {
      showError('Error saving edits: ' + err.message, 'Save Error');
    } finally {
      setIsSavingEdits(false);
    }
  };

  // Delete Record
  const handleDeleteRecord = (id) => {
    showConfirm({
      title: 'Delete Application',
      message: 'Are you sure you want to remove this application record? This action cannot be undone.',
      confirmText: 'Delete',
      onConfirm: async () => {
        const updated = await deleteApplication(session?.user?.id, id);
        if (updated) setApplications(updated);
        if (selectedRecord?.id === id) setSelectedRecord(null);
      },
    });
  };

  // Copy to clipboard
  const handleCopy = (text) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showSuccess('Copied to clipboard!', 'Copied');
    }
  };

  const handleOpenRecord = async (item) => {
    const needsAts = !item.atsReport && !item.tailoredAtsReport;
    const needsEmail = !item.generatedEmail;
    setSelectedRecord({ ...item, isLoadingEmail: needsEmail, isLoadingAts: needsAts });

    if (needsAts && settings.resumeContent) {
      try {
        const report = await analyzeResumeForJob({
          userId: session?.user?.id,
          applicationId: item.id,
          jobTitle: item.jobTitle,
          companyName: item.companyName,
          requirements: item.requirements,
          description: item.description,
          resumeContent: settings.resumeContent,
          resumeName: settings.resumeName,
          stage: 'before',
        });
        const analyzedItem = { ...item, atsScore: report.score, atsReport: report };
        setApplications((current) => current.map((record) => record.id === item.id ? analyzedItem : record));
        setSelectedRecord((current) => current?.id === item.id
          ? { ...current, atsScore: report.score, atsReport: report, isLoadingAts: false }
          : current);
      } catch (error) {
        console.warn('ATS analysis on application view failed:', error);
        setSelectedRecord((current) => current?.id === item.id ? { ...current, isLoadingAts: false } : current);
      }
    } else if (needsAts) {
      setSelectedRecord((current) => current?.id === item.id ? { ...current, isLoadingAts: false } : current);
    }

    if (!needsEmail) return;
    try {
      const emailRecord = await fetchLatestApplicationEmail(session?.user?.id, null, item.id);
      if (emailRecord && emailRecord.fullEmail) {
        setSelectedRecord(prev => {
          if (prev && prev.id === item.id) {
            return { ...prev, isLoadingEmail: false, generatedEmail: emailRecord.fullEmail, status: 'Generated' };
          }
          return prev;
        });
      } else {
        setSelectedRecord(prev => (prev && prev.id === item.id ? { ...prev, isLoadingEmail: false } : prev));
      }
    } catch (err) {
      console.warn('Error fetching email for modal:', err);
      setSelectedRecord(prev => (prev && prev.id === item.id ? { ...prev, isLoadingEmail: false } : prev));
    }
  };

  // ---------------- AUTH SCREEN ----------------
  if (!isAuthenticated) {
    return (
      <View style={[styles.webContainer, isCompact && styles.webContainerCompact]}>
        {/* Left Side: Hero Section */}
        <View style={[styles.leftPanel, isCompact && styles.leftPanelCompact]}>
          <View style={styles.heroContent}>
            <View style={styles.badge}>
            <Text style={styles.badgeText}>JOB APPLICATION WORKSPACE</Text>
            </View>
            <Text style={styles.heroTitle}>A calmer way to manage your job search.</Text>
            <Text style={styles.heroSubtitle}>
              Keep your profile, tailor each application, and track every opportunity from one focused workspace.
            </Text>
            
            <View style={styles.featureList}>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>01</Text>
                <Text style={styles.featureText}>Create role-specific application emails</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>02</Text>
                <Text style={styles.featureText}>Keep your resume and professional profile ready</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>03</Text>
                <Text style={styles.featureText}>Review your complete application history</Text>
              </View>
            </View>
          </View>
        </View>
        
        {/* Right Side: Auth Form */}
        <View style={[styles.rightPanel, isCompact && styles.rightPanelCompact]}>
          <View style={[styles.authCard, isMobile && styles.authCardMobile]}>
            <View style={styles.authHeader}>
              <Text style={styles.authTitle}>
                {isLoginMode ? 'Welcome Back' : 'Create Account'}
              </Text>
              <Text style={styles.authSubtitle}>
                {isLoginMode ? 'Enter your details to access your portal' : 'Sign up to get started'}
              </Text>
            </View>

            {authError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{authError}</Text>
              </View>
            ) : null}

            {authMessage ? (
              <View style={styles.successBanner}>
                <Text style={styles.successBannerText}>{authMessage}</Text>
              </View>
            ) : null}
            
            {!isLoginMode && (
              <View style={styles.formGroup}>
                <Text style={styles.label}>Full Name</Text>
                <TextInput
                  style={styles.webInput}
                  placeholder="e.g. John Doe"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  placeholderTextColor="#9ca3af"
                />
              </View>
            )}

            <View style={styles.formGroup}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.webInput}
                placeholder="name@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor="#9ca3af"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.webInput}
                placeholder="••••••••"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholderTextColor="#9ca3af"
              />
            </View>

            <TouchableOpacity 
              style={[styles.webPrimaryButton, authLoading && styles.disabledButton]}
              disabled={authLoading}
              onPress={async () => {
                setAuthError('');
                setAuthMessage('');

                if (!isLoginMode && !fullName.trim()) {
                  setAuthError('Please enter your full name');
                  return;
                }

                if (!email.trim() || !password.trim()) {
                  setAuthError('Please enter both email and password');
                  return;
                }

                if (!isLoginMode && password.length < 6) {
                  setAuthError('Password should be at least 6 characters');
                  return;
                }

                setAuthLoading(true);

                try {
                  if (isLoginMode) {
                    const { data, error } = await supabase.auth.signInWithPassword({
                      email: email.trim(),
                      password: password.trim(),
                    });
                    if (error) {
                      setAuthError(error.message);
                    } else if (data?.session) {
                      // Ensure users & profiles table records exist
                      try {
                        const u = data.session.user;
                        const userDisplayName = u.user_metadata?.full_name || email.trim().split('@')[0];
                        await supabase.from('users').upsert({
                          id: u.id,
                          email: u.email,
                          full_name: userDisplayName,
                          updated_at: new Date().toISOString()
                        }, { onConflict: 'id' });
                        await supabase.from('profiles').upsert({
                          id: u.id,
                          email: u.email,
                          full_name: userDisplayName,
                          updated_at: new Date().toISOString()
                        }, { onConflict: 'id' });
                      } catch (syncErr) {
                        console.warn('Sign-in user sync notice:', syncErr);
                      }
                      await initSession(data.session.user.id);
                      setSession(data.session);
                      setIsAuthenticated(true);
                    }
                  } else {
                    const { data, error } = await supabase.auth.signUp({
                      email: email.trim(),
                      password: password.trim(),
                      options: {
                        data: {
                          full_name: fullName.trim(),
                        },
                      },
                    });

                    if (error) {
                      setAuthError(error.message);
                    } else {
                      const targetUser = data?.user || data?.session?.user;
                      if (targetUser) {
                        const displayName = fullName.trim() || email.trim().split('@')[0];
                        try {
                          await supabase.from('users').upsert({
                            id: targetUser.id,
                            email: email.trim(),
                            full_name: displayName,
                            updated_at: new Date().toISOString()
                          }, { onConflict: 'id' });
                        } catch (uErr) {
                          console.warn('Users table direct upsert notice:', uErr);
                        }

                        try {
                          await supabase.from('profiles').upsert({
                            id: targetUser.id,
                            email: email.trim(),
                            full_name: displayName,
                            updated_at: new Date().toISOString()
                          }, { onConflict: 'id' });
                        } catch (pErr) {
                          console.warn('Profiles table direct upsert notice:', pErr);
                        }

                        try {
                          await supabase.from('user_settings').upsert({
                            user_id: targetUser.id
                          }, { onConflict: 'user_id' });
                        } catch (sErr) {
                          console.warn('User_settings direct upsert notice:', sErr);
                        }
                      }

                      if (data?.session) {
                        setAuthMessage('Account created and signed in successfully!');
                        setSession(data.session);
                        setIsAuthenticated(true);
                      } else if (data?.user) {
                        const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
                          email: email.trim(),
                          password: password.trim(),
                        });
                        if (!loginErr && loginData?.session) {
                          setSession(loginData.session);
                          setIsAuthenticated(true);
                        } else {
                          setAuthMessage('Account created! Sign in now with your email & password.');
                          setIsLoginMode(true);
                        }
                      }
                    }
                  }
                } catch (err) {
                  setAuthError('Unexpected error: ' + err.message);
                  console.error(err);
                } finally {
                  setAuthLoading(false);
                }
              }}
            >
              {authLoading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.webPrimaryButtonText}>{isLoginMode ? 'Sign In' : 'Create Account'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ marginTop: 24, alignItems: 'center' }}
              onPress={() => {
                setIsLoginMode(!isLoginMode);
                setFullName('');
                setAuthError('');
                setAuthMessage('');
              }}
            >
              <Text style={{ color: '#2563eb', fontWeight: '500', fontSize: 14 }}>
                {isLoginMode ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ---------------- MAIN APPLICATION PORTAL ----------------
  const filteredApps = applications.filter(app => {
    const q = historySearch.toLowerCase();
    return (
      app.jobTitle?.toLowerCase().includes(q) ||
      app.companyName?.toLowerCase().includes(q) ||
      app.recipientEmail?.toLowerCase().includes(q)
    );
  });

  return (
    <View style={styles.webAppContainer}>
      {/* Top Header & Navigation */}
      <View style={[styles.webNavbar, isCompact && styles.webNavbarCompact, isMobile && styles.webNavbarMobile]}>
        <View style={[styles.brandRow, isMobile && styles.brandRowMobile]}>
          <View style={styles.brandContainer}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoBadgeText}>J</Text>
            </View>
            <View>
              <Text style={styles.navbarBrand}>JobApply</Text>
              {isMobile ? <Text style={styles.navbarCaption}>Application workspace</Text> : null}
            </View>
          </View>
          {isMobile ? (
            <TouchableOpacity onPress={handleSignOut} style={styles.logoutButton}>
              <Text style={styles.logoutText}>Sign out</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Navigation Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.navTabsScroller, isMobile && styles.navTabsScrollerMobile]}
          contentContainerStyle={[styles.navTabs, isCompact && styles.navTabsCompact, isMobile && styles.navTabsMobile]}
        >
          <TouchableOpacity 
            style={[styles.navTabItem, activeTab === 'apply' && styles.navTabItemActive]} 
            onPress={() => setActiveTab('apply')}
          >
            <Text style={[styles.navTabText, activeTab === 'apply' && styles.navTabTextActive]}>
              Apply
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navTabItem, activeTab === 'profile' && styles.navTabItemActive]} 
            onPress={() => setActiveTab('profile')}
          >
            <Text style={[styles.navTabText, activeTab === 'profile' && styles.navTabTextActive]}>
              Profile
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navTabItem, activeTab === 'history' && styles.navTabItemActive]} 
            onPress={() => setActiveTab('history')}
          >
            <Text style={[styles.navTabText, activeTab === 'history' && styles.navTabTextActive]}>
              History ({applications.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navTabItem, activeTab === 'resume' && styles.navTabItemActive]} 
            onPress={() => setActiveTab('resume')}
          >
            <Text style={[styles.navTabText, activeTab === 'resume' && styles.navTabTextActive]}>
              Resume
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navTabItem, activeTab === 'settings' && styles.navTabItemActive]} 
            onPress={() => setActiveTab('settings')}
          >
            <Text style={[styles.navTabText, activeTab === 'settings' && styles.navTabTextActive]}>
              Settings
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={[styles.navbarRight, isCompact && styles.navbarRightCompact]}>
          <Text style={styles.userEmail}>
            {session?.user?.user_metadata?.full_name 
              ? `${session.user.user_metadata.full_name} (${session.user.email})`
              : (session?.user?.email || 'User')}
          </Text>
          <TouchableOpacity onPress={handleSignOut} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content Area */}
      <ScrollView contentContainerStyle={[styles.webContent, isCompact && styles.webContentCompact]}>
        {/* ================= TAB 1: APPLY FOR JOB ================= */}
        {/* ================= TAB 1: APPLY FOR JOB ================= */}
        {activeTab === 'apply' && (
          <View style={[styles.pageContainer, { maxWidth: 1400 }]}>
            <View style={[styles.splitLayout, isCompact && styles.splitLayoutCompact]}>
              {/* Left Column: AI Agent Raw Job Post Intake Card */}
              <View style={[styles.flexCard, styles.aiIntakeCard, isMobile && styles.cardMobile, { flex: 1, marginBottom: 0 }]}>
                <View style={styles.aiIntakeHeader}>
                  <View style={styles.aiIntakeTitleRow}>
                    <View style={styles.aiAgentPill}>
                      <Text style={styles.aiAgentPillText}>LANGGRAPH AGENT</Text>
                    </View>
                    <Text style={styles.aiIntakeTitle}>Quick-Fill from Raw Hiring Post</Text>
                  </View>
                  <Text style={styles.aiIntakeSubtitle}>
                    Paste unformatted text from LinkedIn, WhatsApp, or job boards. The AI Agent normalizes unicode fonts, extracts key details into the Job Application Form, and dispatches directly to your webhook.
                  </Text>
                </View>

                <TextInput
                  style={[styles.aiTextarea, { minHeight: 210 }]}
                  placeholder='Paste raw hiring post (e.g. "[Techies Global](...) Lahore is looking for 𝗔𝗜 𝗘𝘅𝗽𝗲𝗿𝘁... Apply at: managingdirector@techiesglobal.com...")'
                  value={rawJobPost}
                  onChangeText={setRawJobPost}
                  multiline
                  placeholderTextColor="#94a3b8"
                />

                <View style={[styles.aiButtonRow, { flexWrap: 'wrap', gap: 8 }]}>
                  <TouchableOpacity
                    style={[styles.aiPrimaryBtn, isParsingRawPost && styles.disabledButton]}
                    onPress={() => handleParseAndPopulate(false)}
                    disabled={isParsingRawPost}
                  >
                    {isParsingRawPost ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.aiPrimaryBtnText}>Auto-fill form</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.aiWebhookBtn, (isParsingRawPost || isGenerating) && styles.disabledButton]}
                    onPress={() => handleParseAndPopulate(true)}
                    disabled={isParsingRawPost || isGenerating}
                  >
                    <Text style={styles.aiWebhookBtnText}>Auto-fill and analyze</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.aiSampleBtn}
                    onPress={handleLoadSamplePost}
                  >
                    <Text style={styles.aiSampleBtnText}>Load sample</Text>
                  </TouchableOpacity>

                  {rawJobPost ? (
                    <TouchableOpacity
                      style={styles.aiClearBtn}
                      onPress={handleClearRawPost}
                    >
                      <Text style={styles.aiClearBtnText}>Clear</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {rawPostMessage ? (
                  <View style={styles.aiFeedbackBanner}>
                    <Text style={styles.aiFeedbackText}>✓ {rawPostMessage}</Text>
                  </View>
                ) : null}

                {parsedSummary ? (
                  <View style={styles.aiExtractedSummary}>
                    <View style={styles.aiSummaryTag}>
                      <Text style={styles.aiSummaryTagLabel}>Company:</Text>
                      <Text style={styles.aiSummaryTagValue}>{parsedSummary.companyName}</Text>
                    </View>
                    <View style={styles.aiSummaryTag}>
                      <Text style={styles.aiSummaryTagLabel}>Role:</Text>
                      <Text style={styles.aiSummaryTagValue}>{parsedSummary.jobTitle}</Text>
                    </View>
                    <View style={styles.aiSummaryTag}>
                      <Text style={styles.aiSummaryTagLabel}>Email:</Text>
                      <Text style={styles.aiSummaryTagValue}>{parsedSummary.recipientEmail || 'None'}</Text>
                    </View>
                    <View style={styles.aiSummaryTag}>
                      <Text style={styles.aiSummaryTagLabel}>Requirements:</Text>
                      <Text style={styles.aiSummaryTagValue}>
                        {parsedSummary.requirements ? `${parsedSummary.requirements.length} chars` : '0'}
                      </Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {/* Right Column: Job Application Form Card */}
              <View style={[styles.flexCard, isMobile && styles.cardMobile, { flex: 1.15, marginBottom: 0 }]}>
                <Text style={styles.cardTitle}>Job Application Form</Text>
                <Text style={styles.cardDescription}>
                  Add the opportunity details and create a tailored first draft from your saved profile.
                </Text>

                <View style={[styles.formRow, isMobile && styles.formRowMobile]}>
                  <View style={[styles.formGroup, { flex: 1 }, !isMobile && { marginRight: 12 }]}>
                    <Text style={styles.label}>Job Title *</Text>
                    <TextInput
                      style={styles.webInput}
                      placeholder="e.g. Senior Frontend Engineer"
                      value={jobTitle}
                      onChangeText={setJobTitle}
                      placeholderTextColor="#9ca3af"
                    />
                  </View>

                  <View style={[styles.formGroup, { flex: 1 }]}>
                    <Text style={styles.label}>Company Name</Text>
                    <TextInput
                      style={styles.webInput}
                      placeholder="e.g. Acme Corp"
                      value={companyName}
                      onChangeText={setCompanyName}
                      placeholderTextColor="#9ca3af"
                    />
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Recipient / Recruiter Email</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="recruiter@company.com"
                    value={recipientEmail}
                    onChangeText={setRecipientEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Key Requirements & Tech Stack</Text>
                  <TextInput
                    style={[styles.webInput, styles.textArea, { height: 90 }]}
                    placeholder="e.g. React, Next.js, Node.js, 4+ years experience, team leadership..."
                    value={requirements}
                    onChangeText={setRequirements}
                    multiline
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.label}>Job Description / Notes</Text>
                  <TextInput
                    style={[styles.webInput, styles.textArea, { height: 110 }]}
                    placeholder="Paste the full job description or specific points you want mentioned..."
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                {/* Active Resume Selection & Picking Banner */}
                {(() => {
                  const picked = getPickedResume();
                  const isTailoredPicked = picked.source === 'tailored';
                  const hasTailored = !!tailoredResumeContent;

                  return (
                    <View style={[styles.pickedResumeCard, isTailoredPicked && styles.pickedResumeCardActive]}>
                      {/* Top Bar: Live Picking Status & Indicator */}
                      <View style={styles.pickedResumeTopBar}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <View style={[styles.pickedStatusDot, isTailoredPicked ? styles.dotGreen : styles.dotBlue]} />
                          <Text style={styles.pickedResumeEyebrow}>PICKING FOR APPLICATION:</Text>
                          <View style={[styles.pickedBadge, isTailoredPicked ? styles.pickedBadgeGreen : styles.pickedBadgeBlue]}>
                            <Text style={[styles.pickedBadgeText, isTailoredPicked ? styles.pickedBadgeTextGreen : styles.pickedBadgeTextBlue]}>
                              {isTailoredPicked ? '✓ TAILORED ATS RESUME' : 'MASTER RESUME'}
                            </Text>
                          </View>
                        </View>

                        {/* Supabase Storage Indicator */}
                        <View style={styles.bucketTag}>
                          <Text style={styles.bucketTagIcon}>☁️</Text>
                          <Text style={styles.bucketTagText}>
                            {isTailoredPicked ? 'Saved in Supabase Storage' : 'Supabase Storage'}
                          </Text>
                        </View>
                      </View>

                      {/* Main Resume Details */}
                      <View style={styles.pickedResumeBody}>
                        <View style={{ flex: 1, minWidth: 200 }}>
                          <Text style={styles.pickedFileName} numberOfLines={1}>
                            {picked.name}
                          </Text>
                          <Text style={styles.pickedBucketPath} numberOfLines={1}>
                            Bucket path: <Text style={{ fontFamily: 'monospace', color: '#166534', fontWeight: '700' }}>{picked.bucketPath}</Text>
                          </Text>
                          <Text style={styles.pickedCharCount}>
                            {picked.content ? `${picked.content.length.toLocaleString()} characters` : 'No resume content uploaded yet'} • {isTailoredPicked ? 'Targeted ATS optimizations applied' : 'Profile master resume'}
                          </Text>
                        </View>

                        <View style={styles.pickedResumeActionRow}>
                          <TouchableOpacity
                            style={styles.pickedPreviewBtn}
                            onPress={() => setShowPickedResumePreviewModal(true)}
                          >
                            <Text style={styles.pickedPreviewBtnText}>👁️ Preview</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.resumeViewBtn}
                            onPress={() => setActiveTab('resume')}
                          >
                            <Text style={styles.resumeViewBtnText}>All resumes</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.resumeTailorBtn, isTailoringResume && styles.disabledButton]}
                            onPress={handleTailorResumeForCurrentJob}
                            disabled={isTailoringResume}
                          >
                            {isTailoringResume ? (
                              <ActivityIndicator size="small" color="#ffffff" />
                            ) : (
                              <Text style={styles.resumeTailorBtnText}>
                                {hasTailored ? 'Re-tailor resume' : 'Tailor for this job'}
                              </Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Resume Switcher: Toggle between Tailored and Master when tailored exists */}
                      {hasTailored && (
                        <View style={styles.resumeSwitcherRow}>
                          <Text style={styles.switcherLabel}>Choose which resume to submit with this application:</Text>
                          <View style={styles.switcherSegmentGroup}>
                            <TouchableOpacity
                              style={[styles.switcherSegment, isTailoredPicked && styles.switcherSegmentActiveGreen]}
                              onPress={() => setPickedResumeSource('tailored')}
                            >
                              <Text style={[styles.switcherSegmentText, isTailoredPicked && styles.switcherSegmentTextActive]}>
                                🎯 Tailored ATS Resume {isTailoredPicked ? '(Selected)' : ''}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.switcherSegment, !isTailoredPicked && styles.switcherSegmentActiveBlue]}
                              onPress={() => setPickedResumeSource('master')}
                            >
                              <Text style={[styles.switcherSegmentText, !isTailoredPicked && styles.switcherSegmentTextActive]}>
                                📄 Master Resume {!isTailoredPicked ? '(Selected)' : ''}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })()}

                <TouchableOpacity
                  style={[styles.webPrimaryButton, (isGenerating || isAnalyzingAts) && styles.disabledButton]}
                  onPress={isGenerating ? () => setShowCountdownPopup(true) : () => handleAnalyzeResumeMatch()}
                  disabled={isAnalyzingAts}
                >
                  {isGenerating ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <ActivityIndicator color="#ffffff" style={{ marginRight: 10 }} />
                      <Text style={styles.webPrimaryButtonText}>
                        Generating Email... ({formatTime(generationSeconds)}) • Open Popup
                      </Text>
                    </View>
                  ) : isAnalyzingAts ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <ActivityIndicator color="#ffffff" style={{ marginRight: 10 }} />
                      <Text style={styles.webPrimaryButtonText}>Analyzing resume match...</Text>
                    </View>
                  ) : (
                    <Text style={styles.webPrimaryButtonText}>{atsReport ? 'Refresh ATS analysis' : 'Analyze resume match'}</Text>
                  )}
                </TouchableOpacity>

                {(jobTitle || companyName || recipientEmail || requirements || description) && !isGenerating ? (
                  <TouchableOpacity 
                    style={{ marginTop: 10, alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 10 }}
                    onPress={clearApplicationForm}
                  >
                    <Text style={{ color: '#6b7280', fontSize: 13, fontWeight: '500' }}>Clear form</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {atsReport ? (
              <AtsDashboard
                report={atsReport}
                previousScore={atsReport.stage === 'after' ? atsBaselineReport?.score ?? null : null}
                isOptimizing={isTailoringResume || isAnalyzingAts}
                isGenerating={isGenerating}
                onEditResume={() => {
                  setResumeEditText(settings.resumeContent || '');
                  setResumeViewMode('edit');
                  setActiveTab('resume');
                }}
                onOptimizeResume={handleAgentOptimizeResume}
                onGenerateEmail={() => handleGenerateAndApply()}
              />
            ) : null}
          </View>
        )}

        {/* ================= TAB 2: CANDIDATE PROFILE & SOCIALS ================= */}
        {activeTab === 'profile' && (
          <View style={styles.pageContainer}>
            <View style={[styles.webCard, isMobile && styles.cardMobile]}>
              <View style={styles.cardHeader}>
                <View style={styles.iconCircle}>
                  <Text style={styles.profileMark}>ID</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>Candidate Profile & Professional Links</Text>
                  <Text style={styles.cardSubtitle}>
                    Add your phone number, portfolio, LinkedIn, and social links. These details are automatically injected into your job application emails and sent to hiring managers.
                  </Text>
                </View>
              </View>

              {/* Row 1: Full Name & Professional Headline */}
              <View style={[styles.responsiveRow, isMobile && styles.responsiveRowMobile]}>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Full Name *</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="e.g. Alex Johnson"
                    value={profile.fullName}
                    onChangeText={(val) => setProfile(p => ({ ...p, fullName: val }))}
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Professional Headline / Target Role</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="e.g. Senior Full-Stack Engineer | AI & Cloud"
                    value={profile.headline}
                    onChangeText={(val) => setProfile(p => ({ ...p, headline: val }))}
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>

              {/* Row 2: Email & Phone Number */}
              <View style={[styles.responsiveRow, isMobile && styles.responsiveRowMobile]}>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Email Address (Recruiter Contact) *</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="name@example.com"
                    value={profile.email}
                    onChangeText={(val) => setProfile(p => ({ ...p, email: val }))}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Phone Number (with Country Code) *</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="+1 (555) 019-2834"
                    value={profile.phone}
                    onChangeText={(val) => setProfile(p => ({ ...p, phone: val }))}
                    keyboardType="phone-pad"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>

              {/* Row 3: Portfolio & LinkedIn */}
              <View style={[styles.responsiveRow, isMobile && styles.responsiveRowMobile]}>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Portfolio / Personal Website URL *</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="https://yourportfolio.dev"
                    value={profile.portfolio}
                    onChangeText={(val) => setProfile(p => ({ ...p, portfolio: val }))}
                    autoCapitalize="none"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>LinkedIn Profile URL *</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="https://linkedin.com/in/username"
                    value={profile.linkedin}
                    onChangeText={(val) => setProfile(p => ({ ...p, linkedin: val }))}
                    autoCapitalize="none"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>

              {/* Row 4: GitHub & Location */}
              <View style={[styles.responsiveRow, isMobile && styles.responsiveRowMobile]}>
                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>GitHub Profile URL</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="https://github.com/username"
                    value={profile.github}
                    onChangeText={(val) => setProfile(p => ({ ...p, github: val }))}
                    autoCapitalize="none"
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Location / Relocation Preferences</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="e.g. San Francisco, CA / Remote"
                    value={profile.location}
                    onChangeText={(val) => setProfile(p => ({ ...p, location: val }))}
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>

              {/* Row 5: Candidate Bio / Executive Summary */}
              <View style={styles.formGroup}>
                <Text style={styles.label}>Executive Summary / Key Highlights (Context for AI Pitch)</Text>
                <TextInput
                  style={[styles.webInput, styles.textArea]}
                  placeholder="e.g. Seasoned software engineer with 6+ years specializing in Next.js, React, Node.js, and cloud architectures. Passionate about AI-driven developer tooling..."
                  value={profile.bio}
                  onChangeText={(val) => setProfile(p => ({ ...p, bio: val }))}
                  multiline
                  numberOfLines={3}
                  placeholderTextColor="#9ca3af"
                />
              </View>

              {/* Live Email Signature Preview Card */}
              <View style={{ marginTop: 10, marginBottom: 20, padding: 18, backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    Email signature preview
                  </Text>
                  <View style={{ marginLeft: 8, backgroundColor: '#dbeafe', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#1d4ed8' }}>Auto-injected into Applications</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
                  This professional signature will automatically close out every generated cover letter & email:
                </Text>

                <View style={{ padding: 16, backgroundColor: '#ffffff', borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
                    {profile.fullName || 'Candidate Full Name'}
                  </Text>
                  {profile.headline ? (
                    <Text style={{ fontSize: 13, color: '#2563eb', fontWeight: '600', marginTop: 2 }}>
                      {profile.headline}
                    </Text>
                  ) : null}

                  <View style={{ marginTop: 10, gap: 5 }}>
                    {profile.email ? <Text style={{ fontSize: 13, color: '#475569' }}>Email · {profile.email}</Text> : null}
                    {profile.phone ? <Text style={{ fontSize: 13, color: '#475569' }}>Phone · {profile.phone}</Text> : null}
                    {profile.portfolio ? <Text style={{ fontSize: 13, color: '#2563eb' }}>Portfolio · {profile.portfolio}</Text> : null}
                    {profile.linkedin ? <Text style={{ fontSize: 13, color: '#2563eb' }}>LinkedIn · {profile.linkedin}</Text> : null}
                    {profile.github ? <Text style={{ fontSize: 13, color: '#2563eb' }}>GitHub · {profile.github}</Text> : null}
                    {profile.location ? <Text style={{ fontSize: 13, color: '#64748b' }}>Location · {profile.location}</Text> : null}
                  </View>
                </View>
              </View>

              {/* Save Button */}
              <View style={styles.cardActionRow}>
                <TouchableOpacity 
                  style={[styles.sectionSaveBtn, isSavingProfile && styles.disabledButton]}
                  onPress={handleSaveProfile}
                  disabled={isSavingProfile}
                >
                  {isSavingProfile ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.sectionSaveBtnText}>Save profile</Text>
                  )}
                </TouchableOpacity>
                {profileFeedback ? <Text style={styles.sectionFeedbackText}>{profileFeedback}</Text> : null}
              </View>
            </View>
          </View>
        )}

        {/* ================= TAB 3: APPLICATION HISTORY ================= */}
        {activeTab === 'history' && (
          <View style={styles.pageContainer}>
            <View style={[styles.historyHeader, isMobile && styles.historyHeaderMobile]}>
              <View>
                <Text style={styles.cardTitle}>Application History & Records</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <Text style={styles.cardDescription}>
                    Track all past job submissions, pitches, and responses.
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ecfdf5', paddingVertical: 3, paddingHorizontal: 9, borderRadius: 12, borderWidth: 1, borderColor: '#a7f3d0' }}>
                    <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#10b981', marginRight: 6 }} />
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#047857' }}>Live Synced with DB</Text>
                  </View>
                </View>
              </View>

              <View style={[styles.historyTools, isMobile && styles.historyToolsMobile]}>
                <TextInput
                  style={[styles.webInput, styles.historySearch, isMobile && styles.historySearchMobile]}
                  placeholder="Search company, title, or email"
                  value={historySearch}
                  onChangeText={setHistorySearch}
                  placeholderTextColor="#9ca3af"
                />

                <TouchableOpacity 
                  style={[styles.tableActionBtn, { backgroundColor: '#f8fafc', paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                  onPress={handleSyncHistory}
                  disabled={isSyncingHistory}
                >
                  {isSyncingHistory ? (
                    <ActivityIndicator size="small" color="#2563eb" />
                  ) : (
                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#2563eb' }}>Sync database</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Quick Stats */}
            <View style={[styles.statsRow, isMobile && styles.statsRowMobile]}>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{applications.length}</Text>
                <Text style={styles.statLabel}>Total Applications</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNumber, { color: '#059669' }]}>
                  {applications.filter(a => a.status === 'Applied').length}
                </Text>
                <Text style={styles.statLabel}>Emails Sent</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNumber, { color: '#7c3aed' }]}>
                  {applications.filter(a => a.status === 'Interviewing' || a.status === 'Accepted').length}
                </Text>
                <Text style={styles.statLabel}>Interviewing / Accepted</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNumber, { color: '#d97706' }]}>
                  {applications.filter(a => a.status === 'Generated' || a.status === 'Draft' || a.status === 'Generating').length}
                </Text>
                <Text style={styles.statLabel}>Drafts / Prepared</Text>
              </View>
            </View>

            {filteredApps.length === 0 ? (
              <View style={styles.emptyHistoryBox}>
                <Text style={styles.emptyPreviewMark}>0</Text>
                <Text style={styles.emptyPreviewTitle}>No applications found</Text>
                <Text style={styles.emptyPreviewSub}>
                  {applications.length === 0 
                    ? "You haven't submitted any applications yet. Go to 'Apply for Job' to create one!" 
                    : "No records match your search query."}
                </Text>
                {applications.length === 0 && (
                  <TouchableOpacity 
                    style={[styles.webPrimaryButton, { marginTop: 16, width: 220 }]}
                    onPress={() => setActiveTab('apply')}
                  >
                    <Text style={styles.webPrimaryButtonText}>Create New Application</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.tableCard}>
                {filteredApps.map((item) => {
                  const badgeStyle = getStatusBadgeStyle(item.status);
                  return (
                    <View key={item.id} style={[styles.tableRow, isMobile && styles.tableRowMobile]}>
                      <View style={{ flex: 2 }}>
                        <Text style={styles.rowTitle}>{item.jobTitle}</Text>
                        <Text style={styles.rowCompany}>{item.companyName} • {item.recipientEmail || 'No recipient email'}</Text>
                        <Text style={styles.rowDate}>
                          Created: {new Date(item.createdAt).toLocaleDateString()} at {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {item.appliedAt ? ` • Applied: ${new Date(item.appliedAt).toLocaleDateString()}` : ''}
                        </Text>
                      </View>

                      <View style={{ alignItems: isMobile ? 'flex-start' : 'flex-end', justifyContent: 'center' }}>
                        {(item.tailoredAtsScore ?? item.atsScore) !== null ? (
                          <View style={styles.atsScorePill}>
                            <Text style={styles.atsScorePillValue}>{item.tailoredAtsScore ?? item.atsScore}%</Text>
                            <Text style={styles.atsScorePillLabel}>ATS match</Text>
                          </View>
                        ) : null}
                        <View style={{ marginBottom: 6 }}>
                          <select
                            value={item.status || 'Generated'}
                            onChange={(e) => handleStatusChange(item.id, e.target.value)}
                            style={{
                              cursor: 'pointer',
                              padding: '4px 10px',
                              borderRadius: '16px',
                              border: `1px solid ${badgeStyle.border}`,
                              backgroundColor: badgeStyle.backgroundColor,
                              color: badgeStyle.color,
                              fontSize: '12px',
                              fontWeight: '700',
                              outline: 'none',
                            }}
                          >
                            <option value="Generating">Generating</option>
                            <option value="Generated">Generated</option>
                            <option value="Applied">Applied</option>
                            <option value="Interviewing">Interviewing</option>
                            <option value="Accepted">Accepted</option>
                            <option value="Rejected">Rejected</option>
                            <option value="Draft">Draft</option>
                          </select>
                        </View>
                        
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                          <TouchableOpacity 
                            style={styles.tableActionBtn}
                            onPress={() => handleOpenRecord(item)}
                          >
                            <Text style={styles.tableActionBtnText}>View</Text>
                          </TouchableOpacity>

                          <TouchableOpacity 
                            style={[styles.tableActionBtn, { borderColor: '#fca5a5' }]}
                            onPress={() => handleDeleteRecord(item.id)}
                          >
                            <Text style={[styles.tableActionBtnText, { color: '#ef4444' }]}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* ================= TAB 3: SETTINGS & APIS ================= */}
        {activeTab === 'settings' && (
          <View style={styles.pageContainer}>
            <Text style={styles.cardTitle}>Settings & API Integrations</Text>
            <Text style={styles.cardDescription}>
              Manage your Resume, AI Provider (OpenAI / LLM API), and Google Console credentials.
            </Text>

            {/* Section 1: Candidate Resume */}
            <View style={[styles.webCard, isMobile && styles.cardMobile]}>
              <View style={[styles.sectionHeader, isMobile && styles.sectionHeaderMobile]}>
                <Text style={styles.sectionTitle}>1. Candidate Resume & Profile</Text>
                <TouchableOpacity style={styles.uploadBtn} onPress={handleUploadResumeWeb}>
                  <Text style={styles.uploadBtnText}>Upload resume (.pdf, .txt, .doc)</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.cardDescription}>
                {settings.resumeName ? `Active Resume: ${settings.resumeName}` : 'No resume uploaded yet.'}
              </Text>

              <View style={styles.formGroup}>
                <Text style={styles.label}>Resume Text Content / Key Highlights</Text>
                <TextInput
                  style={[styles.webInput, styles.textArea, { height: 140 }]}
                  placeholder="Paste your resume summary, work experience, projects, and skills here so the AI can use it..."
                  value={settings.resumeContent}
                  onChangeText={(text) => setSettings(prev => ({ ...prev, resumeContent: text }))}
                  multiline
                  placeholderTextColor="#9ca3af"
                />
              </View>

              <View style={styles.cardActionRow}>
                <TouchableOpacity 
                  style={[styles.sectionSaveBtn, isSavingResume && styles.disabledButton]}
                  onPress={() => handleSaveSection('resume')}
                  disabled={isSavingResume}
                >
                  {isSavingResume ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.sectionSaveBtnText}>Save resume</Text>
                  )}
                </TouchableOpacity>
                {resumeFeedback ? <Text style={styles.sectionFeedbackText}>{resumeFeedback}</Text> : null}
              </View>
            </View>

            {/* Section 2: LLM API Configuration */}
            <View style={[styles.webCard, isMobile && styles.cardMobile]}>
              <View style={[styles.sectionHeader, isMobile && styles.sectionHeaderMobile, { marginBottom: 6 }] }>
                <Text style={styles.sectionTitle}>2. AI Model & Frontier LLM Integration</Text>
                <View style={{ backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#bbf7d0' }}>
                  <Text style={styles.securityLabel}>Stored securely</Text>
                </View>
              </View>
              <Text style={styles.cardDescription}>
                Configure frontier AI models (Google Gemini, OpenAI, or Groq) to power deep ATS Match Analysis and intelligent Resume Optimization.
              </Text>

              <View style={{ backgroundColor: '#f8fafc', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 18 }}>
                <Text style={{ fontSize: 13, color: '#334155', lineHeight: 20 }}>
                  <Text style={{ fontWeight: '700' }}>Frontier AI vs Local Engine:</Text> When an API key is provided below, your ATS analysis and resume tailoring will be executed with the selected LLM. If left blank, our enhanced Smart Local ATS Engine is automatically used.
                </Text>
              </View>

              <View style={[styles.formRow, isMobile && styles.formRowMobile]}>
                <View style={[styles.formGroup, { flex: 1 }, !isMobile && { marginRight: 14 }]}>
                  <Text style={styles.label}>AI Provider</Text>
                  <select
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#ffffff',
                      color: '#0f172a',
                      fontSize: '14px',
                      fontWeight: '500',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                    value={settings.llmProvider || 'Gemini'}
                    onChange={(e) => {
                      const selectedProv = e.target.value;
                      const defaultModel = LLM_PROVIDERS_CONFIG[selectedProv]?.defaultModel || '';
                      setSettings(prev => ({
                        ...prev,
                        llmProvider: selectedProv,
                        llmModel: defaultModel,
                      }));
                    }}
                  >
                    {Object.keys(LLM_PROVIDERS_CONFIG).map((provKey) => (
                      <option key={provKey} value={provKey}>
                        {LLM_PROVIDERS_CONFIG[provKey].name}
                      </option>
                    ))}
                  </select>
                </View>

                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Target Model ({settings.llmProvider})</Text>
                  <select
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      backgroundColor: '#ffffff',
                      color: '#0f172a',
                      fontSize: '14px',
                      fontWeight: '500',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                    value={settings.llmModel || LLM_PROVIDERS_CONFIG[settings.llmProvider]?.defaultModel || ''}
                    onChange={(e) => setSettings(prev => ({ ...prev, llmModel: e.target.value }))}
                  >
                    {(LLM_PROVIDERS_CONFIG[settings.llmProvider]?.models || []).map((modelItem) => (
                      <option key={modelItem.id} value={modelItem.id}>
                        {modelItem.label}
                      </option>
                    ))}
                  </select>
                </View>
              </View>

              {/* API Key Input Field */}
              <View style={[styles.formGroup, { marginTop: 12 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.label}>{settings.llmProvider} API Key (Optional)</Text>
                  {LLM_PROVIDERS_CONFIG[settings.llmProvider]?.helpUrl ? (
                    <a
                      href={LLM_PROVIDERS_CONFIG[settings.llmProvider].helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#166534', fontWeight: '600', textDecoration: 'underline' }}
                    >
                      Get {settings.llmProvider} Key
                    </a>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', position: 'relative' }}>
                  <TextInput
                    style={[styles.webInput, { flex: 1, paddingRight: 75, fontFamily: 'monospace' }]}
                    placeholder={LLM_PROVIDERS_CONFIG[settings.llmProvider]?.placeholder || 'Enter API Key'}
                    value={settings.llmApiKey || ''}
                    onChangeText={(text) => setSettings(prev => ({ ...prev, llmApiKey: text.trim() }))}
                    secureTextEntry={!showLlmApiKey}
                    autoCapitalize="none"
                    placeholderTextColor="#9ca3af"
                  />
                  <TouchableOpacity
                    style={{
                      position: 'absolute',
                      right: 12,
                      paddingVertical: 6,
                      paddingHorizontal: 8,
                      backgroundColor: '#f1f5f9',
                      borderRadius: 6,
                    }}
                    onPress={() => setShowLlmApiKey(prev => !prev)}
                  >
                    <Text style={{ fontSize: 12, color: '#475569', fontWeight: '600' }}>
                      {showLlmApiKey ? 'Hide' : 'Show'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 5 }}>
                  {settings.llmApiKey
                    ? 'Frontier LLM is active for ATS scoring and resume optimization.'
                    : 'Currently using the Smart Local ATS & Optimizer engine (no API key required).'}
                </Text>
              </View>

              <View style={styles.cardActionRow}>
                <TouchableOpacity 
                  style={[styles.sectionSaveBtn, isSavingLlm && styles.disabledButton]}
                  onPress={() => handleSaveSection('llm')}
                  disabled={isSavingLlm}
                >
                  {isSavingLlm ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.sectionSaveBtnText}>Save AI preferences</Text>
                  )}
                </TouchableOpacity>
                {llmFeedback ? <Text style={styles.sectionFeedbackText}>{llmFeedback}</Text> : null}
              </View>
            </View>

            {/* Section 3: Google Console / Gmail API */}
            <View style={[styles.webCard, isMobile && styles.cardMobile]}>
              <View style={styles.sectionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>3. Gmail Account Connection</Text>
                  <Text style={styles.cardDescription}>
                    Connect your Gmail with 1 click. The AI agent will automatically send job applications on your behalf.
                  </Text>
                </View>
              </View>

              <View style={{ marginTop: 8, padding: 16, backgroundColor: settings.googleConnectedAt ? '#f0fdf4' : '#f8fafc', borderRadius: 8, borderWidth: 1, borderColor: settings.googleConnectedAt ? '#bbf7d0' : '#e2e8f0' }}>
                {!settings.googleConnectedAt ? (
                  <View style={{ flexDirection: 'column', gap: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#94a3b8' }} />
                      <Text style={{ fontSize: 14, color: '#475569', fontWeight: '500' }}>
                        Status: <Text style={{ fontWeight: '700', color: '#64748b' }}>Not Connected</Text>
                      </Text>
                    </View>
                    <Text style={{ fontSize: 13, color: '#64748b' }}>
                      Click below to link your Gmail account securely. No client IDs or passwords required.
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
                      <TouchableOpacity
                        style={[styles.sectionSaveBtn, { backgroundColor: '#1a73e8', paddingHorizontal: 20 }]}
                        onPress={handleConnectGmail}
                      >
                        <Text style={[styles.sectionSaveBtnText, { fontWeight: '600' }]}>Connect with Gmail</Text>
                      </TouchableOpacity>
                      {googleFeedback ? <Text style={styles.sectionFeedbackText}>{googleFeedback}</Text> : null}
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'column', gap: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#10b981' }} />
                      <Text style={{ fontSize: 14, color: '#166534', fontWeight: '600' }}>
                        Connected as {settings.googleSenderEmail || session?.user?.email}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 12, color: '#15803d' }}>
                      Active connection since {new Date(settings.googleConnectedAt).toLocaleDateString()}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
                      <TouchableOpacity
                        onPress={handleConnectGmail}
                        style={{ paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#e2e8f0', borderRadius: 6 }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '600', color: '#1e293b' }}>Reconnect Account</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleDisconnectGmail}
                        style={{ paddingVertical: 8, paddingHorizontal: 14, backgroundColor: '#fee2e2', borderRadius: 6 }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: '600', color: '#dc2626' }}>Disconnect</Text>
                      </TouchableOpacity>
                      {googleFeedback ? <Text style={styles.sectionFeedbackText}>{googleFeedback}</Text> : null}
                    </View>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ================= TAB 4: RESUME MANAGEMENT & AI TAILORING ================= */}
        {activeTab === 'resume' && (
          <View style={[styles.pageContainer, { maxWidth: 1200 }]}>
            <View style={[styles.webCard, isMobile && styles.cardMobile]}>
              {/* Resume Card Header */}
              <View style={{ flexDirection: isCompact ? 'column' : 'row', justifyContent: 'space-between', alignItems: isCompact ? 'flex-start' : 'center', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingBottom: 16, marginBottom: 20, gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <Text style={{ fontSize: 20, fontWeight: '800', color: '#0f172a' }}>Your Resume</Text>
                    <View style={{ backgroundColor: '#dbeafe', paddingHorizontal: 10, paddingVertical: 2, borderRadius: 12 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#1e40af' }}>
                        {settings.resumeName || 'Primary Resume'}
                      </Text>
                    </View>
                    {settings.resumeContent ? (
                      <View style={{ backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#166534' }}>✓ Synced</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 13, color: '#64748b' }}>
                    Review, edit, and optimize your resume. Our AI agent tailors your resume keywords and summary to match job postings.
                  </Text>
                </View>

                {/* Action Controls */}
                <View style={[styles.resumeToolbar, isMobile && styles.resumeToolbarMobile]}>
                  {/* Mode Switcher */}
                  <View style={[styles.resumeModeSwitcher, isMobile && styles.resumeModeSwitcherMobile]}>
                    <TouchableOpacity
                      style={[styles.resumeModeButton, isMobile && styles.resumeModeButtonMobile, resumeViewMode === 'pdf' && styles.resumeModeButtonActive]}
                      onPress={() => {
                        setResumeViewMode('pdf');
                        if (!resumePdfUrl) loadResumePdfUrl();
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: resumeViewMode === 'pdf' ? '#0f172a' : '#64748b' }}>
                        PDF
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.resumeModeButton, isMobile && styles.resumeModeButtonMobile, resumeViewMode === 'preview' && styles.resumeModeButtonActive]}
                      onPress={() => setResumeViewMode('preview')}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: resumeViewMode === 'preview' ? '#0f172a' : '#64748b' }}>
                        ATS text
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.resumeModeButton, isMobile && styles.resumeModeButtonMobile, resumeViewMode === 'edit' && styles.resumeModeButtonActive]}
                      onPress={() => {
                        setResumeEditText(settings.resumeContent || '');
                        setResumeViewMode('edit');
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: resumeViewMode === 'edit' ? '#0f172a' : '#64748b' }}>
                        Edit
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Quick Action Buttons */}
                  <TouchableOpacity
                    style={[styles.resumeActionButton, styles.resumeActionButtonPrimary, isMobile && styles.resumeActionButtonMobile]}
                    onPress={handleTailorResumeForCurrentJob}
                    disabled={isTailoringResume}
                  >
                    {isTailoringResume ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.resumeActionButtonTextPrimary}>Tailor for {jobTitle ? `"${jobTitle}"` : 'job'}</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.resumeActionButton, isMobile && styles.resumeActionButtonMobile]}
                    onPress={() => {
                      const textToCopy = settings.resumeContent || resumeEditText;
                      if (textToCopy) handleCopy(textToCopy);
                      else showError('No resume content to copy.', 'Notice');
                    }}
                  >
                    <Text style={styles.resumeActionButtonTextSecondary}>Copy text</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.resumeActionButton, isMobile && styles.resumeActionButtonMobile]}
                    onPress={handleDownloadResume}
                  >
                    <Text style={styles.resumeActionButtonTextSecondary}>Download</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.resumeActionButton, isMobile && styles.resumeActionButtonMobile]}
                    onPress={handleSyncResumeFromBucket}
                    disabled={isSyncingBucket}
                  >
                    {isSyncingBucket ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <Text style={styles.resumeActionButtonTextSecondary}>Sync cloud</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.resumeActionButton, isMobile && styles.resumeActionButtonMobile]}
                    onPress={handleUploadResumeWeb}
                  >
                    <Text style={styles.resumeActionButtonTextSecondary}>Upload new</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* AI Tailoring Result Insights Banner */}
              {resumeTailorResult && (
                <View style={{ backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#86efac', borderRadius: 12, padding: 16, marginBottom: 20 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#166534' }}>
                      Resume tailored by AI agent
                    </Text>
                    <View style={{ backgroundColor: '#bbf7d0', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#14532d' }}>
                        Source: {resumeTailorResult.source === 'python-agent' ? 'LangGraph Agent' : 'Smart Tailor Engine'}
                      </Text>
                    </View>
                  </View>

                  {resumeTailorResult.matchedSkills && resumeTailorResult.matchedSkills.length > 0 && (
                    <View style={{ marginBottom: 10 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#15803d', marginBottom: 6 }}>
                        Matched Job Requirements & Skills:
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {resumeTailorResult.matchedSkills.map((sk, idx) => (
                          <View key={idx} style={{ backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#86efac', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                            <Text style={{ fontSize: 11, fontWeight: '600', color: '#166534' }}>✓ {sk}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {resumeTailorResult.enhancements && (
                    <View>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#15803d', marginBottom: 4 }}>
                        Optimizations Applied:
                      </Text>
                      {resumeTailorResult.enhancements.map((enh, idx) => (
                        <Text key={idx} style={{ fontSize: 12, color: '#166534', lineHeight: 18 }}>
                          • {enh}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Resume Content Body: PDF Viewer, Text Preview, or Editor */}
              {resumeViewMode === 'pdf' ? (
                <View style={{ gap: 12 }}>
                  {/* PDF Toolbar */}
                  <View style={{ flexDirection: isCompact ? 'column' : 'row', justifyContent: 'space-between', alignItems: isCompact ? 'flex-start' : 'center', backgroundColor: '#f8fafc', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>
                        {settings.resumeName || 'Resume.pdf'}
                      </Text>
                      <View style={{ backgroundColor: '#fee2e2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ fontSize: 10, fontWeight: '800', color: '#b91c1c' }}>PDF DOCUMENT</Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {resumePdfUrl ? (
                        <a
                          href={resumePdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '6px 12px',
                            backgroundColor: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: '6px',
                            color: '#1d4ed8',
                            fontSize: '12px',
                            fontWeight: '600',
                            textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          ↗ Open in New Window
                        </a>
                      ) : null}

                      {resumePdfUrl ? (
                        <a
                          href={resumePdfUrl}
                          download={settings.resumeName || 'Resume.pdf'}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '6px 12px',
                            backgroundColor: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            color: '#334155',
                            fontSize: '12px',
                            fontWeight: '600',
                            textDecoration: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          Download PDF
                        </a>
                      ) : null}

                      <TouchableOpacity
                        style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#f1f5f9', borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0' }}
                        onPress={() => loadResumePdfUrl()}
                      >
                        <Text style={{ fontSize: 12, color: '#475569', fontWeight: '600' }}>Reload</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* High-Fidelity Embedded PDF Viewer */}
                  {resumePdfUrl ? (
                    <div style={{ width: '100%', height: isMobile ? '68vh' : '820px', minHeight: isMobile ? '460px' : '620px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #cbd5e1', boxShadow: '0 4px 12px rgba(0,0,0,0.06)', backgroundColor: '#525659' }}>
                      <iframe
                        src={`${resumePdfUrl}#toolbar=1&navpanes=1`}
                        title={settings.resumeName || 'Resume PDF Document'}
                        width="100%"
                        height="100%"
                        style={{ border: 'none', display: 'block' }}
                      />
                    </div>
                  ) : (
                    <View style={{ paddingVertical: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' }}>
                      {isLoadingPdf ? (
                        <View style={{ alignItems: 'center' }}>
                          <ActivityIndicator size="large" color="#2563eb" style={{ marginBottom: 12 }} />
                          <Text style={{ fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 4 }}>
                            Generating Secure PDF Link...
                          </Text>
                          <Text style={{ fontSize: 12, color: '#64748b' }}>
                            Accessing your resume from Supabase Storage bucket
                          </Text>
                        </View>
                      ) : (
                        <View style={{ alignItems: 'center' }}>
                          <Text style={styles.emptyPreviewMark}>PDF</Text>
                          <Text style={{ fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 6 }}>
                            No PDF Document URL Available
                          </Text>
                          <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center', maxWidth: 380, marginBottom: 16 }}>
                            Sync with your cloud storage bucket to load and view your exact PDF resume.
                          </Text>
                          <TouchableOpacity
                            style={[styles.resumeActionButton, { backgroundColor: '#0284c7', paddingHorizontal: 20 }]}
                            onPress={handleSyncResumeFromBucket}
                          >
                            <Text style={styles.resumeActionButtonTextPrimary}>Load resume from cloud</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              ) : resumeViewMode === 'edit' ? (
                <View style={{ gap: 12 }}>
                  <View style={{ flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>
                      Edit Resume Content (Markdown / Plain Text):
                    </Text>
                    <Text style={{ fontSize: 12, color: '#64748b' }}>
                      {resumeEditText.length} characters • {resumeEditText.split('\n').length} lines
                    </Text>
                  </View>

                  <TextInput
                    style={[
                      styles.webInput,
                      {
                        minHeight: 460,
                        fontFamily: 'monospace',
                        fontSize: 13,
                        lineHeight: 20,
                        padding: 16,
                        backgroundColor: '#f8fafc',
                        color: '#0f172a',
                      },
                    ]}
                    value={resumeEditText}
                    onChangeText={setResumeEditText}
                    multiline
                    placeholder="Paste or write your full resume here..."
                    placeholderTextColor="#94a3b8"
                  />

                  <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
                    <TouchableOpacity
                      style={[styles.resumeActionButton, { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1' }]}
                      onPress={() => {
                        setResumeEditText(settings.resumeContent || '');
                        setResumeViewMode(resumePdfUrl ? 'pdf' : 'preview');
                      }}
                    >
                      <Text style={{ color: '#475569', fontWeight: '600', fontSize: 13 }}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.resumeActionButton, { backgroundColor: '#10b981', paddingHorizontal: 24 }]}
                      onPress={handleSaveResumeEdits}
                      disabled={isSavingResumeText}
                    >
                      {isSavingResumeText ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text style={styles.resumeActionButtonText}>Save changes</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                /* Formatted Clean Document View */
                <View style={styles.resumePaper}>
                  {settings.resumeContent ? (
                    <ScrollView style={{ maxHeight: 650 }}>
                      <Text style={styles.resumePaperText}>
                        {settings.resumeContent}
                      </Text>
                    </ScrollView>
                  ) : (
                    <View style={{ paddingVertical: 48, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={styles.emptyPreviewMark}>CV</Text>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 6 }}>
                        No Resume Content Loaded Yet
                      </Text>
                      <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', maxWidth: 440, marginBottom: 20 }}>
                        Upload your resume file (.txt, .pdf, .docx), or let the AI Tailor Agent generate a targeted baseline using your profile.
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                        <TouchableOpacity
                          style={[styles.resumeActionButton, { backgroundColor: '#0284c7', paddingHorizontal: 18 }]}
                          onPress={handleSyncResumeFromBucket}
                          disabled={isSyncingBucket}
                        >
                          {isSyncingBucket ? (
                            <ActivityIndicator size="small" color="#ffffff" />
                          ) : (
                            <Text style={styles.resumeActionButtonTextPrimary}>Load from cloud</Text>
                          )}
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.resumeActionButton, { backgroundColor: '#2563eb' }]}
                          onPress={handleUploadResumeWeb}
                        >
                          <Text style={styles.resumeActionButtonTextPrimary}>Upload resume</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.resumeActionButton, { backgroundColor: '#10b981' }]}
                          onPress={handleTailorResumeForCurrentJob}
                        >
                          <Text style={styles.resumeActionButtonTextPrimary}>Generate baseline</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Record Detail Modal with Human Correction / Edit Mode */}
      {selectedRecord && (
        <Modal transparent animationType="fade" visible={!!selectedRecord}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  {!isEditingApplication ? (
                    <>
                      <Text style={styles.modalTitle}>{selectedRecord.jobTitle}</Text>
                      <Text style={styles.modalSub}>{selectedRecord.companyName} • {selectedRecord.recipientEmail || 'No recipient email'}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>Status:</Text>
                        <select
                          value={selectedRecord.status || 'Generated'}
                          onChange={(e) => handleStatusChange(selectedRecord.id, e.target.value)}
                          style={{
                            cursor: 'pointer',
                            padding: '4px 10px',
                            borderRadius: '16px',
                            border: `1px solid ${getStatusBadgeStyle(selectedRecord.status).border}`,
                            backgroundColor: getStatusBadgeStyle(selectedRecord.status).backgroundColor,
                            color: getStatusBadgeStyle(selectedRecord.status).color,
                            fontSize: '12px',
                            fontWeight: '700',
                            outline: 'none',
                          }}
                        >
                          <option value="Generating">Generating</option>
                          <option value="Generated">Generated</option>
                          <option value="Applied">Applied</option>
                          <option value="Interviewing">Interviewing</option>
                          <option value="Accepted">Accepted</option>
                          <option value="Rejected">Rejected</option>
                          <option value="Draft">Draft</option>
                        </select>
                        {selectedRecord.appliedAt && (
                          <Text style={{ fontSize: 11, color: '#059669', fontWeight: '500' }}>
                            Applied on {new Date(selectedRecord.appliedAt).toLocaleDateString()}
                          </Text>
                        )}
                      </View>
                    </>
                  ) : (
                    <View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f172a' }}>Edit Application Details</Text>
                        <View style={{ backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#b45309' }}>Human Correction Mode</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 12, color: '#64748b' }}>
                        Modify any role title, company, recipient email, or email pitch below.
                      </Text>
                    </View>
                  )}
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: isEditingApplication ? '#2563eb' : '#cbd5e1',
                      backgroundColor: isEditingApplication ? '#eff6ff' : '#ffffff',
                    }}
                    onPress={() => {
                      if (!isEditingApplication) {
                        setEditForm({
                          jobTitle: selectedRecord.jobTitle || '',
                          companyName: selectedRecord.companyName || '',
                          recipientEmail: selectedRecord.recipientEmail || '',
                          generatedEmail: htmlToPlainText(selectedRecord.generatedEmail),
                        });
                        setIsEditingApplication(true);
                      } else {
                        setIsEditingApplication(false);
                      }
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: isEditingApplication ? '#2563eb' : '#475569' }}>
                      {isEditingApplication ? 'Preview' : 'Edit'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setSelectedRecord(null)} style={styles.closeBtn}>
                    <Text style={styles.closeBtnText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {isEditingApplication ? (
                <ScrollView style={{ maxHeight: 420, marginVertical: 14 }}>
                  <View style={{ gap: 12, paddingRight: 4 }}>
                    <View style={{ flexDirection: isCompact ? 'column' : 'row', gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 4 }}>Job Title</Text>
                        <TextInput
                          style={[styles.webInput, { height: 38 }]}
                          value={editForm.jobTitle}
                          onChangeText={(val) => setEditForm(prev => ({ ...prev, jobTitle: val }))}
                          placeholder="e.g. Associate Software Engineer"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 4 }}>Company Name</Text>
                        <TextInput
                          style={[styles.webInput, { height: 38 }]}
                          value={editForm.companyName}
                          onChangeText={(val) => setEditForm(prev => ({ ...prev, companyName: val }))}
                          placeholder="e.g. Neuralige"
                        />
                      </View>
                    </View>

                    <View>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 4 }}>Recipient Email</Text>
                      <TextInput
                        style={[styles.webInput, { height: 38 }]}
                        value={editForm.recipientEmail}
                        onChangeText={(val) => setEditForm(prev => ({ ...prev, recipientEmail: val }))}
                        placeholder="e.g. hr@neuralige.com"
                        keyboardType="email-address"
                      />
                    </View>

                    <View>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 4 }}>
                        Application Email Pitch (Editable Subject & Body)
                      </Text>
                      <TextInput
                        multiline
                        style={[
                          styles.webInput,
                          {
                            minHeight: 240,
                            maxHeight: 380,
                            textAlignVertical: 'top',
                            fontSize: 13,
                            lineHeight: 20,
                            fontFamily: 'monospace',
                          },
                        ]}
                        value={editForm.generatedEmail}
                        onChangeText={(val) => setEditForm(prev => ({ ...prev, generatedEmail: val }))}
                        placeholder="Edit greeting, personalized pitch, key bullets, or signature..."
                      />
                    </View>
                  </View>
                </ScrollView>
              ) : (
                <View style={{
                  flexDirection: isCompact ? 'column' : 'row',
                  gap: 20,
                  marginVertical: 16,
                  alignItems: 'stretch',
                }}>
                  {/* Left Column: ATS Analytics */}
                  <View style={{ flex: 1.15, minWidth: isCompact ? '100%' : 440 }}>
                    <View style={{ marginBottom: 6 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#536159', letterSpacing: 0.6 }}>
                        ATS MATCH REPORT
                      </Text>
                    </View>
                    <ScrollView style={{ maxHeight: isCompact ? 380 : 540 }} showsVerticalScrollIndicator={true}>
                      {selectedRecord.isLoadingAts ? (
                        <View style={{ paddingVertical: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' }}>
                          <ActivityIndicator size="small" color="#416353" style={{ marginBottom: 10 }} />
                          <Text style={{ fontSize: 13, color: '#64748b' }}>Analyzing resume match for this job...</Text>
                        </View>
                      ) : (selectedRecord.tailoredAtsReport || selectedRecord.atsReport) ? (
                        <View style={{ marginTop: -14 }}>
                          <AtsDashboard
                            compact
                            report={selectedRecord.tailoredAtsReport || selectedRecord.atsReport}
                            previousScore={selectedRecord.tailoredAtsReport ? selectedRecord.atsScore : null}
                          />
                        </View>
                      ) : (
                        <View style={{ paddingVertical: 36, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', minHeight: 240 }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#334155', marginBottom: 4 }}>
                            No ATS analysis available
                          </Text>
                          <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center', maxWidth: 300, lineHeight: 18 }}>
                            Run ATS analysis from the Apply tab to view match breakdown and recommendations.
                          </Text>
                        </View>
                      )}
                    </ScrollView>
                  </View>

                  {/* Right Column: Application Email */}
                  <View style={{ flex: 1, minWidth: isCompact ? '100%' : 400 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#536159', letterSpacing: 0.6 }}>
                        APPLICATION EMAIL
                      </Text>
                      {selectedRecord.generatedEmail ? (
                        <TouchableOpacity 
                          onPress={() => handleCopy(htmlToPlainText(selectedRecord.generatedEmail))}
                          style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, backgroundColor: '#f1f5f9' }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '600', color: '#475569' }}>Copy</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={{ 
                      flex: 1, 
                      backgroundColor: '#f8fafc', 
                      borderRadius: 10, 
                      borderWidth: 1, 
                      borderColor: '#e2e8f0', 
                      padding: 16,
                      minHeight: isCompact ? 220 : 500,
                    }}>
                      {selectedRecord.isLoadingEmail ? (
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 }}>
                          <ActivityIndicator size="small" color="#2563eb" style={{ marginBottom: 10 }} />
                          <Text style={{ fontSize: 13, color: '#64748b' }}>Loading email content...</Text>
                        </View>
                      ) : selectedRecord.generatedEmail ? (
                        <ScrollView style={{ maxHeight: isCompact ? 320 : 490 }} showsVerticalScrollIndicator={true}>
                          {selectedRecord.generatedEmail.includes('<') && selectedRecord.generatedEmail.includes('>') ? (
                            <RenderHtml
                              contentWidth={isCompact ? width : Math.min(width * 0.42, 500)}
                              source={{ html: selectedRecord.generatedEmail }}
                              baseStyle={{ color: '#334155', fontSize: 14, lineHeight: 22 }}
                            />
                          ) : (
                            <Text style={{ color: '#334155', fontSize: 14, lineHeight: 22, whiteSpace: 'pre-wrap' }}>
                              {selectedRecord.generatedEmail}
                            </Text>
                          )}
                        </ScrollView>
                      ) : (
                        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 36 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: '#1e293b', marginBottom: 4 }}>
                            No application email generated yet
                          </Text>
                          <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', maxWidth: 300 }}>
                            Return to Apply to review the ATS report, optimize the resume, and generate the email.
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              )}

              <View style={styles.modalActions}>
                {isEditingApplication ? (
                  <>
                    <TouchableOpacity 
                      style={styles.actionPill} 
                      onPress={() => setIsEditingApplication(false)}
                    >
                      <Text style={styles.actionPillText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.actionPill, { backgroundColor: '#e0f2fe', borderColor: '#7dd3fc' }]} 
                      onPress={handleSaveEdits}
                      disabled={isSavingEdits}
                    >
                      {isSavingEdits ? (
                        <ActivityIndicator size="small" color="#0369a1" />
                      ) : (
                        <Text style={{ fontSize: 13, fontWeight: '600', color: '#0369a1' }}>Save Changes</Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.actionPill, styles.actionPillPrimary, isSending && styles.disabledButton]} 
                      onPress={() => handleSendEmail(selectedRecord)}
                      disabled={isSending}
                    >
                      {isSending ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text style={styles.actionPillPrimaryText}>Save & Send</Text>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity 
                      style={[styles.actionPill, { backgroundColor: '#f8fafc', borderColor: '#cbd5e1' }]} 
                      onPress={() => {
                        setEditForm({
                          jobTitle: selectedRecord.jobTitle || '',
                          companyName: selectedRecord.companyName || '',
                          recipientEmail: selectedRecord.recipientEmail || '',
                          generatedEmail: htmlToPlainText(selectedRecord.generatedEmail),
                        });
                        setIsEditingApplication(true);
                      }}
                    >
                      <Text style={[styles.actionPillText, { fontWeight: '600', color: '#2563eb' }]}>Edit application</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={styles.actionPill} 
                      onPress={() => handleCopy(htmlToPlainText(selectedRecord.generatedEmail))}
                    >
                      <Text style={styles.actionPillText}>Copy text</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.actionPill, styles.actionPillPrimary, isSending && styles.disabledButton]} 
                      onPress={() => handleSendEmail(selectedRecord)}
                      disabled={isSending}
                    >
                      {isSending ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Text style={styles.actionPillPrimaryText}>Send email</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity 
                  style={[styles.actionPill, { backgroundColor: '#fee2e2' }]} 
                  onPress={() => handleDeleteRecord(selectedRecord.id)}
                >
                  <Text style={{ color: '#ef4444', fontWeight: '600', fontSize: 13 }}>Delete Record</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
      {/* Active Generation Countdown Popup Modal */}
      {showCountdownPopup && (
        <Modal
          transparent
          animationType="fade"
          visible={showCountdownPopup}
          onRequestClose={() => setShowCountdownPopup(false)}
        >
          <View style={styles.countdownModalOverlay}>
            <View style={styles.countdownModalCard}>
              <View style={styles.countdownIconWrapper}>
                <ActivityIndicator size="large" color="#2563eb" />
              </View>

              <Text style={styles.countdownModalTitle}>
                Generating Tailored Email
              </Text>

              <Text style={styles.countdownModalSubtitle}>
                Our AI workflow is analyzing your resume and crafting a tailored pitch for{' '}
                <Text style={{ fontWeight: '700', color: '#17201c' }}>
                  {companyName || jobTitle || 'this role'}
                </Text>.
              </Text>

              <View style={styles.countdownTimerBadge}>
                <Text style={styles.countdownTimerLabel}>TIME ELAPSED</Text>
                <Text style={styles.countdownTimerValue}>
                  {formatTime(generationSeconds)}
                </Text>
              </View>

              <View style={styles.countdownStatusRow}>
                <View style={styles.countdownPulseDot} />
                <Text style={styles.countdownStatusText}>
                  n8n workflow active • Polling database for output...
                </Text>
              </View>

              <TouchableOpacity
                style={styles.countdownDismissBtn}
                onPress={() => setShowCountdownPopup(false)}
              >
                <Text style={styles.countdownDismissBtnText}>Minimize / Run in Background</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Picked Resume Text Preview Modal */}
      <Modal
        transparent
        animationType="fade"
        visible={showPickedResumePreviewModal}
        onRequestClose={() => setShowPickedResumePreviewModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 760, maxHeight: '88%' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <Text style={styles.modalTitle}>Resume Picked for Application</Text>
                  <View style={[styles.pickedBadge, getPickedResume().source === 'tailored' ? styles.pickedBadgeGreen : styles.pickedBadgeBlue]}>
                    <Text style={[styles.pickedBadgeText, getPickedResume().source === 'tailored' ? styles.pickedBadgeTextGreen : styles.pickedBadgeTextBlue]}>
                      {getPickedResume().source === 'tailored' ? '✓ TAILORED ATS RESUME' : 'MASTER RESUME'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.modalSub}>
                  File: {getPickedResume().name} • Storage: {getPickedResume().bucketPath}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setShowPickedResumePreviewModal(false)}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flex: 1, padding: 16, backgroundColor: '#f8fafc', borderRadius: 8, marginVertical: 12 }}>
              <Text style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 18, color: '#1e293b' }} selectable>
                {getPickedResume().content || 'No resume content available.'}
              </Text>
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#e2e8f0' }]}
                onPress={() => {
                  if (typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(getPickedResume().content || '');
                    showSuccess('Resume text copied to clipboard!', 'Copied');
                  }
                }}
              >
                <Text style={[styles.modalBtnText, { color: '#334155' }]}>📋 Copy text</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#10b981' }]}
                onPress={() => setShowPickedResumePreviewModal(false)}
              >
                <Text style={[styles.modalBtnText, { color: '#ffffff' }]}>Confirm & Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom Modern Alert & Popup Modal */}
      <CustomAlertModal
        {...alertConfig}
        onClose={() => setAlertConfig((prev) => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Web Full Screen Container
  webContainer: {
    flex: 1,
    flexDirection: 'row',
    height: '100vh',
    backgroundColor: '#f5f6f3',
  },
  webContainerCompact: {
    flexDirection: 'column',
  },
  leftPanel: {
    flex: 1.2,
    backgroundColor: '#17201c',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 60,
  },
  leftPanelCompact: {
    display: 'none',
  },
  heroContent: {
    maxWidth: 520,
  },
  badge: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#66736c',
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  badgeText: {
    color: '#bac4be',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.4,
  },
  heroTitle: {
    fontSize: 46,
    fontWeight: '600',
    color: '#ffffff',
    lineHeight: 56,
    marginBottom: 20,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#c7d0cb',
    lineHeight: 26,
    marginBottom: 36,
  },
  featureList: {
    gap: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#35413b',
    paddingTop: 16,
  },
  featureIcon: {
    fontSize: 11,
    color: '#93a198',
    letterSpacing: 1,
    marginRight: 18,
  },
  featureText: {
    color: '#e6eae7',
    fontSize: 14,
    fontWeight: '400',
  },
  rightPanel: {
    flex: 1,
    backgroundColor: '#f5f6f3',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  rightPanelCompact: {
    flex: 1,
    padding: 20,
  },
  authCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#ffffff',
    padding: 40,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.035,
    shadowRadius: 22,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#e3e6e1',
  },
  authCardMobile: {
    borderRadius: 10,
    padding: 22,
  },
  authHeader: {
    marginBottom: 24,
  },
  authTitle: {
    fontSize: 28,
    fontWeight: '600',
    color: '#17201c',
    marginBottom: 6,
  },
  authSubtitle: {
    fontSize: 14,
    color: '#6e7772',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorBannerText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '500',
  },
  successBanner: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#6ee7b7',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  successBannerText: {
    color: '#059669',
    fontSize: 13,
    fontWeight: '500',
  },

  // Main App Shell
  webAppContainer: {
    flex: 1,
    backgroundColor: '#f5f6f3',
    height: '100vh',
  },
  webNavbar: {
    backgroundColor: '#ffffff',
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#e3e6e1',
    gap: 24,
  },
  webNavbarCompact: {
    paddingHorizontal: 18,
    gap: 12,
  },
  webNavbarMobile: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandRowMobile: {
    justifyContent: 'space-between',
    width: '100%',
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoBadge: {
    width: 30,
    height: 30,
    backgroundColor: '#17201c',
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  logoBadgeText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
  },
  navbarBrand: {
    fontSize: 18,
    fontWeight: '600',
    color: '#17201c',
  },
  navbarCaption: {
    color: '#7b847f',
    fontSize: 10,
    marginTop: 1,
  },
  navTabsScroller: {
    flexGrow: 0,
    maxWidth: 520,
  },
  navTabsScrollerMobile: {
    width: '100%',
    maxWidth: '100%',
  },
  navTabs: {
    flexDirection: 'row',
    gap: 4,
  },
  navTabsCompact: {
    justifyContent: 'center',
  },
  navTabsMobile: {
    justifyContent: 'space-between',
    minWidth: '100%',
  },
  navTabItem: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  navTabItemActive: {
    backgroundColor: '#eef1ed',
  },
  navTabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#717a75',
  },
  navTabTextActive: {
    color: '#17201c',
  },
  navbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navbarRightCompact: {
    display: 'none',
  },
  userEmail: {
    marginRight: 16,
    color: '#747d78',
    fontSize: 12,
    fontWeight: '400',
  },
  logoutButton: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: '#f1f2ef',
    borderRadius: 6,
  },
  logoutText: {
    color: '#4f5853',
    fontWeight: '500',
    fontSize: 13,
  },
  webContent: {
    padding: 40,
    alignItems: 'center',
  },
  webContentCompact: {
    padding: 14,
  },
  pageContainer: {
    width: '100%',
    maxWidth: 1100,
  },

  // Split Layout for Apply
  splitLayout: {
    flexDirection: 'row',
    gap: 20,
  },
  splitLayoutCompact: {
    flexDirection: 'column',
  },
  responsiveRow: {
    flexDirection: 'row',
    gap: 16,
  },
  responsiveRowMobile: {
    flexDirection: 'column',
    gap: 0,
  },
  flexCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 28,
    borderWidth: 1,
    borderColor: '#e3e6e1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.025,
    shadowRadius: 12,
  },
  webCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 28,
    borderWidth: 1,
    borderColor: '#e3e6e1',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.025,
    shadowRadius: 12,
  },
  cardMobile: {
    borderRadius: 10,
    padding: 16,
  },
  warningCard: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 12,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 4,
  },
  warningDesc: {
    fontSize: 13,
    color: '#b45309',
  },
  quickActionBtn: {
    backgroundColor: '#f59e0b',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  quickActionBtnText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#17201c',
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 14,
    color: '#747d78',
    marginBottom: 22,
    lineHeight: 20,
  },
  formRow: {
    flexDirection: 'row',
  },
  formRowMobile: {
    flexDirection: 'column',
  },
  formGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3f4944',
    marginBottom: 8,
  },
  webInput: {
    borderWidth: 1,
    borderColor: '#d8dcd7',
    borderRadius: 7,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#ffffff',
    color: '#17201c',
  },
  textArea: {
    paddingTop: 12,
  },
  webPrimaryButton: {
    backgroundColor: '#253c32',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webPrimaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
  },
  disabledButton: {
    backgroundColor: '#9ca8a1',
  },

  // Generated output
  generatedBox: {
    flex: 1,
    backgroundColor: '#fafbf9',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e3e6e1',
  },
  boxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 12,
    marginBottom: 14,
  },
  boxSub: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 4,
  },
  statusBadgeText: {
    color: '#416353',
    fontWeight: '500',
  },
  actionPill: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#d8dcd7',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  actionPillText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3f4944',
  },
  actionPillPrimary: {
    backgroundColor: '#253c32',
    borderColor: '#253c32',
  },
  actionPillPrimaryText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#ffffff',
  },
  emailPreviewScroll: {
    maxHeight: 400,
  },
  emailPreviewText: {
    fontSize: 14,
    color: '#1e293b',
    lineHeight: 22,
    fontFamily: 'monospace',
  },
  generatingStateBox: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dfe3de',
    minHeight: 380,
  },
  pulseLoaderCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#eef1ed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#d8ded9',
  },
  generatingStateTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#25302b',
    textAlign: 'center',
    marginBottom: 8,
  },
  generatingStateSub: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    maxWidth: 420,
    lineHeight: 22,
    marginBottom: 24,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#17201c',
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 7,
  },
  timerIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  timerCountdown: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '600',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  emptyPreviewBox: {
    height: 380,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fafbf9',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e3e6e1',
    padding: 30,
    textAlign: 'center',
  },
  emptyPreviewTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#35403a',
    marginBottom: 8,
  },
  emptyPreviewSub: {
    fontSize: 14,
    color: '#747d78',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 340,
  },
  emptyPreviewMark: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#eef1ed',
    color: '#536159',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    paddingTop: 13,
    marginBottom: 14,
  },
  profileMark: {
    color: '#536159',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },
  securityLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#52705f',
  },

  // History Tab Styles
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  historyHeaderMobile: {
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 14,
  },
  historyTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyToolsMobile: {
    width: '100%',
  },
  historySearch: {
    width: 240,
    marginBottom: 0,
  },
  historySearchMobile: {
    flex: 1,
    width: 'auto',
    minWidth: 0,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  statsRowMobile: {
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e3e6e1',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: '600',
    color: '#17201c',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  tableCard: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e3e6e1',
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableRowMobile: {
    flexDirection: 'column',
    gap: 14,
    padding: 16,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#17201c',
    marginBottom: 4,
  },
  rowCompany: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 4,
  },
  rowDate: {
    fontSize: 12,
    color: '#94a3b8',
  },
  badgePill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    alignSelf: 'flex-end',
  },
  badgeApplied: {
    backgroundColor: '#edf3ef',
  },
  badgeAppliedText: {
    color: '#3f6954',
    fontSize: 12,
    fontWeight: '600',
  },
  badgeDraft: {
    backgroundColor: '#f0f1ee',
  },
  badgeDraftText: {
    color: '#5d6761',
    fontSize: 12,
    fontWeight: '600',
  },
  tableActionBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  tableActionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  atsScorePill: {
    alignItems: 'baseline',
    backgroundColor: '#eef5f0',
    borderColor: '#c7d8cd',
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    marginBottom: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  atsScorePillValue: {
    color: '#28543f',
    fontSize: 13,
    fontWeight: '800',
  },
  atsScorePillLabel: {
    color: '#617067',
    fontSize: 10,
    fontWeight: '600',
  },
  emptyHistoryBox: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 48,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },

  // Settings Tab Styles
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionHeaderMobile: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  uploadBtn: {
    backgroundColor: '#f3f5f2',
    borderWidth: 1,
    borderColor: '#d8dcd7',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  uploadBtnText: {
    color: '#354b40',
    fontSize: 13,
    fontWeight: '600',
  },
  providerPill: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  providerPillActive: {
    borderColor: '#8e9c94',
    backgroundColor: '#eef1ed',
  },
  providerPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  providerPillTextActive: {
    color: '#253c32',
  },

  // Guide styles
  guideToggleBtn: {
    backgroundColor: '#f3f5f2',
    borderWidth: 1,
    borderColor: '#d8dcd7',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  guideToggleBtnText: {
    color: '#354b40',
    fontSize: 13,
    fontWeight: '600',
  },
  guideBox: {
    backgroundColor: '#fafbf9',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#e3e6e1',
    padding: 20,
    marginBottom: 20,
  },
  guideTabBar: {
    flexDirection: 'row',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 12,
    marginBottom: 16,
  },
  guideTabItem: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  guideTabItemActive: {
    backgroundColor: '#253c32',
    borderColor: '#253c32',
  },
  guideTabItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  guideTabItemTextActive: {
    color: '#ffffff',
  },
  guideContent: {
    gap: 14,
  },
  guideLead: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 6,
  },
  guideStepRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#50645a',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  stepBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 2,
  },
  stepDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 6,
  },
  linkPill: {
    backgroundColor: '#eef1ed',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  linkPillText: {
    color: '#354b40',
    fontSize: 12,
    fontWeight: '600',
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 8,
  },
  sectionSaveBtn: {
    backgroundColor: '#253c32',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  sectionSaveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionFeedbackText: {
    color: '#3f6954',
    fontSize: 13,
    fontWeight: '600',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 28,
    width: '95%',
    maxWidth: 1180,
    maxHeight: '92vh',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.09,
    shadowRadius: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 14,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#17201c',
  },
  modalSub: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  closeBtn: {
    padding: 4,
  },
  closeBtnText: {
    color: '#606963',
    fontSize: 12,
    fontWeight: '500',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 16,
  },

  // AI Intake Card Styles
  aiIntakeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 22,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderTopWidth: 4,
    borderTopColor: '#2563eb',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  aiIntakeHeader: {
    marginBottom: 14,
  },
  aiIntakeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
    flexWrap: 'wrap',
  },
  aiAgentPill: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 20,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  aiAgentPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  aiIntakeTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  aiIntakeSubtitle: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
  },
  aiTextarea: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 14,
    fontSize: 13,
    color: '#0f172a',
    minHeight: 105,
    maxHeight: 180,
    marginBottom: 14,
    outlineStyle: 'none',
  },
  aiButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  aiPrimaryBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  aiPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  aiWebhookBtn: {
    backgroundColor: '#059669',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  aiWebhookBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  aiSampleBtn: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 8,
    cursor: 'pointer',
  },
  aiSampleBtnText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '600',
  },
  aiClearBtn: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    cursor: 'pointer',
  },
  aiClearBtnText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '500',
  },
  aiFeedbackBanner: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  aiFeedbackText: {
    color: '#065f46',
    fontSize: 13,
    fontWeight: '500',
  },
  aiExtractedSummary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  aiSummaryTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    gap: 5,
  },
  aiSummaryTagLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  aiSummaryTagValue: {
    fontSize: 12,
    fontWeight: '500',
    color: '#0f172a',
  },
  // Countdown Popup Modal Styles
  countdownModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  countdownModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 32,
    width: '100%',
    maxWidth: 460,
    alignItems: 'center',
    textAlign: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.15,
    shadowRadius: 28,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  countdownIconWrapper: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  countdownModalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
    textAlign: 'center',
  },
  countdownModalSubtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  countdownTimerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 30,
    marginBottom: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  countdownTimerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1.5,
  },
  countdownTimerValue: {
    color: '#38bdf8',
    fontSize: 26,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  countdownStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  countdownPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  countdownStatusText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '500',
  },
  countdownDismissBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  countdownDismissBtnText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

  // Resume Box & Picked Resume in Apply Tab
  pickedResumeCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  pickedResumeCardActive: {
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
  },
  pickedResumeTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  pickedStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotGreen: {
    backgroundColor: '#16a34a',
  },
  dotBlue: {
    backgroundColor: '#2563eb',
  },
  pickedResumeEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#64748b',
  },
  pickedBadge: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pickedBadgeGreen: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
  },
  pickedBadgeBlue: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  pickedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  pickedBadgeTextGreen: {
    color: '#15803d',
  },
  pickedBadgeTextBlue: {
    color: '#1d4ed8',
  },
  bucketTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  bucketTagIcon: {
    fontSize: 11,
  },
  bucketTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#475569',
  },
  pickedResumeBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  pickedFileName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 3,
  },
  pickedBucketPath: {
    fontSize: 11,
    color: '#475569',
    marginBottom: 3,
  },
  pickedCharCount: {
    fontSize: 11,
    color: '#64748b',
  },
  pickedResumeActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  pickedPreviewBtn: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  pickedPreviewBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  resumeSwitcherRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  switcherLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
  },
  switcherSegmentGroup: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  switcherSegment: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  switcherSegmentActiveGreen: {
    backgroundColor: '#dcfce7',
    borderColor: '#22c55e',
  },
  switcherSegmentActiveBlue: {
    backgroundColor: '#dbeafe',
    borderColor: '#3b82f6',
  },
  switcherSegmentText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  switcherSegmentTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  resumeBoxApply: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  resumeBoxHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  resumeBoxTitle: {
    fontSize: 13,
    color: '#475569',
  },
  resumeBoxSubtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  resumeViewBtn: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  resumeViewBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1d4ed8',
  },
  resumeTailorBtn: {
    backgroundColor: '#10b981',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  resumeTailorBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },

  // Resume Screen & Paper Layout
  resumeToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  resumeToolbarMobile: {
    alignItems: 'stretch',
    width: '100%',
  },
  resumeModeSwitcher: {
    backgroundColor: '#f1f3f1',
    borderRadius: 8,
    flexDirection: 'row',
    padding: 3,
  },
  resumeModeSwitcherMobile: {
    width: '100%',
  },
  resumeModeButton: {
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  resumeModeButtonMobile: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 6,
  },
  resumeModeButtonActive: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dfe4e0',
  },
  resumeActionButton: {
    backgroundColor: '#ffffff',
    borderColor: '#d8ded9',
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeActionButtonMobile: {
    flexGrow: 1,
    minWidth: '47%',
  },
  resumeActionButtonPrimary: {
    backgroundColor: '#253c32',
    borderColor: '#253c32',
  },
  resumeActionButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  resumeActionButtonTextPrimary: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  resumeActionButtonTextSecondary: {
    color: '#35403a',
    fontSize: 12,
    fontWeight: '600',
  },
  resumePaper: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
  },
  resumePaperText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 22,
    color: '#1e293b',
    whiteSpace: 'pre-wrap',
  },
});

