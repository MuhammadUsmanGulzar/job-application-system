import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';

const SETTINGS_KEY = '@job_system_settings';
const APPLICATIONS_KEY = '@job_system_applications';

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
// USER SETTINGS & APIS
// --------------------------------------------------------

export async function getSettings(userId) {
  // 1. Try reading from Supabase if user is logged in
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
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
// APPLICATION HISTORY & RECORDS
// --------------------------------------------------------

export async function getApplications(userId) {
  // 1. Try reading from Supabase
  if (userId) {
    try {
      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!error && data) {
        const mapped = data.map(item => ({
          id: item.id,
          jobTitle: item.job_title,
          companyName: item.company_name,
          recipientEmail: item.recipient_email,
          requirements: item.requirements,
          description: item.description,
          generatedEmail: item.generated_email,
          status: item.status,
          createdAt: item.created_at,
        }));
        await AsyncStorage.setItem(`${APPLICATIONS_KEY}_${userId}`, JSON.stringify(mapped));
        return mapped;
      }
    } catch (e) {
      console.log('Supabase applications fallback to local storage:', e.message);
    }
  }

  // 2. Local fallback
  try {
    const key = userId ? `${APPLICATIONS_KEY}_${userId}` : APPLICATIONS_KEY;
    const data = await AsyncStorage.getItem(key);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error reading applications from storage', e);
  }
  return [];
}

export async function saveApplication(userId, application) {
  // 1. Update local storage
  const key = userId ? `${APPLICATIONS_KEY}_${userId}` : APPLICATIONS_KEY;
  const current = await getApplications(userId);
  const updated = [application, ...current.filter(item => item.id !== application.id)];
  await AsyncStorage.setItem(key, JSON.stringify(updated));

  // 2. Sync to Supabase
  if (userId) {
    try {
      // Check if it's a UUID or timestamp ID
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(application.id);
      
      const payload = {
        user_id: userId,
        job_title: application.jobTitle,
        company_name: application.companyName || 'Hiring Company',
        recipient_email: application.recipientEmail || null,
        requirements: application.requirements || null,
        description: application.description || null,
        generated_email: application.generatedEmail || null,
        status: application.status || 'Draft',
        updated_at: new Date().toISOString(),
      };

      if (isUuid) {
        payload.id = application.id;
      }

      await supabase.from('applications').upsert(payload);
    } catch (e) {
      console.warn('Could not sync application to Supabase:', e);
    }
  }

  return updated;
}

export async function deleteApplication(userId, applicationId) {
  // 1. Delete locally
  const key = userId ? `${APPLICATIONS_KEY}_${userId}` : APPLICATIONS_KEY;
  const current = await getApplications(userId);
  const updated = current.filter(item => item.id !== applicationId);
  await AsyncStorage.setItem(key, JSON.stringify(updated));

  // 2. Delete from Supabase
  if (userId) {
    try {
      await supabase
        .from('applications')
        .delete()
        .eq('id', applicationId)
        .eq('user_id', userId);
    } catch (e) {
      console.warn('Could not delete application from Supabase:', e);
    }
  }

  return updated;
}
