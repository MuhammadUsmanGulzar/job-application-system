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
        const mapped = {
          llmProvider: data.llm_provider || 'OpenAI',
          llmApiKey: data.llm_api_key || '',
          llmModel: data.llm_model || 'gpt-4o-mini',
          googleSenderEmail: data.google_sender_email || '',
          googleClientId: data.google_client_id || '',
          googleClientSecret: data.google_client_secret || '',
          resumeName: data.resume_name || '',
          resumeContent: data.resume_content || '',
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

    return { success: true, filePath, data };
  } catch (err) {
    console.error('Resume bucket upload error:', err);
    throw err;
  }
}

// --------------------------------------------------------
// APPLICATION HISTORY & RECORDS (SYNCHRONIZED WITH SUPABASE DB)
// --------------------------------------------------------

export function mapApplicationRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobTitle: row.job_title || '',
    companyName: row.company_name || 'Hiring Company',
    recipientEmail: row.recipient_email || '',
    requirements: row.requirements || '',
    description: row.description || '',
    generatedEmail: row.generated_email || '',
    status: row.status || 'Generating',
    resumeId: row.resume_id || null,
    appliedAt: row.applied_at || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

export async function getApplications(userId) {
  if (!userId) return [];

  // 1. Production-level Supabase query directly from 'applications' table
  try {
    const { data, error } = await supabase
      .from('applications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const mapped = data.map(mapApplicationRow);
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
      return JSON.parse(data);
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
  const insertPayload = {
    user_id: userId,
    job_title: formDetails.jobTitle?.trim() || '',
    company_name: formDetails.companyName?.trim() || 'Hiring Company',
    recipient_email: formDetails.recipientEmail?.trim() || null,
    requirements: formDetails.requirements?.trim() || null,
    description: formDetails.description?.trim() || null,
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

  // 1. Sync to Supabase
  if (userId) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(applicationId);
      if (isUuid) {
        const { error } = await supabase
          .from('applications')
          .update({
            generated_email: generatedEmail,
            status: 'Generated',
            updated_at: new Date().toISOString(),
          })
          .eq('id', applicationId)
          .eq('user_id', userId);

        if (error) {
          console.warn('Error updating generated email in Supabase:', error.message);
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
  }

  // 2. Update local cache
  let updatedList = [];
  try {
    const key = userId ? `${APPLICATIONS_KEY}_${userId}` : APPLICATIONS_KEY;
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
    generated_email: application.generatedEmail || null,
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
  }

  // 2. Update local cache
  let updated = [];
  try {
    const key = userId ? `${APPLICATIONS_KEY}_${userId}` : APPLICATIONS_KEY;
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
  }

  // 2. Delete locally
  const key = userId ? `${APPLICATIONS_KEY}_${userId}` : APPLICATIONS_KEY;
  const current = await getApplications(userId);
  const updated = current.filter(item => item.id !== applicationId);
  await AsyncStorage.setItem(key, JSON.stringify(updated));

  return updated;
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

    if (isUuid && submittedAfter) {
      query = query.or(`application_id.eq.${applicationId},created_at.gte.${submittedAfter}`);
    } else if (isUuid) {
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
