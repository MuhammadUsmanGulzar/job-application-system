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
  updateApplicationGeneratedEmail
} from './services/storage';
import { LLM_PROVIDERS_CONFIG } from './services/ai';
import { sendEmail } from './services/email';

export default function AppWeb() {
  const { width } = useWindowDimensions();
  const isCompact = width < 980;
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

  const [resumeFeedback, setResumeFeedback] = useState('');
  const [llmFeedback, setLlmFeedback] = useState('');
  const [googleFeedback, setGoogleFeedback] = useState('');

  const [showGmailGuide, setShowGmailGuide] = useState(true);
  const [guideMethod, setGuideMethod] = useState('appPassword');

  // Job Application Form State
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [requirements, setRequirements] = useState('');
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const [generatedResult, setGeneratedResult] = useState(null);
  const pollIntervalRef = useRef(null);

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

  // Applications History State
  const [applications, setApplications] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);

  const loadUserData = React.useCallback(async (userId, userEmail) => {
    const userSettings = await getSettings(userId);
    setSettings(userSettings);
    const userProfile = await getProfile(userId, userEmail);
    setProfile(userProfile);
    const userApps = await getApplications(userId);
    setApplications(userApps);
  }, []);

  // Auth session listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthenticated(!!session);
      if (session?.user?.id) {
        loadUserData(session.user.id, session.user.email);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsAuthenticated(!!session);
      if (session?.user?.id) {
        loadUserData(session.user.id, session.user.email);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadUserData]);

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

  // Submit Application, Immediately Save to 'applications' table, Start Timer/Loader & Trigger n8n
  const handleGenerateAndApply = async () => {
    if (!jobTitle.trim()) {
      window.alert('Please enter a Job Title.');
      return;
    }

    // 1. Ensure User ID from DB (Supabase Auth session)
    let userId = session?.user?.id;
    if (!userId) {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      userId = freshSession?.user?.id;
    }

    if (!userId) {
      window.alert('Authentication required. Please sign in to submit.');
      return;
    }

    // 2. IMMEDIATELY SAVE FORM DETAILS IN TABLE 'applications' ON BUTTON CLICK
    let createdApp = null;
    let createdAppId = null;
    try {
      const result = await createApplication(userId, {
        jobTitle: jobTitle.trim(),
        companyName: companyName.trim(),
        recipientEmail: recipientEmail.trim(),
        requirements: requirements.trim(),
        description: description.trim(),
      });
      createdApp = result.application;
      createdAppId = result.id;

      // Instantly refresh applications state so it appears in history right away
      const refreshedList = await getApplications(userId);
      setApplications(refreshedList);
    } catch (saveErr) {
      console.warn('Initial application save warning:', saveErr.message);
    }

    // 3. Start timer & loader immediately
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setIsGenerating(true);
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
      jobTitle: jobTitle.trim(),
      job_title: jobTitle.trim(),
      companyName: companyName.trim(),
      company_name: companyName.trim(),
      recipientEmail: recipientEmail.trim(),
      recipient_email: recipientEmail.trim(),
      requirements: requirements.trim(),
      description: description.trim(),
    };

    let directWebhookContent = '';

    // 5. Trigger the n8n webhook asynchronously
    fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
    })
      .then(async (wbRes) => {
        if (wbRes.ok) {
          const rawText = await wbRes.text();
          if (rawText && rawText.trim()) {
            try {
              const data = JSON.parse(rawText);
              if (typeof data === 'string') directWebhookContent = data;
              else if (Array.isArray(data) && data.length > 0) {
                const first = data[0];
                directWebhookContent = first.generated_email || first.output || first.text || first.response || first.body || '';
              } else if (typeof data === 'object' && data !== null) {
                directWebhookContent = data.generated_email || data.output || data.text || data.response || data.body || '';
              }
            } catch (_) {
              if (rawText.length > 30) directWebhookContent = rawText;
            }
          }
        }
      })
      .catch((wbErr) => {
        console.warn('n8n Webhook trigger note:', wbErr.message);
      });

    // 6. Poll application_emails table in Supabase
    const pollStartTime = Date.now();
    const maxPollTimeMs = 120000; // 2 minutes

    const onEmailFound = async (generatedContent) => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsGenerating(false);

      // Update the record in 'applications' table with the generated email
      if (createdAppId) {
        await updateApplicationGeneratedEmail(userId, createdAppId, generatedContent);
      }

      const finalApp = {
        id: createdAppId || Date.now().toString(),
        jobTitle: jobTitle.trim(),
        companyName: companyName.trim() || 'Hiring Company',
        recipientEmail: recipientEmail.trim(),
        requirements: requirements.trim(),
        description: description.trim(),
        generatedEmail: generatedContent,
        status: recipientEmail.trim() ? 'Applied' : 'Generated',
        createdAt: createdApp?.createdAt || new Date().toISOString(),
      };

      const refreshedList = await getApplications(userId);
      setApplications(refreshedList);
      setGeneratedResult(finalApp);
    };

    pollIntervalRef.current = setInterval(async () => {
      // Check application_emails table in Supabase
      const emailRecord = await fetchLatestApplicationEmail(userId, submitTime, createdAppId);
      if (emailRecord && emailRecord.fullEmail) {
        await onEmailFound(emailRecord.fullEmail);
        return;
      }

      // Check if direct response arrived from webhook
      if (directWebhookContent && directWebhookContent.trim()) {
        await onEmailFound(directWebhookContent);
        return;
      }

      // Check timeout
      if (Date.now() - pollStartTime > maxPollTimeMs) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setIsGenerating(false);
        window.alert(
          'Email generation timed out waiting for output in application_emails table. Your application details are already saved in Applications history.'
        );
      }
    }, 2000);
  };

  // Send Email Action
  const handleSendEmail = async (appRecord) => {
    if (!appRecord?.recipientEmail) {
      window.alert('Please specify a recipient email to send the application.');
      return;
    }

    try {
      await sendEmail({
        to: appRecord.recipientEmail,
        subject: `Application for ${appRecord.jobTitle} - ${session?.user?.email || 'Candidate'}`,
        body: appRecord.generatedEmail,
        senderEmail: settings.googleSenderEmail,
        googleClientId: settings.googleClientId,
        googleClientSecret: settings.googleClientSecret,
      });

      // Update status to Applied
      const updated = { ...appRecord, status: 'Applied' };
      const updatedList = await saveApplication(session?.user?.id, updated);
      if (updatedList) setApplications(updatedList);
      if (generatedResult?.id === appRecord.id) setGeneratedResult(updated);
      if (selectedRecord?.id === appRecord.id) setSelectedRecord(updated);
    } catch (e) {
      window.alert('Failed to send email: ' + e.message);
    }
  };

  // Delete Record
  const handleDeleteRecord = async (id) => {
    if (window.confirm('Are you sure you want to remove this application record?')) {
      const updated = await deleteApplication(session?.user?.id, id);
      if (updated) setApplications(updated);
      if (selectedRecord?.id === id) setSelectedRecord(null);
    }
  };

  // Copy to clipboard
  const handleCopy = (text) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      window.alert('Copied to clipboard!');
    }
  };

  const handleOpenRecord = async (item) => {
    setSelectedRecord({ ...item, isLoadingEmail: true });
    try {
      const emailRecord = await fetchLatestApplicationEmail(session?.user?.id, null, item.id);
      if (emailRecord && emailRecord.fullEmail) {
        setSelectedRecord(prev => {
          if (prev && prev.id === item.id) {
            return { ...prev, isLoadingEmail: false, generatedEmail: emailRecord.fullEmail };
          }
          return prev;
        });
      } else {
        setSelectedRecord(prev => prev && prev.id === item.id ? { ...prev, isLoadingEmail: false } : prev);
      }
    } catch (err) {
      console.warn('Error fetching email for modal:', err);
      setSelectedRecord(prev => prev && prev.id === item.id ? { ...prev, isLoadingEmail: false } : prev);
    }
  };

  // ---------------- AUTH SCREEN ----------------
  if (!isAuthenticated) {
    return (
      <View style={styles.webContainer}>
        {/* Left Side: Hero Section */}
        <View style={styles.leftPanel}>
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
        <View style={styles.rightPanel}>
          <View style={styles.authCard}>
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
      <View style={[styles.webNavbar, isCompact && styles.webNavbarCompact]}>
        <View style={styles.brandContainer}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>J</Text>
          </View>
          <Text style={styles.navbarBrand}>JobApply</Text>
        </View>

        {/* Navigation Tabs */}
        <View style={[styles.navTabs, isCompact && styles.navTabsCompact]}>
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
            style={[styles.navTabItem, activeTab === 'settings' && styles.navTabItemActive]} 
            onPress={() => setActiveTab('settings')}
          >
            <Text style={[styles.navTabText, activeTab === 'settings' && styles.navTabTextActive]}>
              Settings
            </Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.navbarRight, isCompact && styles.navbarRightCompact]}>
          <Text style={styles.userEmail}>
            {session?.user?.user_metadata?.full_name 
              ? `${session.user.user_metadata.full_name} (${session.user.email})`
              : (session?.user?.email || 'User')}
          </Text>
          <TouchableOpacity onPress={() => supabase.auth.signOut()} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content Area */}
      <ScrollView contentContainerStyle={[styles.webContent, isCompact && styles.webContentCompact]}>
        {/* ================= TAB 1: APPLY FOR JOB ================= */}
        {activeTab === 'apply' && (
          <View style={styles.pageContainer}>

            <View style={[styles.splitLayout, isCompact && styles.splitLayoutCompact]}>
              {/* Form Card */}
              <View style={styles.flexCard}>
                <Text style={styles.cardTitle}>Job Application Form</Text>
                <Text style={styles.cardDescription}>
                  Add the opportunity details and create a tailored first draft from your saved profile.
                </Text>

                <View style={styles.formRow}>
                  <View style={[styles.formGroup, { flex: 1, marginRight: 12 }]}>
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

                <TouchableOpacity 
                  style={[styles.webPrimaryButton, isGenerating && styles.disabledButton]}
                  onPress={handleGenerateAndApply}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <ActivityIndicator color="#ffffff" style={{ marginRight: 10 }} />
                      <Text style={styles.webPrimaryButtonText}>
                        Generating Email... ({formatTime(generationSeconds)})
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.webPrimaryButtonText}>Generate application</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Output Preview Card */}
              <View style={styles.flexCard}>
                <Text style={styles.cardTitle}>Generated Application Email</Text>
                <Text style={styles.cardDescription}>
                  Review, edit, copy, or send your personalized email directly to the recruiter.
                </Text>

                {isGenerating ? (
                  <View style={styles.generatingStateBox}>
                    <View style={styles.pulseLoaderCircle}>
                      <ActivityIndicator size="large" color="#2563eb" />
                    </View>
                    <Text style={styles.generatingStateTitle}>
                      Your email is getting ready in a while...
                    </Text>
                    <Text style={styles.generatingStateSub}>
                      Your n8n AI workflow is crafting a tailored, high-converting pitch from your resume & target job details.
                    </Text>
                    <View style={styles.timerBadge}>
                      <Text style={styles.timerCountdown}>{formatTime(generationSeconds)}</Text>
                    </View>
                  </View>
                ) : generatedResult ? (
                  <View style={styles.generatedBox}>
                    <View style={styles.boxHeader}>
                      <View>
                        <Text style={styles.boxSub}>Recipient: {generatedResult.recipientEmail || 'None provided'}</Text>
                        <Text style={styles.boxSub}>Status: <Text style={styles.statusBadgeText}>{generatedResult.status}</Text></Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity 
                          style={styles.actionPill}
                          onPress={() => handleCopy(generatedResult.generatedEmail)}
                        >
                          <Text style={styles.actionPillText}>Copy</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={[styles.actionPill, styles.actionPillPrimary]}
                          onPress={() => handleSendEmail(generatedResult)}
                        >
                          <Text style={styles.actionPillPrimaryText}>Send</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <ScrollView style={styles.emailPreviewScroll}>
                      <Text style={styles.emailPreviewText}>{generatedResult.generatedEmail}</Text>
                    </ScrollView>
                  </View>
                ) : (
                  <View style={styles.emptyPreviewBox}>
                    <Text style={styles.emptyPreviewMark}>Aa</Text>
                    <Text style={styles.emptyPreviewTitle}>No application generated yet</Text>
                    <Text style={styles.emptyPreviewSub}>
                      Fill in the job requirements on the left and select Generate application. Your customized cover email will appear here.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ================= TAB 2: CANDIDATE PROFILE & SOCIALS ================= */}
        {activeTab === 'profile' && (
          <View style={styles.pageContainer}>
            <View style={styles.webCard}>
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
              <View style={{ flexDirection: 'row', gap: 16 }}>
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
              <View style={{ flexDirection: 'row', gap: 16 }}>
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
              <View style={{ flexDirection: 'row', gap: 16 }}>
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
              <View style={{ flexDirection: 'row', gap: 16 }}>
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
                    {profile.email ? <Text style={{ fontSize: 13, color: '#475569' }}>📧 {profile.email}</Text> : null}
                    {profile.phone ? <Text style={{ fontSize: 13, color: '#475569' }}>📱 {profile.phone}</Text> : null}
                    {profile.portfolio ? <Text style={{ fontSize: 13, color: '#2563eb' }}>🌐 {profile.portfolio}</Text> : null}
                    {profile.linkedin ? <Text style={{ fontSize: 13, color: '#2563eb' }}>💼 {profile.linkedin}</Text> : null}
                    {profile.github ? <Text style={{ fontSize: 13, color: '#2563eb' }}>💻 {profile.github}</Text> : null}
                    {profile.location ? <Text style={{ fontSize: 13, color: '#64748b' }}>📍 {profile.location}</Text> : null}
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
            <View style={styles.historyHeader}>
              <View>
                <Text style={styles.cardTitle}>Application History & Records</Text>
                <Text style={styles.cardDescription}>
                  Track all past job submissions, pitches, and responses.
                </Text>
              </View>

              <TextInput
                style={[styles.webInput, { width: 300, marginBottom: 0 }]}
                placeholder="🔍 Search company, title, email..."
                value={historySearch}
                onChangeText={setHistorySearch}
                placeholderTextColor="#9ca3af"
              />
            </View>

            {/* Quick Stats */}
            <View style={styles.statsRow}>
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
                <Text style={[styles.statNumber, { color: '#d97706' }]}>
                  {applications.filter(a => a.status === 'Generated' || a.status === 'Draft').length}
                </Text>
                <Text style={styles.statLabel}>Drafts / Prepared</Text>
              </View>
            </View>

            {filteredApps.length === 0 ? (
              <View style={styles.emptyHistoryBox}>
                <Text style={{ fontSize: 48, marginBottom: 12 }}>📂</Text>
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
                {filteredApps.map((item) => (
                  <View key={item.id} style={styles.tableRow}>
                    <View style={{ flex: 2 }}>
                      <Text style={styles.rowTitle}>{item.jobTitle}</Text>
                      <Text style={styles.rowCompany}>{item.companyName} • {item.recipientEmail || 'No recipient email'}</Text>
                      <Text style={styles.rowDate}>
                        Applied: {new Date(item.createdAt).toLocaleDateString()} at {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>

                    <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
                      <View style={[styles.badgePill, item.status === 'Applied' ? styles.badgeApplied : styles.badgeDraft]}>
                        <Text style={[styles.badgePillText, item.status === 'Applied' ? styles.badgeAppliedText : styles.badgeDraftText]}>
                          {item.status}
                        </Text>
                      </View>
                      
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
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
                ))}
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
            <View style={styles.webCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>1. Candidate Resume & Profile</Text>
                <TouchableOpacity style={styles.uploadBtn} onPress={handleUploadResumeWeb}>
                  <Text style={styles.uploadBtnText}>📁 Upload Resume File (.pdf, .txt, .doc)</Text>
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
            <View style={styles.webCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={styles.sectionTitle}>2. AI Model & Backend Engine Preferences</Text>
                <View style={{ backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#bbf7d0' }}>
                  <Text style={styles.securityLabel}>Processed securely</Text>
                </View>
              </View>
              <Text style={styles.cardDescription}>
                AI generation is executed securely on your backend workflow (n8n). Configure which provider and model your backend should prioritize.
              </Text>

              <View style={{ backgroundColor: '#f8fafc', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 18 }}>
                <Text style={{ fontSize: 13, color: '#334155', lineHeight: 20 }}>
                  💡 <Text style={{ fontWeight: '700' }}>Architecture Notice:</Text> API keys and model prompts are kept safe on the backend. The frontend handles visual presentation, user inputs, and live generation status.
                </Text>
              </View>

              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 14 }]}>
                  <Text style={styles.label}>AI Provider Preference</Text>
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
                    value={settings.llmProvider || 'OpenAI'}
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
            <View style={styles.webCard}>
              <View style={styles.sectionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>3. Google Console API & Gmail Account</Text>
                  <Text style={styles.cardDescription}>
                    Connect your Gmail to send application emails directly to recruiters.
                  </Text>
                </View>
                <TouchableOpacity 
                  style={styles.guideToggleBtn}
                  onPress={() => setShowGmailGuide(!showGmailGuide)}
                >
                  <Text style={styles.guideToggleBtnText}>
                    {showGmailGuide ? 'Hide guide' : 'Connection guide'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Interactive Visual Guide */}
              {showGmailGuide && (
                <View style={styles.guideBox}>
                  <View style={styles.guideTabBar}>
                    <TouchableOpacity 
                      style={[styles.guideTabItem, guideMethod === 'appPassword' && styles.guideTabItemActive]}
                      onPress={() => setGuideMethod('appPassword')}
                    >
                      <Text style={[styles.guideTabItemText, guideMethod === 'appPassword' && styles.guideTabItemTextActive]}>
                        App password (recommended)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.guideTabItem, guideMethod === 'oauth' && styles.guideTabItemActive]}
                      onPress={() => setGuideMethod('oauth')}
                    >
                      <Text style={[styles.guideTabItemText, guideMethod === 'oauth' && styles.guideTabItemTextActive]}>
                        Google Cloud OAuth
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {guideMethod === 'appPassword' ? (
                    <View style={styles.guideContent}>
                      <Text style={styles.guideLead}>
                        The fastest & most reliable method. Takes 2 minutes and allows sending application emails directly from your Gmail:
                      </Text>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>1</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>Turn on 2-Step Verification</Text>
                          <Text style={styles.stepDesc}>
                            Make sure 2-Step Verification is active on your Google Account.
                          </Text>
                          <TouchableOpacity 
                            style={styles.linkPill}
                            onPress={() => window.open('https://myaccount.google.com/security', '_blank')}
                          >
                            <Text style={styles.linkPillText}>Open Google security</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>2</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>Generate App Password</Text>
                          <Text style={styles.stepDesc}>
                            Visit the Google App Passwords page. Name it <Text style={{ fontWeight: '700' }}>Job Apply Pro</Text> and click <Text style={{ fontWeight: '700' }}>Create</Text>.
                          </Text>
                          <TouchableOpacity 
                            style={styles.linkPill}
                            onPress={() => window.open('https://myaccount.google.com/apppasswords', '_blank')}
                          >
                            <Text style={styles.linkPillText}>Open app passwords</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>3</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>Paste Below & Save</Text>
                          <Text style={styles.stepDesc}>
                            Copy the 16-character code (e.g. <Text style={{ fontFamily: 'monospace' }}>abcd efgh ijkl mnop</Text>) into the <Text style={{ fontWeight: '700' }}>Client Secret / App Password</Text> field below, and enter your Gmail address.
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.guideContent}>
                      <Text style={styles.guideLead}>
                        For advanced/cloud users using Google Cloud OAuth 2.0 Client credentials:
                      </Text>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>1</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>Create Project in Google Cloud</Text>
                          <Text style={styles.stepDesc}>
                            Go to Google Cloud Console and create a project named <Text style={{ fontWeight: '700' }}>Job Apply System</Text>.
                          </Text>
                          <TouchableOpacity 
                            style={styles.linkPill}
                            onPress={() => window.open('https://console.cloud.google.com/projectcreate', '_blank')}
                          >
                            <Text style={styles.linkPillText}>Open Google Cloud</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>2</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>Enable Gmail API</Text>
                          <Text style={styles.stepDesc}>
                            Under <Text style={{ fontWeight: '700' }}>APIs & Services, then Library</Text>, search for <Text style={{ fontWeight: '700' }}>Gmail API</Text> and click <Text style={{ fontWeight: '700' }}>Enable</Text>.
                          </Text>
                          <TouchableOpacity 
                            style={styles.linkPill}
                            onPress={() => window.open('https://console.cloud.google.com/apis/library/gmail.googleapis.com', '_blank')}
                          >
                            <Text style={styles.linkPillText}>Enable Gmail API</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>3</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>OAuth Consent & Scope</Text>
                          <Text style={styles.stepDesc}>
                            Set up OAuth consent screen with user type <Text style={{ fontWeight: '700' }}>External</Text> and add the scope <Text style={{ fontFamily: 'monospace' }}>https://www.googleapis.com/auth/gmail.send</Text>.
                          </Text>
                        </View>
                      </View>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>4</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>Create Credentials</Text>
                          <Text style={styles.stepDesc}>
                            Under <Text style={{ fontWeight: '700' }}>Credentials</Text>, create an <Text style={{ fontWeight: '700' }}>OAuth client ID (Web Application)</Text>, and copy your Client ID & Client Secret below.
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.formGroup}>
                <Text style={styles.label}>Sender Gmail Address</Text>
                <TextInput
                  style={styles.webInput}
                  placeholder="yourname@gmail.com"
                  value={settings.googleSenderEmail}
                  onChangeText={(val) => setSettings(prev => ({ ...prev, googleSenderEmail: val }))}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor="#9ca3af"
                />
              </View>

              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 12 }]}>
                  <Text style={styles.label}>Google Console Client ID (Optional for App Password)</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="xxxx-xxxx.apps.googleusercontent.com"
                    value={settings.googleClientId}
                    onChangeText={(val) => setSettings(prev => ({ ...prev, googleClientId: val }))}
                    placeholderTextColor="#9ca3af"
                  />
                </View>

                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Google Client Secret OR 16-Char App Password *</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="16-character App Password or Client Secret"
                    value={settings.googleClientSecret}
                    onChangeText={(val) => setSettings(prev => ({ ...prev, googleClientSecret: val }))}
                    secureTextEntry
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>

              <View style={styles.cardActionRow}>
                <TouchableOpacity 
                  style={[styles.sectionSaveBtn, isSavingGoogle && styles.disabledButton]}
                  onPress={() => handleSaveSection('google')}
                  disabled={isSavingGoogle}
                >
                  {isSavingGoogle ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.sectionSaveBtnText}>Save Gmail settings</Text>
                  )}
                </TouchableOpacity>
                {googleFeedback ? <Text style={styles.sectionFeedbackText}>{googleFeedback}</Text> : null}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Record Detail Modal */}
      {selectedRecord && (
        <Modal transparent animationType="fade" visible={!!selectedRecord}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>{selectedRecord.jobTitle}</Text>
                  <Text style={styles.modalSub}>{selectedRecord.companyName} • {selectedRecord.recipientEmail || 'No recipient email'}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedRecord(null)} style={styles.closeBtn}>
                  <Text style={styles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 380, marginVertical: 16 }}>
                {selectedRecord.isLoadingEmail ? (
                  <ActivityIndicator size="small" color="#10b981" style={{ marginVertical: 20 }} />
                ) : (
                  <Text style={styles.emailPreviewText}>{selectedRecord.generatedEmail}</Text>
                )}
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={styles.actionPill} 
                  onPress={() => handleCopy(selectedRecord.generatedEmail)}
                >
                  <Text style={styles.actionPillText}>Copy text</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.actionPill, styles.actionPillPrimary]} 
                  onPress={() => handleSendEmail(selectedRecord)}
                >
                  <Text style={styles.actionPillPrimaryText}>Send via Gmail</Text>
                </TouchableOpacity>

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
  leftPanel: {
    flex: 1.2,
    backgroundColor: '#17201c',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 60,
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
  navTabs: {
    flexDirection: 'row',
    gap: 4,
  },
  navTabsCompact: {
    flex: 1,
    justifyContent: 'center',
  },
  navTabItem: {
    paddingVertical: 10,
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
    padding: 20,
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
  statsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
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
    borderRadius: 12,
    padding: 28,
    width: '100%',
    maxWidth: 680,
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
});
