import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';

const SETTINGS_KEY = '@job_system_settings';
const APPLICATIONS_KEY = '@job_system_applications';
const PROFILE_KEY = '@job_system_profile';

export const defaultProfile = {
  fullName: '',
  email: '',
  phone: '',
  headline: '',
  portfolio: '',
  linkedin: '',
  github: '',
  location: '',
  bio: '',
};

export const defaultSettings = {
  llmProvider: 'OpenAI',
  llmApiKey: '',
  llmModel: 'gpt-4o-mini',
  googleSenderEmail: '',
  googleClientId: '',
  googleClientSecret: '',
  resumeName: '',
  resumeContent: '',
};

// --------------------------------------------------------
// USER PROFILE & CONTACT DETAILS
// --------------------------------------------------------

export async function getProfile(userId, fallbackEmail = '') {
  let profile = { ...defaultProfile, email: fallbackEmail };

  // 1. Try reading from Supabase
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (!error && data) {
        profile = {
          fullName: data.full_name || '',
          email: data.email || fallbackEmail,
          phone: data.phone || '',
          headline: data.headline || '',
          portfolio: data.portfolio || '',
          linkedin: data.linkedin || '',
          github: data.github || '',
          location: data.location || '',
          bio: data.bio || '',
        };
        await AsyncStorage.setItem(`${PROFILE_KEY}_${userId}`, JSON.stringify(profile));
        return profile;
      }
    } catch (e) {
      console.log('Supabase profile load notice:', e.message);
    }
  }

  // 2. Fallback to AsyncStorage
  try {
    const key = userId ? `${PROFILE_KEY}_${userId}` : PROFILE_KEY;
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      return { ...defaultProfile, email: fallbackEmail, ...JSON.parse(cached) };
    }
  } catch (e) {
    console.error('AsyncStorage profile load error:', e);
  }

  return profile;
}

export async function saveProfile(userId, profile) {
  // 1. Save locally
  try {
    const key = userId ? `${PROFILE_KEY}_${userId}` : PROFILE_KEY;
    await AsyncStorage.setItem(key, JSON.stringify(profile));
  } catch (e) {
    console.error('Local profile save error:', e);
  }

  // 2. Sync to Supabase
  if (userId) {
    const payload = {
      id: userId,
      email: profile.email,
      full_name: profile.fullName,
      phone: profile.phone,
      headline: profile.headline,
      portfolio: profile.portfolio,
      linkedin: profile.linkedin,
      github: profile.github,
      location: profile.location,
      bio: profile.bio,
      updated_at: new Date().toISOString(),
    };

    try {
      await supabase.from('users').upsert(payload, { onConflict: 'id' });
    } catch (err) {
      console.warn('Sync profile to users table warning:', err);
    }

    try {
      await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
    } catch (err) {
      console.warn('Sync profile to profiles table warning:', err);
    }

    try {
      await supabase.auth.updateUser({
        data: { full_name: profile.fullName },
      });
    } catch (_authErr) {
      // ignore
    }
  }

  return true;
}

// --------------------------------------------------------
// USER SETTINGS & APIS
// --------------------------------------------------------

export async function getSettings(userId) {
  // 1. Try reading from Supabase if user is logged in
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('llm_provider, llm_api_key, llm_model, google_sender_email, google_client_id, google_client_secret, resume_name, resume_content, google_connected_at')
        .eq('user_id', userId)
        .single();

      if (!error && data) {
        let resName = data.resume_name || '';
        let resContent = data.resume_content || '';

        // If resume is empty, try loading from storage bucket
        if ((!resContent || !resName) && userId) {
          try {
            const bucketData = await syncResumeFromBucket(userId);
            if (bucketData?.resumeContent) {
              resName = bucketData.resumeName;
              resContent = bucketData.resumeContent;
            }
          } catch (_syncErr) {}
        }

        const mapped = {
          llmProvider: data.llm_provider || 'OpenAI',
          llmApiKey: data.llm_api_key || '',
          llmModel: data.llm_model || 'gpt-4o-mini',
          googleSenderEmail: data.google_sender_email || '',
          googleClientId: data.google_client_id || '',
          googleClientSecret: data.google_client_secret || '',
          resumeName: resName,
          resumeContent: resContent,
          googleConnectedAt: data.google_connected_at || null,
        };
        // Cache locally
        await AsyncStorage.setItem(`${SETTINGS_KEY}_${userId}`, JSON.stringify(mapped));
        return mapped;
      }
    } catch (e) {
      console.log('Supabase settings query fallback to local cache:', e.message);
    }
  }

  // 2. Local fallback
  try {
    const key = userId ? `${SETTINGS_KEY}_${userId}` : SETTINGS_KEY;
    const data = await AsyncStorage.getItem(key);
    if (data) {
      return { ...defaultSettings, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('Error reading settings from storage', e);
  }
  return defaultSettings;
}

export async function saveSettings(userId, settings) {
  // 1. Save locally
  try {
    const key = userId ? `${SETTINGS_KEY}_${userId}` : SETTINGS_KEY;
    await AsyncStorage.setItem(key, JSON.stringify(settings));
  } catch (e) {
    console.error('Local settings save error:', e);
  }

  // 2. Sync to Supabase database if logged in
  if (userId) {
    try {
      const { error } = await supabase
        .from('user_settings')
        .upsert(
          {
            user_id: userId,
            llm_provider: settings.llmProvider,
            llm_api_key: settings.llmApiKey,
            llm_model: settings.llmModel,
            google_sender_email: settings.googleSenderEmail,
            google_client_id: settings.googleClientId,
            google_client_secret: settings.googleClientSecret,
            resume_name: settings.resumeName,
            resume_content: settings.resumeContent,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (error) {
        console.warn('Supabase settings sync error:', error.message);
      }
    } catch (e) {
      console.warn('Could not sync settings to Supabase:', e);
    }
  }

  return true;
}

// --------------------------------------------------------
// RESUME STORAGE BUCKET (Isolated folder per user: resumes/{user_id}/{filename})
// --------------------------------------------------------

export async function uploadResumeFile(userId, fileBlobOrBytes, fileName) {
  if (!userId) throw new Error('User must be logged in to upload to Supabase storage.');

  const filePath = `${userId}/${fileName}`;

  try {
    const { data, error } = await supabase.storage
      .from('resumes')
      .upload(filePath, fileBlobOrBytes, {
        upsert: true,
        contentType: 'application/octet-stream',
      });

    if (error) throw error;

    // Record into public.resumes table
    await supabase.from('resumes').insert({
      user_id: userId,
      file_name: fileName,
      file_path: filePath,
      is_primary: true,
    });

    // Automatically trigger Python Agent to extract text and sync user_settings
    try {
      await syncResumeFromBucket(userId);
    } catch (_syncErr) {}

    return { success: true, filePath, data };
  } catch (err) {
    console.error('Resume bucket upload error:', err);
    throw err;
  }
}

// Synchronize and load resume directly from Supabase Storage bucket 'resumes/{userId}/'
export async function syncResumeFromBucket(userId) {
  if (!userId) throw new Error('User ID required to sync resume from bucket');

  // 1. Try calling the Python Agent endpoint to extract PDF/docx/text
  try {
    const resp = await fetch('http://localhost:8000/api/agent/sync-resume-from-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.resume_content) {
        // Cache locally in AsyncStorage
        try {
          const key = `${SETTINGS_KEY}_${userId}`;
          const currentStr = await AsyncStorage.getItem(key);
          const current = currentStr ? JSON.parse(currentStr) : {};
          const updated = {
            ...current,
            resumeName: data.resume_name || 'Resume.pdf',
            resumeContent: data.resume_content,
          };
          await AsyncStorage.setItem(key, JSON.stringify(updated));
        } catch (_cErr) {}

        return {
          resumeName: data.resume_name,
          resumeContent: data.resume_content,
          source: 'python-agent-bucket',
        };
      }
    }
  } catch (agentErr) {
    console.log('Python bucket agent sync note:', agentErr.message);
  }

  // 2. Direct Supabase Storage Bucket query (fallback)
  try {
    const { data: files, error: listErr } = await supabase.storage.from('resumes').list(userId);
    if (!listErr && files && files.length > 0) {
      const realFiles = files.filter(f => f.name && !f.name.endsWith('/'));
      if (realFiles.length > 0) {
        // Sort descending by updated_at or created_at
        realFiles.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
        const chosen = realFiles[0];
        const filePath = `${userId}/${chosen.name}`;

        // First check if text is already saved in user_settings from prior sync
        const { data: row } = await supabase.from('user_settings').select('resume_name, resume_content').eq('user_id', userId).maybeSingle();
        if (row && row.resume_content) {
          return {
            resumeName: row.resume_name || chosen.name,
            resumeContent: row.resume_content,
            source: 'supabase-bucket',
          };
        }

        // Download file from bucket
        const { data: blob, error: dlErr } = await supabase.storage.from('resumes').download(filePath);
        if (!dlErr && blob) {
          let text = '';
          if (chosen.name.toLowerCase().endsWith('.txt') || chosen.name.toLowerCase().endsWith('.md')) {
            text = await blob.text();
          }

          if (text) {
            await supabase.from('user_settings').update({
              resume_name: chosen.name,
              resume_content: text,
            }).eq('user_id', userId);

            return {
              resumeName: chosen.name,
              resumeContent: text,
              source: 'supabase-bucket',
            };
          }
        }
      }
    }
  } catch (storageErr) {
    console.warn('Direct bucket download error:', storageErr);
  }

  // 3. Fallback to user_settings table
  try {
    const { data: fallbackRow } = await supabase.from('user_settings').select('resume_name, resume_content').eq('user_id', userId).maybeSingle();
    if (fallbackRow && fallbackRow.resume_content) {
      return {
        resumeName: fallbackRow.resume_name || 'Resume.txt',
        resumeContent: fallbackRow.resume_content,
        source: 'user_settings',
      };
    }
  } catch (_fbErr) {}

  return null;
}

// Generates a signed URL to display the exact PDF / document file in the viewer
export async function getResumeFileUrl(userId, fileName = '') {
  if (!userId) return null;

  // 1. Try Python Agent endpoint (uses service role key, highly reliable)
  try {
    const resp = await fetch('http://localhost:8000/api/agent/get-resume-file-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, file_name: fileName || '' }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.signed_url) {
        return {
          url: data.signed_url,
          fileName: data.file_name,
          isPdf: !!data.is_pdf,
        };
      }
    }
  } catch (_e) {}

  // 2. Direct Supabase Storage signed URL (client fallback)
  try {
    let targetFileName = fileName;
    if (!targetFileName) {
      const { data: files } = await supabase.storage.from('resumes').list(userId);
      if (files && files.length > 0) {
        const real = files.filter(f => f.name && !f.name.endsWith('/'));
        if (real.length > 0) {
          real.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
          targetFileName = real[0].name;
        }
      }
    }

    if (targetFileName) {
      const filePath = `${userId}/${targetFileName}`;
      const { data, error } = await supabase.storage.from('resumes').createSignedUrl(filePath, 7200);
      if (!error && data?.signedUrl) {
        return {
          url: data.signedUrl,
          fileName: targetFileName,
          isPdf: targetFileName.toLowerCase().endsWith('.pdf'),
        };
      }
    }
  } catch (err) {
    console.warn('Direct signed URL error:', err);
  }

  return null;
}

// --------------------------------------------------------
// RESUME VIEWER & AI RESUME TAILOR AGENT
// --------------------------------------------------------

export async function fetchUserResume(userId) {
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('resume_name, resume_content')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data && data.resume_content) {
        const fileInfo = await getResumeFileUrl(userId, data.resume_name).catch(() => null);
        const rName = data.resume_name || 'Resume.pdf';
        return {
          resumeName: rName,
          resumeContent: data.resume_content,
          resumeUrl: fileInfo?.url || '',
          isPdf: rName.toLowerCase().endsWith('.pdf'),
        };
      }
    } catch (_e) {}

    // If user_settings doesn't have resume_content, attempt loading directly from the bucket
    try {
      const bucketResult = await syncResumeFromBucket(userId);
      if (bucketResult && bucketResult.resumeContent) {
        const fileInfo = await getResumeFileUrl(userId, bucketResult.resumeName).catch(() => null);
        const rName = bucketResult.resumeName || 'Resume.pdf';
        return {
          ...bucketResult,
          resumeName: rName,
          resumeUrl: fileInfo?.url || bucketResult.signed_url || '',
          isPdf: rName.toLowerCase().endsWith('.pdf'),
        };
      }
    } catch (_bErr) {}
  }

  // Check local cache
  try {
    const key = userId ? `${SETTINGS_KEY}_${userId}` : SETTINGS_KEY;
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.resumeContent) {
        return {
          resumeName: parsed.resumeName || 'Resume.pdf',
          resumeContent: parsed.resumeContent,
          resumeUrl: parsed.resumeUrl || '',
          isPdf: (parsed.resumeName || '').toLowerCase().endsWith('.pdf'),
        };
      }
    }
  } catch (_e) {}

  return {
    resumeName: '',
    resumeContent: '',
    resumeUrl: '',
    isPdf: false,
  };
}

export async function updateResumeContent(userId, resumeContent, resumeName = '') {
  const currentSettings = await getSettings(userId);
  const updatedName = resumeName || currentSettings.resumeName || 'Resume.txt';
  const updatedSettings = {
    ...currentSettings,
    resumeName: updatedName,
    resumeContent,
  };

  await saveSettings(userId, updatedSettings);

  if (userId) {
    try {
      await supabase.from('resumes').insert({
        user_id: userId,
        file_name: updatedName,
        file_path: `${userId}/${updatedName}`,
        parsed_text: resumeContent,
        is_primary: true,
      });
    } catch (_e) {}
  }

  return updatedSettings;
}

export async function tailorResumeForJob({
  userId,
  jobTitle = 'Software Engineer',
  companyName = 'Hiring Company',
  requirements = '',
  description = '',
  rawResume = '',
  resumeName = '',
}) {
  // 1. First attempt LangGraph Python backend agent
  try {
    const response = await fetch('http://localhost:8000/api/agent/tailor-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId || '',
        job_title: jobTitle,
        company_name: companyName,
        requirements,
        job_description: description,
        raw_resume: rawResume,
        resume_name: resumeName,
        save_to_db: Boolean(userId),
      }),
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success && result.tailored_resume) {
        return {
          success: true,
          tailoredResume: result.tailored_resume,
          resumeName: result.resume_name || `Resume_Tailored_${jobTitle.replace(/\s+/g, '_')}.txt`,
          matchedSkills: result.matched_skills || [],
          missingSkills: result.missing_skills || [],
          enhancements: result.enhancements || [],
          source: 'python-agent',
        };
      }
    }
  } catch (_agentErr) {
    // Python agent server offline, fallback to client-side LangGraph logic
  }

  // 2. Client-side tailoring engine fallback
  let baseResume = (rawResume || '').trim();
  if (!baseResume && userId) {
    const loaded = await fetchUserResume(userId);
    baseResume = (loaded.resumeContent || '').trim();
  }

  if (!baseResume) {
    baseResume = `PROFESSIONAL SUMMARY
Experienced Software Engineer skilled in building scalable applications, designing robust APIs, and integrating modern technologies.

TECHNICAL SKILLS
• Programming: Python, JavaScript, TypeScript, React, Node.js
• Tools & Databases: PostgreSQL, Supabase, Git, REST APIs, Automation Workflows

PROFESSIONAL EXPERIENCE
Software Engineer | Engineering Solutions
• Designed and developed performant software systems and automated workflows.
• Collaborated with engineering teams to build end-to-end features and APIs.

EDUCATION
Bachelor of Science in Computer Science`;
  }

  // Extract skills from requirements
  const techKeywords = [
    'Python', 'JavaScript', 'TypeScript', 'React', 'React Native', 'Next.js', 'Node.js',
    'FastAPI', 'LangGraph', 'LangChain', 'OpenAI', 'ChatGPT', 'Claude', 'Gemini',
    'LLMs', 'Generative AI', 'AI Agents', 'Prompt Engineering', 'n8n', 'Zapier',
    'PostgreSQL', 'Supabase', 'MongoDB', 'Docker', 'AWS', 'REST APIs', 'CI/CD'
  ];

  const fullReqText = `${jobTitle} ${companyName} ${requirements} ${description}`.toLowerCase();
  const matched = techKeywords.filter((kw) => fullReqText.includes(kw.toLowerCase()));
  const topSkills = matched.length > 0 ? matched : ['Python', 'Software Engineering', 'AI Integrations', 'Problem Solving'];
  const topSkillsStr = topSkills.slice(0, 10).join(', ');

  const tailoredSummary = `Results-oriented ${jobTitle} with proven proficiency in ${topSkillsStr}. Demonstrated track record of delivering high-quality engineering solutions, optimizing workflows, and adapting rapidly to new technology stacks. Excited to bring hands-on expertise, technical agility, and collaborative drive to ${companyName || 'your team'}.`;

  const newFileName = `Resume_Tailored_${jobTitle.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 25)}.txt`;

  // Construct tailored resume
  const tailoredResume = `${jobTitle.toUpperCase()}
Target Organization: ${companyName || 'Hiring Company'}
Status: ATS-Optimized Tailored Resume

═══════════════════════════════════════════════════════════════════
TARGETED PROFESSIONAL SUMMARY
═══════════════════════════════════════════════════════════════════
${tailoredSummary}

═══════════════════════════════════════════════════════════════════
CORE COMPETENCIES & MATCHED REQUIREMENTS
═══════════════════════════════════════════════════════════════════
• Key Technologies: ${topSkillsStr}
• Focus Areas: System Reliability, Automation Workflows, Clean Code & API Design

═══════════════════════════════════════════════════════════════════
EXPERIENCE & BACKGROUND
═══════════════════════════════════════════════════════════════════
${baseResume}
`;

  // Persist to user settings
  if (userId) {
    try {
      await updateResumeContent(userId, tailoredResume, newFileName);
    } catch (_e) {}
  }

  return {
    success: true,
    tailoredResume,
    resumeName: newFileName,
    matchedSkills: topSkills,
    enhancements: [
      `Headline and target title tailored specifically for "${jobTitle}"`,
      `Executive summary generated and optimized for ${companyName || 'the target role'}`,
      `Elevated matching key competencies: ${topSkillsStr}`,
      'Formatted for high ATS parseability and recruiter readability',
    ],
    source: 'client-engine',
  };
}
// --------------------------------------------------------

export function mapApplicationRow(row) {
  if (!row) return null;

  // Extract email body from joined application_emails if present
  let emailContent = '';
  if (Array.isArray(row.application_emails) && row.application_emails.length > 0) {
    const sorted = [...row.application_emails].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
    const latest = sorted[0];
    const body = latest.body || latest.generated_email || latest.content || latest.text || '';
    const subject = latest.subject || '';
    if (body || subject) {
      if (subject && !body.toLowerCase().startsWith('subject:')) {
        emailContent = `Subject: ${subject}\n\n${body}`;
      } else {
        emailContent = body;
      }
    }
  } else if (row.generated_email) {
    emailContent = row.generated_email;
  }

  const hasEmail = Boolean(emailContent && emailContent.trim());

  return {
    id: row.id,
    jobTitle: row.job_title || '',
    companyName: row.company_name || 'Hiring Company',
    recipientEmail: row.recipient_email || '',
    requirements: row.requirements || '',
    description: row.description || '',
    generatedEmail: emailContent,
    status: hasEmail && row.status === 'Generating' ? 'Generated' : (row.status || 'Generating'),
    resumeId: row.resume_id || null,
    appliedAt: row.applied_at || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

export function deduplicateApplicationList(apps) {
  if (!Array.isArray(apps)) return [];
  const statusRank = (s) => {
    switch (s) {
      case 'Applied': return 5;
      case 'Interviewing': return 4;
      case 'Accepted': return 4;
      case 'Rejected': return 4;
      case 'Generated': return 3;
      case 'Generating': return 2;
      case 'Draft': return 1;
      default: return 0;
    }
  };

  const map = new Map();
  for (const app of apps) {
    if (!app || !app.id) continue;
    const normTitle = (app.jobTitle || '').toLowerCase().trim();
    const normCompany = (app.companyName || '').toLowerCase().trim();
    const groupKey = `${normTitle}:::${normCompany}`;

    if (!map.has(groupKey)) {
      map.set(groupKey, { ...app });
    } else {
      const existing = map.get(groupKey);
      const existingRank = statusRank(existing.status);
      const currentRank = statusRank(app.status);

      const preferCurrent = currentRank > existingRank || 
        (currentRank === existingRank && new Date(app.createdAt || 0) >= new Date(existing.createdAt || 0));

      const mergedEmail = app.generatedEmail?.trim() || existing.generatedEmail?.trim() || '';
      const mergedAppliedAt = app.appliedAt || existing.appliedAt || null;

      if (preferCurrent) {
        map.set(groupKey, {
          ...app,
          generatedEmail: mergedEmail,
          appliedAt: mergedAppliedAt,
        });
      } else {
        map.set(groupKey, {
          ...existing,
          generatedEmail: mergedEmail,
          appliedAt: mergedAppliedAt,
        });
      }
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );
}

export async function getApplications(userId) {
  if (!userId) return [];

  // 1. Production-level Supabase query directly from 'applications' table with joined 'application_emails'
  try {
    const { data, error } = await supabase
      .from('applications')
      .select('*, application_emails(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const mapped = deduplicateApplicationList(data.map(mapApplicationRow));
      // Synchronize local cache
      const key = `${APPLICATIONS_KEY}_${userId}`;
      await AsyncStorage.setItem(key, JSON.stringify(mapped));
      return mapped;
    } else if (error) {
      console.warn('Supabase getApplications notice:', error.message);
    }
  } catch (e) {
    console.warn('Network notice fetching applications from Supabase:', e.message);
  }

  // 2. Fallback to AsyncStorage cache
  try {
    const key = `${APPLICATIONS_KEY}_${userId}`;
    const data = await AsyncStorage.getItem(key);
    if (data) {
      return deduplicateApplicationList(JSON.parse(data));
    }
  } catch (e) {
    console.error('Error reading applications from storage', e);
  }
  return [];
}

/**
 * Creates and immediately saves the application record in the Supabase 'applications' table
 * on button click, returning the real database UUID.
 */
export async function createApplication(userId, formDetails) {
  const jobTitle = formDetails.jobTitle?.trim() || '';
  const companyName = formDetails.companyName?.trim() || 'Hiring Company';
  const recipientEmail = formDetails.recipientEmail?.trim() || null;
  const requirements = formDetails.requirements?.trim() || null;
  const description = formDetails.description?.trim() || null;

  // 1. Deduplication check: if a record for this same user, role & company exists within 15 minutes, reuse it!
  if (userId) {
    try {
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: existingRecords } = await supabase
        .from('applications')
        .select('*, application_emails(*)')
        .eq('user_id', userId)
        .eq('job_title', jobTitle)
        .eq('company_name', companyName)
        .gte('created_at', fifteenMinutesAgo)
        .order('created_at', { ascending: false })
        .limit(1);

      if (existingRecords && existingRecords.length > 0) {
        const existingApp = mapApplicationRow(existingRecords[0]);
        console.log('Reusing existing application record:', existingApp.id);
        return { success: true, application: existingApp, id: existingApp.id };
      }
    } catch (checkErr) {
      console.warn('Deduplication check error:', checkErr.message);
    }
  }

  const insertPayload = {
    user_id: userId,
    job_title: jobTitle,
    company_name: companyName,
    recipient_email: recipientEmail,
    requirements: requirements,
    description: description,
    status: 'Generating',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let createdApp = null;
  let createdId = null;

  if (userId) {
    try {
      const { data, error } = await supabase
        .from('applications')
        .insert(insertPayload)
        .select()
        .single();

      if (!error && data) {
        createdApp = mapApplicationRow(data);
        createdId = data.id;
      } else if (error) {
        console.warn('Supabase insert application error:', error.message);
      }
    } catch (err) {
      console.warn('Exception creating application in Supabase:', err.message);
    }
  }

  // Fallback if offline or DB error
  if (!createdApp) {
    createdId = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : 'app-' + Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    createdApp = {
      id: createdId,
      jobTitle: formDetails.jobTitle?.trim() || '',
      companyName: formDetails.companyName?.trim() || 'Hiring Company',
      recipientEmail: formDetails.recipientEmail?.trim() || '',
      requirements: formDetails.requirements?.trim() || '',
      description: formDetails.description?.trim() || '',
      generatedEmail: '',
      status: 'Generating',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Update local cache
  try {
    const key = userId ? `${APPLICATIONS_KEY}_${userId}` : APPLICATIONS_KEY;
    const current = await getApplications(userId);
    const updated = [createdApp, ...current.filter(i => i.id !== createdId)];
    await AsyncStorage.setItem(key, JSON.stringify(updated));
  } catch (_e) {}

  return { success: true, application: createdApp, id: createdId };
}

/**
 * Updates the generated_email field of an existing application record in Supabase & cache
 */
export async function updateApplicationGeneratedEmail(userId, applicationId, generatedEmail) {
  if (!applicationId) return;

  // 1. Sync status to Supabase (applications table stores status, application_emails stores content)
  if (userId) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId);
      if (isUuid) {
        // Update applications status to 'Generated'
        const { error: appErr } = await supabase
          .from('applications')
          .update({
            status: 'Generated',
            updated_at: new Date().toISOString(),
          })
          .eq('id', applicationId)
          .eq('user_id', userId);

        if (appErr) {
          console.warn('Error updating status in applications:', appErr.message);
        }

        // Also ensure application_emails has the record if n8n didn't insert it yet
        if (generatedEmail) {
          const { data: existing } = await supabase
            .from('application_emails')
            .select('id')
            .eq('application_id', applicationId)
            .eq('user_id', userId)
            .limit(1);

          if (!existing || existing.length === 0) {
            await supabase.from('application_emails').insert({
              application_id: applicationId,
              user_id: userId,
              body: generatedEmail,
              status: 'pending',
              created_at: new Date().toISOString(),
            });
          }
        }
      }
    } catch (err) {
      console.warn('Supabase update generated email notice:', err.message);
    }
  }

  // 2. Update local cache
  try {
    const key = userId ? `${APPLICATIONS_KEY}_${userId}` : APPLICATIONS_KEY;
    const current = await getApplications(userId);
    const updated = current.map(item => item.id === applicationId 
      ? { ...item, generatedEmail, status: 'Generated', updatedAt: new Date().toISOString() } 
      : item
    );
    await AsyncStorage.setItem(key, JSON.stringify(updated));
  } catch (err) {
    console.warn('Error updating local cache for generated email:', err);
  }
}

/**
 * Updates status of an application in Supabase DB & local cache (e.g. Applied, Interviewing, Rejected)
 */
export async function updateApplicationStatus(userId, applicationId, status) {
  if (!applicationId) return [];

  const now = new Date().toISOString();
  const updatePayload = {
    status,
    updated_at: now,
  };
  if (status === 'Applied') {
    updatePayload.applied_at = now;
  }

  // 1. Sync directly to Supabase applications table
  if (userId) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId);
      if (isUuid) {
        const { error } = await supabase
          .from('applications')
          .update(updatePayload)
          .eq('id', applicationId)
          .eq('user_id', userId);

        if (error) {
          console.warn('Error updating application status in Supabase:', error.message);
        }
      }
    } catch (err) {
      console.warn('Supabase update status error:', err.message);
    }

    // Always return fresh data from applications table in Supabase
    return await getApplications(userId);
  }

  // 2. Fallback to local cache if no userId
  let updatedList = [];
  try {
    const key = `${APPLICATIONS_KEY}_${userId}`;
    const current = await getApplications(userId);
    updatedList = current.map(item => item.id === applicationId 
      ? { ...item, status, appliedAt: status === 'Applied' ? now : item.appliedAt, updatedAt: now } 
      : item
    );
    await AsyncStorage.setItem(key, JSON.stringify(updatedList));
  } catch (err) {
    console.warn('Error updating local cache for status:', err);
  }

  return updatedList;
}

export async function saveApplication(userId, application) {
  if (!application?.id) return [];

  const now = new Date().toISOString();
  const dbPayload = {
    job_title: application.jobTitle,
    company_name: application.companyName || 'Hiring Company',
    recipient_email: application.recipientEmail || null,
    requirements: application.requirements || null,
    description: application.description || null,
    status: application.status || 'Generated',
    updated_at: now,
  };

  if (application.status === 'Applied') {
    dbPayload.applied_at = application.appliedAt || now;
  }

  // 1. Sync to Supabase
  if (userId) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(application.id);
      if (isUuid) {
        const { error } = await supabase
          .from('applications')
          .update(dbPayload)
          .eq('id', application.id)
          .eq('user_id', userId);

        if (error) {
          console.warn('Error saving application in Supabase:', error.message);
        }
      }
    } catch (err) {
      console.warn('Supabase save application error:', err.message);
    }

    return await getApplications(userId);
  }

  // 2. Fallback to local cache
  let updated = [];
  try {
    const key = `${APPLICATIONS_KEY}_${userId}`;
    const current = await getApplications(userId);
    const existingIndex = current.findIndex(i => i.id === application.id);
    if (existingIndex >= 0) {
      updated = current.map(i => i.id === application.id ? { ...i, ...application, updatedAt: now } : i);
    } else {
      updated = [application, ...current];
    }
    await AsyncStorage.setItem(key, JSON.stringify(updated));
  } catch (e) {
    console.error('Error saving application locally:', e);
  }

  return updated;
}

export function htmlToPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  if (!html.includes('<') || !html.includes('>')) return html;
  let text = html;
  text = text.replace(/<br\s*[\/]?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<li>/gi, '• ');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Updates full application details (jobTitle, companyName, recipientEmail, generatedEmail)
 * across applications and application_emails tables, returning fresh applications list.
 */
export async function updateFullApplication(userId, applicationId, updates) {
  if (!applicationId) return [];
  const now = new Date().toISOString();

  const appPayload = {
    updated_at: now,
  };
  if (updates.jobTitle !== undefined) appPayload.job_title = updates.jobTitle.trim();
  if (updates.companyName !== undefined) appPayload.company_name = updates.companyName.trim();
  if (updates.recipientEmail !== undefined) appPayload.recipient_email = updates.recipientEmail.trim();
  if (updates.status !== undefined) {
    appPayload.status = updates.status;
    if (updates.status === 'Applied') appPayload.applied_at = now;
  }

  // 1. Sync to Supabase
  if (userId) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId);
      if (isUuid) {
        await supabase
          .from('applications')
          .update(appPayload)
          .eq('id', applicationId)
          .eq('user_id', userId);

        if (updates.generatedEmail !== undefined) {
          const emailContent = updates.generatedEmail;
          let subject = null;
          if (emailContent.toLowerCase().startsWith('subject:')) {
            const firstNewline = emailContent.indexOf('\n');
            if (firstNewline !== -1) {
              subject = emailContent.substring(8, firstNewline).trim();
            }
          }

          const { data: existingEmails } = await supabase
            .from('application_emails')
            .select('id')
            .eq('application_id', applicationId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1);

          if (existingEmails && existingEmails.length > 0) {
            const emailUpdate = { body: emailContent, updated_at: now };
            if (subject) emailUpdate.subject = subject;
            await supabase
              .from('application_emails')
              .update(emailUpdate)
              .eq('id', existingEmails[0].id);
          } else {
            await supabase
              .from('application_emails')
              .insert({
                application_id: applicationId,
                user_id: userId,
                subject: subject || `Job Application: ${updates.jobTitle || 'Role'}`,
                body: emailContent,
                status: 'pending',
                created_at: now,
              });
          }
        }
      }
    } catch (err) {
      console.warn('Supabase updateFullApplication error:', err.message);
    }

    return await getApplications(userId);
  }

  // 2. Fallback to local cache
  try {
    const key = `${APPLICATIONS_KEY}_${userId}`;
    const current = await getApplications(userId);
    const updated = current.map((i) =>
      i.id === applicationId
        ? {
            ...i,
            ...updates,
            updatedAt: now,
          }
        : i
    );
    await AsyncStorage.setItem(key, JSON.stringify(updated));
    return updated;
  } catch (_e) {
    return [];
  }
}

export async function deleteApplication(userId, applicationId) {
  if (!applicationId) return [];

  // 1. Delete in Supabase
  if (userId) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId);
      if (isUuid) {
        const { error } = await supabase
          .from('applications')
          .delete()
          .eq('id', applicationId)
          .eq('user_id', userId);

        if (error) {
          console.warn('Error deleting application in Supabase:', error.message);
        }
      }
    } catch (err) {
      console.warn('Supabase delete application error:', err.message);
    }

    return await getApplications(userId);
  }

  // 2. Fallback to local cache
  const key = `${APPLICATIONS_KEY}_${userId}`;
  const current = await getApplications(userId);
  const updated = current.filter(item => item.id !== applicationId);
  await AsyncStorage.setItem(key, JSON.stringify(updated));

  return updated;
}

export async function getApplicationById(userId, applicationId) {
  if (!userId || !applicationId) return null;
  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId);
    if (isUuid) {
      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('id', applicationId)
        .eq('user_id', userId)
        .single();

      if (!error && data) {
        return mapApplicationRow(data);
      }
    }
  } catch (err) {
    console.warn('Error fetching application by ID:', err.message);
  }
  return null;
}

/**
 * Connect to Supabase Realtime channel for live updates to applications
 */
export function subscribeToApplications(userId, onEvent) {
  if (!userId) return null;

  try {
    const channel = supabase
      .channel(`realtime_applications_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'applications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (onEvent) onEvent(payload);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Realtime applications channel connected for user', userId);
        }
      });

    return channel;
  } catch (err) {
    console.warn('Could not establish realtime channel:', err.message);
    return null;
  }
}

// --------------------------------------------------------
// FETCH GENERATED EMAIL FROM application_emails TABLE
// --------------------------------------------------------

export async function fetchLatestApplicationEmail(userId, submittedAfter, applicationId) {
  if (!userId) return null;

  try {
    // 1. Try public.application_emails
    let query = supabase
      .from('application_emails')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    const isUuid = applicationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId);

    if (isUuid) {
      query = query.eq('application_id', applicationId);
    } else if (submittedAfter) {
      query = query.gte('created_at', submittedAfter);
    }

    let { data, error } = await query;

    // Fallback to singular application_email if schema cache differs
    if (error && error.code === 'PGRST205') {
      let altQuery = supabase
        .from('application_email')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (isUuid && submittedAfter) {
        altQuery = altQuery.or(`application_id.eq.${applicationId},created_at.gte.${submittedAfter}`);
      } else if (isUuid) {
        altQuery = altQuery.eq('application_id', applicationId);
      } else if (submittedAfter) {
        altQuery = altQuery.gte('created_at', submittedAfter);
      }
      const altRes = await altQuery;
      data = altRes.data;
      error = altRes.error;
    }

    if (!error && data && data.length > 0) {
      const row = data[0];
      const body = row.body || row.generated_email || row.content || row.text || '';
      const subject = row.subject || '';

      if (body || subject) {
        let fullEmail = body;
        if (subject && !body.toLowerCase().startsWith('subject:')) {
          fullEmail = `Subject: ${subject}\n\n${body}`;
        }
        return {
          id: row.id,
          subject,
          body,
          fullEmail,
          createdAt: row.created_at,
          raw: row,
        };
      }
    }
  } catch (err) {
    console.warn('Error fetching from application_emails table:', err);
  }

  return null;
}
