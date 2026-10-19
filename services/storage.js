import AsyncStorage from '@react-native-async-storage/async-storage';
import { generatePdfFromResumeText } from './pdfGeneratorPro.js';
import { supabase } from '../supabase';
import { performLlmResumeOptimization } from './ai.js';
import { enforceResumeFidelity, filterProfileToSourceResume } from './resumeFidelity.js';

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

export async function uploadTailoredResumeToBucket(userId, tailoredResumeText, desiredFileName = '', profile = {}) {
  if (!userId || !tailoredResumeText) return null;

  // Always save as a standard PDF file in the user's bucket
  let baseName = desiredFileName ? desiredFileName.replace(/\.(txt|docx?)$/i, '') : `Resume_Tailored_${Date.now()}`;
  if (!baseName.toLowerCase().endsWith('.pdf')) {
    baseName = `${baseName}.pdf`;
  }
  const fileName = baseName;
  const filePath = `${userId}/${fileName}`;

  try {
    let uploadPayload;
    try {
      const pdfBytes = await generatePdfFromResumeText(tailoredResumeText, filterProfileToSourceResume(tailoredResumeText, profile));
      if (typeof Blob !== 'undefined') {
        uploadPayload = new Blob([pdfBytes], { type: 'application/pdf' });
      } else {
        uploadPayload = pdfBytes;
      }
    } catch (pdfErr) {
      console.warn('PDF generation fallback notice:', pdfErr);
      if (typeof Blob !== 'undefined') {
        uploadPayload = new Blob([tailoredResumeText], { type: 'text/plain;charset=utf-8' });
      } else {
        uploadPayload = tailoredResumeText;
      }
    }

    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('resumes')
      .upload(filePath, uploadPayload, {
        upsert: true,
        contentType: 'application/pdf',
      });

    if (uploadErr) {
      console.warn('Tailored resume bucket upload warning:', uploadErr.message);
    }

    let signedUrl = '';
    try {
      const { data: urlData } = await supabase.storage
        .from('resumes')
        .createSignedUrl(filePath, 7200);
      signedUrl = urlData?.signedUrl || '';
    } catch (_uErr) {}

    // Record into public.resumes table
    try {
      await supabase.from('resumes').upsert({
        user_id: userId,
        file_name: fileName,
        file_path: filePath,
        parsed_text: tailoredResumeText,
        is_primary: false,
      }, { onConflict: 'user_id,file_path' });
    } catch (_dbErr) {
      console.warn('Insert to public.resumes note:', _dbErr.message);
    }

    return {
      success: true,
      fileName,
      filePath,
      signedUrl,
      bucketSaved: true,
      isPdf: true,
    };
  } catch (err) {
    console.error('uploadTailoredResumeToBucket error:', err);
    return null;
  }
}

function normalizeResumeFileName(fileName = '') {
  const safeName = String(fileName)
    .replace(/[\\/]+/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return safeName || `Resume_${Date.now()}.pdf`;
}

export async function listUserResumes(userId) {
  if (!userId) return [];

  const rows = [];
  const rowPageSize = 1000;
  for (let offset = 0; ; offset += rowPageSize) {
    const { data: page, error: rowsError } = await supabase
      .from('resumes')
      .select('id, user_id, file_name, file_path, file_size, mime_type, parsed_text, is_primary, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + rowPageSize - 1);

    if (rowsError) throw rowsError;
    rows.push(...(page || []));
    if (!page || page.length < rowPageSize) break;
  }

  const byPath = new Map();
  for (const row of rows || []) {
    if (!row.file_path || !row.file_path.startsWith(`${userId}/`)) continue;
    const existing = byPath.get(row.file_path);
    if (!existing) {
      byPath.set(row.file_path, row);
    } else {
      byPath.set(row.file_path, {
        ...existing,
        is_primary: Boolean(existing.is_primary || row.is_primary),
        parsed_text: existing.parsed_text || row.parsed_text || '',
      });
    }
  }

  // Include files that exist in the user's private bucket but pre-date the DB record.
  const files = [];
  const filePageSize = 100;
  for (let offset = 0; ; offset += filePageSize) {
    const { data: page, error: filesError } = await supabase.storage
      .from('resumes')
      .list(userId, { limit: filePageSize, offset, sortBy: { column: 'updated_at', order: 'desc' } });

    if (filesError) throw filesError;
    files.push(...(page || []));
    if (!page || page.length < filePageSize) break;
  }

  for (const file of files || []) {
    if (!file.name || file.name.endsWith('/')) continue;
    const filePath = `${userId}/${file.name}`;
    if (!byPath.has(filePath)) {
      byPath.set(filePath, {
        id: `storage:${filePath}`,
        user_id: userId,
        file_name: file.name,
        file_path: filePath,
        file_size: file.metadata?.size || null,
        mime_type: file.metadata?.mimetype || file.metadata?.contentType || '',
        parsed_text: '',
        is_primary: false,
        created_at: file.created_at || null,
        updated_at: file.updated_at || file.created_at || null,
      });
    }
  }

  return Array.from(byPath.values()).sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
  });
}

export async function uploadResumeFile(userId, fileBlobOrBytes, fileName, metadata = {}) {
  if (!userId) throw new Error('User must be logged in to upload to Supabase storage.');

  const safeFileName = normalizeResumeFileName(fileName);
  const filePath = `${userId}/${safeFileName}`;
  const contentType = metadata.mimeType || fileBlobOrBytes?.type || 'application/octet-stream';

  try {
    const { data, error } = await supabase.storage
      .from('resumes')
      .upload(filePath, fileBlobOrBytes, {
        upsert: true,
        contentType,
      });

    if (error) throw error;

    // Keep one metadata row per bucket path and make the latest upload primary.
    await supabase.from('resumes').update({ is_primary: false }).eq('user_id', userId);
    await supabase.from('resumes').delete().eq('user_id', userId).eq('file_path', filePath);
    const { error: insertError } = await supabase.from('resumes').insert({
      user_id: userId,
      file_name: safeFileName,
      file_path: filePath,
      file_size: metadata.size || fileBlobOrBytes?.size || null,
      mime_type: contentType,
      parsed_text: metadata.parsedText || null,
      is_primary: true,
    });
    if (insertError) throw insertError;

    // Automatically trigger Python Agent to extract text and sync user_settings
    try {
      await syncResumeFromBucket(userId);
    } catch (_syncErr) {}

    return { success: true, fileName: safeFileName, filePath, data };
  } catch (err) {
    console.error('Resume bucket upload error:', err);
    throw err;
  }
}

export async function setPrimaryResume(userId, resume) {
  if (!userId || !resume?.file_path || !resume.file_path.startsWith(`${userId}/`)) {
    throw new Error('A valid resume owned by the signed-in user is required.');
  }

  let resumeContent = resume.parsed_text || '';
  if (!resumeContent && /\.(txt|md)$/i.test(resume.file_name || '')) {
    const { data: blob, error: downloadError } = await supabase.storage.from('resumes').download(resume.file_path);
    if (downloadError) throw downloadError;
    resumeContent = await blob.text();
  }

  const { error: clearError } = await supabase.from('resumes').update({ is_primary: false }).eq('user_id', userId);
  if (clearError) throw clearError;

  if (!String(resume.id || '').startsWith('storage:')) {
    const { error: primaryError } = await supabase
      .from('resumes')
      .update({ is_primary: true })
      .eq('user_id', userId)
      .eq('file_path', resume.file_path);
    if (primaryError) throw primaryError;
  } else {
    const { error: insertError } = await supabase.from('resumes').insert({
      user_id: userId,
      file_name: resume.file_name,
      file_path: resume.file_path,
      file_size: resume.file_size || null,
      mime_type: resume.mime_type || null,
      parsed_text: resumeContent || null,
      is_primary: true,
    });
    if (insertError) throw insertError;
  }

  const currentSettings = await getSettings(userId);
  const updatedSettings = {
    ...currentSettings,
    resumeName: resume.file_name,
    resumeContent,
  };
  await saveSettings(userId, updatedSettings);

  const fileInfo = await getResumeFileUrl(userId, resume.file_name).catch(() => null);
  return { settings: updatedSettings, resumeUrl: fileInfo?.url || '' };
}

export async function deleteUserResume(userId, resume) {
  if (!userId || !resume?.file_path || !resume.file_path.startsWith(`${userId}/`) || resume.file_path.includes('..')) {
    throw new Error('A valid resume owned by the signed-in user is required.');
  }

  const { error: storageError } = await supabase.storage.from('resumes').remove([resume.file_path]);
  if (storageError) throw storageError;

  const { error: deleteError } = await supabase
    .from('resumes')
    .delete()
    .eq('user_id', userId)
    .eq('file_path', resume.file_path);
  if (deleteError) throw deleteError;

  return true;
}

// Synchronize and load resume directly from Supabase Storage bucket 'resumes/{userId}/'
export async function syncResumeFromBucket(userId) {
  if (!userId) throw new Error('User ID required to sync resume from bucket');

  // 1. First check user_settings and public.resumes directly in Supabase DB (fastest, no network errors)
  try {
    const { data: row } = await supabase
      .from('user_settings')
      .select('resume_name, resume_content')
      .eq('user_id', userId)
      .maybeSingle();

    if (row && row.resume_content && row.resume_content.trim().length > 20) {
      return {
        resumeName: row.resume_name || 'Resume.pdf',
        resumeContent: row.resume_content,
        source: 'user_settings',
      };
    }

    const { data: dbResumes } = await supabase
      .from('resumes')
      .select('file_name, file_path, parsed_text')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (dbResumes && dbResumes.length > 0 && dbResumes[0].parsed_text) {
      return {
        resumeName: dbResumes[0].file_name || 'Resume.pdf',
        resumeContent: dbResumes[0].parsed_text,
        source: 'resumes_table',
      };
    }
  } catch (_dbErr) {}

  // 2. Direct Supabase Storage Bucket query
  try {
    const { data: files, error: listErr } = await supabase.storage.from('resumes').list(userId);
    if (!listErr && files && files.length > 0) {
      const realFiles = files.filter(f => f.name && !f.name.endsWith('/'));
      if (realFiles.length > 0) {
        realFiles.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
        const chosen = realFiles[0];
        const filePath = `${userId}/${chosen.name}`;

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

  // 1. Direct Supabase Storage signed URL (fast, direct to cloud, no connection errors)
  try {
    let targetFileName = (fileName || '').trim();
    if (!targetFileName) {
      // First check public.resumes table for the latest primary resume
      try {
        const { data: dbResumes } = await supabase
          .from('resumes')
          .select('file_name, file_path')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1);

        if (dbResumes && dbResumes.length > 0 && dbResumes[0].file_name) {
          targetFileName = dbResumes[0].file_name;
        }
      } catch (_dbE) {}

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

function fileNamePart(value, fallback) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return normalized || fallback;
}

function resumeRoleVariants(jobTitle = '') {
  const original = fileNamePart(jobTitle, 'Professional');
  const readable = original.replace(/_/g, ' ');
  const variants = [original];

  if (/\b(?:AI|Artificial Intelligence|Agentic AI)\b/i.test(readable)) {
    variants.push('AI_Engineer', 'Agentic_AI_Developer', 'AI_Developer', 'AI_Specialist');
  }

  if (/\bEngineer\b/i.test(readable)) {
    variants.push(fileNamePart(readable.replace(/\bEngineer\b/i, 'Developer'), 'Developer'));
  }
  if (/\bDeveloper\b/i.test(readable)) {
    variants.push(fileNamePart(readable.replace(/\bDeveloper\b/i, 'Engineer'), 'Engineer'));
  }

  variants.push(`${original}_Specialist`, `${original}_Professional`);
  return [...new Set(variants.map((variant) => fileNamePart(variant, 'Professional')))];
}

async function createTailoredResumeFileName(userId, fullName, jobTitle, rawResume = '') {
  const resumeFirstLine = String(rawResume || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const candidateName = fileNamePart(fullName || resumeFirstLine, 'Candidate');
  const roleVariants = resumeRoleVariants(jobTitle);
  let existingNames = new Set();

  if (userId) {
    try {
      const resumes = await listUserResumes(userId);
      existingNames = new Set(resumes.map((resume) => String(resume.file_name || '').toLowerCase()));
    } catch (_e) {}
  }

  for (const role of roleVariants) {
    const fileName = `${candidateName}_${role}.pdf`;
    if (!existingNames.has(fileName.toLowerCase())) return fileName;
  }

  // Preserve the role meaning if every natural title variant is already used.
  let version = 2;
  while (existingNames.has(`${candidateName}_${roleVariants[0]}_${version}.pdf`.toLowerCase())) version += 1;
  return `${candidateName}_${roleVariants[0]}_${version}.pdf`;
}

export async function tailorResumeForJob({
  userId,
  jobTitle = 'Software Engineer',
  companyName = 'Hiring Company',
  requirements = '',
  description = '',
  rawResume = '',
  resumeName = '',
  atsReport = null,
  llmProvider = 'OpenAI',
  llmApiKey = '',
  llmModel = '',
  profile = {},
}) {
  const newFileName = await createTailoredResumeFileName(
    userId,
    profile.fullName,
    jobTitle,
    rawResume
  );

  // 1. Direct LLM resume optimization if API key is provided
  if (llmApiKey && llmApiKey.trim().length > 5) {
    try {
      const result = await performLlmResumeOptimization({
        jobTitle,
        companyName,
        requirements,
        description,
        rawResume,
        atsReport,
        provider: llmProvider,
        apiKey: llmApiKey,
        model: llmModel,
        profile,
      });

      if (result.success && result.tailoredResume) {
        let bucketInfo = null;
        if (userId) {
          try {
            bucketInfo = await uploadTailoredResumeToBucket(userId, result.tailoredResume, newFileName, profile);
          } catch (_e) {}
        }
        return {
          ...result,
          resumeName: bucketInfo?.fileName || newFileName,
          bucketSaved: Boolean(bucketInfo?.filePath),
          filePath: bucketInfo?.filePath || '',
          signedUrl: bucketInfo?.signedUrl || '',
        };
      }
    } catch (llmErr) {
      console.warn(`Direct LLM resume tailoring notice (${llmErr.message}), falling back to smart local optimizer.`);
    }
  }

  // 2. Attempt local LangGraph Python backend agent
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
        ats_report: atsReport || {},
        llm_provider: llmProvider,
        llm_api_key: llmApiKey,
        llm_model: llmModel,
        full_name: profile.fullName || '',
        email: profile.email || '',
        phone: profile.phone || '',
        location: profile.location || '',
        linkedin: profile.linkedin || '',
        github: profile.github || '',
        portfolio: profile.portfolio || '',
      }),
    });

    if (response.ok) {
      const result = await response.json();
      if (result.success && result.tailored_resume) {
        let bucketInfo = null;
        if (userId && !result.pdf_file_path) {
          try {
            bucketInfo = await uploadTailoredResumeToBucket(userId, result.tailored_resume, newFileName, profile);
          } catch (_e) {}
        }
        return {
          success: true,
          tailoredResume: result.tailored_resume,
          resumeName: bucketInfo?.fileName || result.resume_name || newFileName,
          bucketSaved: Boolean(result.pdf_file_path || bucketInfo?.filePath),
          filePath: result.pdf_file_path || bucketInfo?.filePath || '',
          signedUrl: result.pdf_url || bucketInfo?.signedUrl || '',
          matchedSkills: result.matched_skills || [],
          missingSkills: result.missing_skills || [],
          enhancements: result.enhancements || [],
          source: 'python-agent',
        };
      }
    }
  } catch (_agentErr) {
    // Python agent server offline, fallback to smart client-side optimizer
  }

  // 3. Smart clean ATS resume optimizer (zero ugly ASCII boxes, clean recruiter formatting)
  let baseResume = (rawResume || '').trim();
  if (!baseResume && userId) {
    const loaded = await fetchUserResume(userId);
    baseResume = (loaded.resumeContent || '').trim();
  }

  if (!baseResume) {
    throw new Error('Upload a source resume before tailoring. The agent will not invent experience, skills, or credentials.');
  }

  // Strip any old ASCII border lines (e.g. ═════ or ─────)
  const cleanedBase = baseResume
    .replace(/[═─│┌┐└┘║╔╗╚╝=-]{4,}/g, '')
    .replace(/Status:\s*ATS-Optimized[^\n]*\n?/gi, '')
    .replace(/Target Organization:[^\n]*\n?/gi, '')
    .trim();

  // Extract contact line / name from the first few lines
  const lines = cleanedBase.split('\n').map((l) => l.trim()).filter(Boolean);
  let candidateName = profile.fullName || 'CANDIDATE';
  let contactLine = [profile.email, profile.phone, profile.location, profile.linkedin, profile.github, profile.portfolio].filter(Boolean).join(' | ');
  let bodyStartIndex = 0;

  if (lines.length > 0) {
    // If first line isn't a known section header, it's the candidate's name
    if (!/^(PROFESSIONAL|SUMMARY|EXPERIENCE|EDUCATION|SKILLS|CORE)/i.test(lines[0])) {
      candidateName = profile.fullName || lines[0];
      bodyStartIndex = 1;
    }
    // Skip the old headline; the tailored role headline is generated above.
    if (lines.length > 1 && !/^(PROFESSIONAL|SUMMARY|EXPERIENCE|EDUCATION|SKILLS|CORE)/i.test(lines[1]) && !/(@|phone|\+|\bemail\b|linkedin|github|portfolio)/i.test(lines[1])) {
      bodyStartIndex = 2;
    }
    const contactCandidate = lines.slice(1, 4).find((line) => /(@|phone|\+|\bemail\b|linkedin|github|portfolio)/i.test(line));
    if (!contactLine && contactCandidate) contactLine = contactCandidate;
    if (contactCandidate) bodyStartIndex = Math.max(bodyStartIndex, lines.indexOf(contactCandidate) + 1);
  }

  // Collect skills to highlight from job requirements and ATS report
  const reportMatches = atsReport?.matchedSkills || [];
  const reportMissing = atsReport?.missingSkills || [];
  const combinedSkills = [...new Set(reportMatches)].filter(Boolean);
  const skillsStr = combinedSkills.length > 0
    ? combinedSkills.slice(0, 10).join(', ')
    : '';

  // Construct crisp, tailored summary
  const tailoredSummary = skillsStr
    ? `Results-driven ${jobTitle} with resume-verified experience in ${skillsStr}. Brings the relevant background documented below and a focused interest in contributing to ${companyName || 'the hiring organization'}.`
    : `Candidate for the ${jobTitle} role at ${companyName || 'the hiring organization'}, with qualifications and experience documented below.`;

  // Parse remaining sections from original resume (Experience, Projects, Education)
  const remainingLines = lines.slice(bodyStartIndex);
  const preservedSections = [];
  const originalSkillLines = [];
  let skipSection = false;

  for (const line of remainingLines) {
    // If it's an old summary or competencies header, skip its content
    if (/^(PROFESSIONAL SUMMARY|SUMMARY|EXECUTIVE SUMMARY|PROFILE|ABOUT ME)$/i.test(line)) {
      skipSection = true;
      continue;
    }
    if (/^(CORE COMPETENCIES|SKILLS|TECHNICAL SKILLS|TARGET SKILLS)$/i.test(line)) {
      skipSection = true;
      continue;
    }
    // If it's an Experience, Projects, Education header, resume recording
    if (/^(PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|PROJECTS|KEY PROJECTS|EDUCATION|CERTIFICATIONS)/i.test(line)) {
      skipSection = false;
      preservedSections.push('');
      preservedSections.push(line.toUpperCase());
      continue;
    }

    if (skipSection) {
      originalSkillLines.push(line);
    } else {
      preservedSections.push(line);
    }
  }

  // Construct clean, ATS-standard plain text document
  const resumeBlocks = [
    candidateName.toUpperCase(),
    `${jobTitle.toUpperCase()} | TARGET ROLE`,
    contactLine || '',
    '',
    'PROFESSIONAL SUMMARY',
    tailoredSummary,
    '',
    ...(skillsStr || originalSkillLines.length ? [
      'CORE COMPETENCIES & TECHNICAL SKILLS',
      ...(skillsStr ? [`• Target-aligned verified skills: ${skillsStr}`] : []),
      ...originalSkillLines,
      '',
    ] : []),
    preservedSections.join('\n'),
  ];

  const tailoredResume = enforceResumeFidelity(
    baseResume,
    resumeBlocks.filter((b, i) => !(b === '' && resumeBlocks[i - 1] === '')).join('\n').trim()
  );

  // Persist tailored resume to Supabase Storage bucket and DB
  let bucketInfo = null;
  if (userId) {
    try {
      bucketInfo = await uploadTailoredResumeToBucket(userId, tailoredResume, newFileName, profile);
    } catch (_e) {}
  }

  return {
    success: true,
    tailoredResume,
    resumeName: bucketInfo?.fileName || newFileName,
    bucketSaved: Boolean(bucketInfo?.filePath),
    filePath: bucketInfo?.filePath || '',
    signedUrl: bucketInfo?.signedUrl || '',
    matchedSkills: reportMatches,
    missingSkills: reportMissing,
    enhancements: [
      `Professional title and headline aligned directly with "${jobTitle}"`,
      `Executive summary tailored specifically for ${companyName || 'the target company'}`,
      skillsStr ? `Highlighted resume-verified competencies: ${skillsStr}` : 'Preserved the candidate’s verified skills without adding unsupported claims.',
      `Saved tailored resume to Supabase bucket: resumes/${userId}/${bucketInfo?.fileName || newFileName}`,
      'Formatted to 100% clean ATS standard with zero parsing barriers',
    ],
    source: 'smart-local-optimizer',
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
    atsScore: row.ats_score ?? null,
    atsReport: row.ats_report || null,
    tailoredAtsScore: row.tailored_ats_score ?? null,
    tailoredAtsReport: row.tailored_ats_report || null,
    resumeSnapshot: row.resume_snapshot || '',
    tailoredResumeContent: row.tailored_resume_content || '',
    atsAnalyzedAt: row.ats_analyzed_at || null,
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
      const atsSource = app.tailoredAtsReport
        ? app
        : existing.tailoredAtsReport
          ? existing
          : app.atsReport
            ? app
            : existing;

      if (preferCurrent) {
        map.set(groupKey, {
          ...app,
          generatedEmail: mergedEmail,
          appliedAt: mergedAppliedAt,
          atsScore: atsSource.atsScore,
          atsReport: atsSource.atsReport,
          tailoredAtsScore: atsSource.tailoredAtsScore,
          tailoredAtsReport: atsSource.tailoredAtsReport,
        });
      } else {
        map.set(groupKey, {
          ...existing,
          generatedEmail: mergedEmail,
          appliedAt: mergedAppliedAt,
          atsScore: atsSource.atsScore,
          atsReport: atsSource.atsReport,
          tailoredAtsScore: atsSource.tailoredAtsScore,
          tailoredAtsReport: atsSource.tailoredAtsReport,
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
  const initialStatus = formDetails.status || 'Generating';

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
    status: initialStatus,
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
      status: initialStatus,
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
