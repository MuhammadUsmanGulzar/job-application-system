import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  Alert,
  ActivityIndicator,
  Modal,
  SafeAreaView,
  StatusBar,
  Linking
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from './supabase';
import { 
  getSettings, 
  saveSettings, 
  getApplications, 
  saveApplication, 
  deleteApplication, 
  getProfile,
  saveProfile,
  defaultProfile,
  fetchLatestApplicationEmail,
  createApplication,
  updateApplicationGeneratedEmail
} from './services/storage';
import { LLM_PROVIDERS_CONFIG } from './services/ai';
import { sendEmail } from './services/email';

export default function App() {
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

  // Active Tab: 'apply' | 'profile' | 'history' | 'settings'
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

  // History State
  const [applications, setApplications] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);

  const loadUserData = React.useCallback(async (userId, userEmail) => {
    const userSettings = await getSettings(userId);
    setSettings(userSettings);
    const userProfile = await getProfile(userId, userEmail);
    setProfile(userProfile);
    const userApps = await getApplications(userId);
    setApplications(userApps);
  }, []);

  // Supabase Auth listener
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
      setProfileFeedback('Profile details saved successfully!');
      Alert.alert('Saved', 'Profile details and links saved successfully!');
      setTimeout(() => setProfileFeedback(''), 3000);
    } catch (err) {
      setProfileFeedback('Failed to save: ' + err.message);
      Alert.alert('Error', 'Failed to save profile: ' + err.message);
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
      Alert.alert(success ? 'Saved' : 'Error', success ? 'Resume saved successfully!' : 'Failed to save resume.');
    }
    if (section === 'llm') {
      setIsSavingLlm(false);
      Alert.alert(success ? 'Saved' : 'Error', success ? 'AI model preferences saved!' : 'Failed to save preferences.');
    }
    if (section === 'google') {
      setIsSavingGoogle(false);
      Alert.alert(success ? 'Saved' : 'Error', success ? 'Gmail & Google credentials saved!' : 'Failed to save credentials.');
    }
  };

  // Resume Upload (Mobile Document Picker & Supabase Storage)
  const handleUploadResumeMobile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        const updated = {
          ...settings,
          resumeName: file.name,
          resumeContent: settings.resumeContent || `[Uploaded file: ${file.name}]`,
        };
        setSettings(updated);

        if (session?.user?.id) {
          try {
            await saveSettings(session.user.id, updated);
            Alert.alert('Resume Selected', `Attached & saved: ${file.name}`);
          } catch (_e) {
            Alert.alert('Resume Selected', `Attached: ${file.name}`);
          }
        } else {
          Alert.alert('Resume Selected', `Attached: ${file.name}`);
        }
      }
    } catch (e) {
      Alert.alert('File Picker Error', e.message);
    }
  };

  // Submit Application, Immediately Save to 'applications' table, Start Timer/Loader & Trigger n8n
  const handleGenerateAndApply = async () => {
    if (!jobTitle.trim()) {
      Alert.alert('Missing Field', 'Please enter a Job Title.');
      return;
    }

    // 1. Ensure User ID from DB (Supabase Auth session)
    let userId = session?.user?.id;
    if (!userId) {
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      userId = freshSession?.user?.id;
    }

    if (!userId) {
      Alert.alert('Authentication required', 'Please sign in to submit.');
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
        Alert.alert(
          'Generation Timeout',
          'Email generation timed out waiting for output in application_emails table. Your application details are already saved in Applications history.'
        );
      }
    }, 2000);
  };

  // Send Email
  const handleSendEmail = async (appRecord) => {
    if (!appRecord?.recipientEmail) {
      Alert.alert('Missing Recipient', 'Please enter a recipient email.');
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

      const updated = { ...appRecord, status: 'Applied' };
      const updatedList = await saveApplication(session?.user?.id, updated);
      if (updatedList) setApplications(updatedList);
      if (generatedResult?.id === appRecord.id) setGeneratedResult(updated);
      if (selectedRecord?.id === appRecord.id) setSelectedRecord(updated);
    } catch (e) {
      Alert.alert('Send Error', e.message);
    }
  };

  // Delete Record
  const handleDeleteRecord = async (id) => {
    Alert.alert('Confirm Delete', 'Are you sure you want to delete this application record?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Delete', 
        style: 'destructive',
        onPress: async () => {
          const updated = await deleteApplication(session?.user?.id, id);
          if (updated) setApplications(updated);
          if (selectedRecord?.id === id) setSelectedRecord(null);
        }
      }
    ]);
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
      <SafeAreaView style={styles.authContainer}>
        <StatusBar barStyle="light-content" />
        <View style={styles.authHeaderMobile}>
          <Text style={styles.authBadgeMobile}>JOB APPLY SYSTEM</Text>
          <Text style={styles.authTitleMobile}>Career Automation</Text>
          <Text style={styles.authSubMobile}>AI-powered job applications & tracking</Text>
        </View>

        <View style={styles.mobileCard}>
          <Text style={styles.cardHeaderTitle}>
            {isLoginMode ? 'Welcome Back' : 'Create Account'}
          </Text>

          {authError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{authError}</Text>
            </View>
          ) : null}

          {authMessage ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{authMessage}</Text>
            </View>
          ) : null}

          {!isLoginMode && (
            <>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. John Doe"
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
              />
            </>
          )}

          <Text style={styles.label}>Email Address</Text>
          <TextInput
            style={styles.input}
            placeholder="name@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity 
            style={[styles.primaryBtn, authLoading && styles.disabledBtn]}
            disabled={authLoading}
            onPress={async () => {
              setAuthError('');
              setAuthMessage('');

              if (!isLoginMode && !fullName.trim()) {
                setAuthError('Please enter your full name.');
                return;
              }

              if (!email.trim() || !password.trim()) {
                setAuthError('Please enter both email and password.');
                return;
              }

              if (!isLoginMode && password.length < 6) {
                setAuthError('Password must be at least 6 characters.');
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
                    // Sync users & profiles records
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
                      console.warn('Mobile login sync notice:', syncErr);
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
                        console.warn('Users table upsert notice:', uErr);
                      }

                      try {
                        await supabase.from('profiles').upsert({
                          id: targetUser.id,
                          email: email.trim(),
                          full_name: displayName,
                          updated_at: new Date().toISOString()
                        }, { onConflict: 'id' });
                      } catch (pErr) {
                        console.warn('Profiles table upsert notice:', pErr);
                      }

                      try {
                        await supabase.from('user_settings').upsert({
                          user_id: targetUser.id
                        }, { onConflict: 'user_id' });
                      } catch (sErr) {
                        console.warn('User_settings table upsert notice:', sErr);
                      }
                    }

                    if (data?.session) {
                      setAuthMessage('Account created and signed in!');
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
                        setAuthMessage('Account created! Sign in with your credentials.');
                        setIsLoginMode(true);
                      }
                    }
                  }
                }
              } catch (err) {
                setAuthError(err.message);
              } finally {
                setAuthLoading(false);
              }
            }}
          >
            {authLoading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryBtnText}>{isLoginMode ? 'Sign In' : 'Create Account'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={{ marginTop: 20, alignItems: 'center' }}
            onPress={() => {
              setIsLoginMode(!isLoginMode);
              setFullName('');
              setAuthError('');
              setAuthMessage('');
            }}
          >
            <Text style={{ color: '#2563eb', fontWeight: '600', fontSize: 14 }}>
              {isLoginMode ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------- AUTHENTICATED PORTAL ----------------
  return (
    <SafeAreaView style={styles.appContainer}>
      <StatusBar barStyle="dark-content" />
      
      {/* Top Header */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.appName}>JobApply<Text style={{ color: '#2563eb' }}>Pro</Text></Text>
          <Text style={styles.userEmailLabel}>
            {session?.user?.user_metadata?.full_name 
              ? `${session.user.user_metadata.full_name} (${session.user.email})`
              : (session?.user?.email || 'User')}
          </Text>
        </View>
        <TouchableOpacity onPress={() => supabase.auth.signOut()} style={styles.signOutBtn}>
          <Text style={styles.signOutBtnText}>Log Out</Text>
        </TouchableOpacity>
      </View>

      {/* Segmented Tab Navigation */}
      <View style={styles.tabBar}>
        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'apply' && styles.tabItemActive]}
          onPress={() => setActiveTab('apply')}
        >
          <Text style={[styles.tabText, activeTab === 'apply' && styles.tabTextActive]}>Apply</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'profile' && styles.tabItemActive]}
          onPress={() => setActiveTab('profile')}
        >
          <Text style={[styles.tabText, activeTab === 'profile' && styles.tabTextActive]}>Profile</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'history' && styles.tabItemActive]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
            History ({applications.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'settings' && styles.tabItemActive]}
          onPress={() => setActiveTab('settings')}
        >
          <Text style={[styles.tabText, activeTab === 'settings' && styles.tabTextActive]}>Settings</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.contentScroll} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* ================= TAB 1: APPLY ================= */}
        {activeTab === 'apply' && (
          <View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>1. Target Job Details</Text>
              
              <Text style={styles.label}>Job Title *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Senior Mobile Developer"
                value={jobTitle}
                onChangeText={setJobTitle}
              />

              <Text style={styles.label}>Company Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Stripe, OpenAI, etc."
                value={companyName}
                onChangeText={setCompanyName}
              />

              <Text style={styles.label}>Recipient / Recruiter Email</Text>
              <TextInput
                style={styles.input}
                placeholder="recruiting@company.com"
                value={recipientEmail}
                onChangeText={setRecipientEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.label}>Job Requirements & Tech Stack</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="e.g. React Native, TypeScript, 4+ yrs experience..."
                value={requirements}
                onChangeText={setRequirements}
                multiline
              />

              <Text style={styles.label}>Job Description / Custom Notes</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Paste key responsibilities or details..."
                value={description}
                onChangeText={setDescription}
                multiline
              />

              <TouchableOpacity 
                style={[styles.primaryBtn, isGenerating && styles.disabledBtn]}
                onPress={handleGenerateAndApply}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.primaryBtnText}>
                      Generating Email... ({formatTime(generationSeconds)})
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.primaryBtnText}>Generate application</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Active n8n Generating Loader Card */}
            {isGenerating && (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 36, borderWidth: 2, borderColor: '#93c5fd', borderStyle: 'dashed' }]}>
                <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#bfdbfe' }}>
                  <ActivityIndicator size="large" color="#2563eb" />
                </View>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#1e293b', textAlign: 'center', marginBottom: 6 }}>
                  Your email is getting ready in a while...
                </Text>
                <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', paddingHorizontal: 20, marginBottom: 18, lineHeight: 19 }}>
                  Your n8n AI workflow is crafting your tailored pitch.
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', paddingVertical: 8, paddingHorizontal: 20, borderRadius: 24 }}>
                  <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 2 }}>
                    {formatTime(generationSeconds)}
                  </Text>
                </View>
              </View>
            )}

            {/* Generated Result Card */}
            {generatedResult && !isGenerating && (
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={styles.cardTitle}>2. Generated Application</Text>
                  <TouchableOpacity 
                    style={styles.sendActionBtn}
                    onPress={() => handleSendEmail(generatedResult)}
                  >
                    <Text style={styles.sendActionBtnText}>Send email</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.previewBox}>
                  <Text style={styles.previewText}>{generatedResult.generatedEmail}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ================= TAB 2: CANDIDATE PROFILE ================= */}
        {activeTab === 'profile' && (
          <View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Candidate profile</Text>
              <Text style={styles.subText}>
                Your contact details, portfolio, and LinkedIn are automatically added to job emails and synced with n8n.
              </Text>

              <Text style={[styles.label, { marginTop: 12 }]}>Full Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Alex Johnson"
                value={profile.fullName}
                onChangeText={(val) => setProfile(p => ({ ...p, fullName: val }))}
              />

              <Text style={styles.label}>Professional Headline / Role</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Senior Full-Stack Engineer | React & Node"
                value={profile.headline}
                onChangeText={(val) => setProfile(p => ({ ...p, headline: val }))}
              />

              <Text style={styles.label}>Email Address *</Text>
              <TextInput
                style={styles.input}
                placeholder="name@example.com"
                value={profile.email}
                onChangeText={(val) => setProfile(p => ({ ...p, email: val }))}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.label}>Phone Number (with Country Code) *</Text>
              <TextInput
                style={styles.input}
                placeholder="+1 (555) 019-2834"
                value={profile.phone}
                onChangeText={(val) => setProfile(p => ({ ...p, phone: val }))}
                keyboardType="phone-pad"
              />

              <Text style={styles.label}>Portfolio / Personal Website URL *</Text>
              <TextInput
                style={styles.input}
                placeholder="https://yourportfolio.dev"
                value={profile.portfolio}
                onChangeText={(val) => setProfile(p => ({ ...p, portfolio: val }))}
                autoCapitalize="none"
              />

              <Text style={styles.label}>LinkedIn Profile URL *</Text>
              <TextInput
                style={styles.input}
                placeholder="https://linkedin.com/in/username"
                value={profile.linkedin}
                onChangeText={(val) => setProfile(p => ({ ...p, linkedin: val }))}
                autoCapitalize="none"
              />

              <Text style={styles.label}>GitHub Profile URL</Text>
              <TextInput
                style={styles.input}
                placeholder="https://github.com/username"
                value={profile.github}
                onChangeText={(val) => setProfile(p => ({ ...p, github: val }))}
                autoCapitalize="none"
              />

              <Text style={styles.label}>Location / Remote Preference</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. San Francisco, CA / Remote"
                value={profile.location}
                onChangeText={(val) => setProfile(p => ({ ...p, location: val }))}
              />

              <Text style={styles.label}>Short Bio / Executive Summary</Text>
              <TextInput
                style={[styles.input, styles.textArea, { height: 90 }]}
                placeholder="Brief summary of your primary skills and achievements..."
                value={profile.bio}
                onChangeText={(val) => setProfile(p => ({ ...p, bio: val }))}
                multiline
              />

              {/* Email Signature Live Preview */}
              <View style={{ marginTop: 14, marginBottom: 8, padding: 14, backgroundColor: '#f8fafc', borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0' }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#1e293b', textTransform: 'uppercase', marginBottom: 6 }}>
                  Email signature preview
                </Text>
                <View style={{ padding: 12, backgroundColor: '#ffffff', borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1' }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#0f172a' }}>
                    {profile.fullName || 'Candidate Name'}
                  </Text>
                  {profile.headline ? (
                    <Text style={{ fontSize: 13, color: '#2563eb', fontWeight: '600', marginTop: 2 }}>
                      {profile.headline}
                    </Text>
                  ) : null}
                  <View style={{ marginTop: 6, gap: 3 }}>
                    {profile.email ? <Text style={{ fontSize: 12, color: '#475569' }}>📧 {profile.email}</Text> : null}
                    {profile.phone ? <Text style={{ fontSize: 12, color: '#475569' }}>📱 {profile.phone}</Text> : null}
                    {profile.portfolio ? <Text style={{ fontSize: 12, color: '#2563eb' }}>🌐 {profile.portfolio}</Text> : null}
                    {profile.linkedin ? <Text style={{ fontSize: 12, color: '#2563eb' }}>💼 {profile.linkedin}</Text> : null}
                    {profile.github ? <Text style={{ fontSize: 12, color: '#2563eb' }}>💻 {profile.github}</Text> : null}
                    {profile.location ? <Text style={{ fontSize: 12, color: '#64748b' }}>📍 {profile.location}</Text> : null}
                  </View>
                </View>
              </View>

              <TouchableOpacity 
                style={[styles.primaryBtn, isSavingProfile && styles.disabledBtn, { marginTop: 12 }]}
                onPress={handleSaveProfile}
                disabled={isSavingProfile}
              >
                {isSavingProfile ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save profile</Text>
                )}
              </TouchableOpacity>
              {profileFeedback ? (
                <Text style={{ marginTop: 8, color: '#059669', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                  {profileFeedback}
                </Text>
              ) : null}
            </View>
          </View>
        )}

        {/* ================= TAB 3: HISTORY ================= */}
        {activeTab === 'history' && (
          <View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Application History</Text>
              <Text style={styles.subText}>Total Submissions: {applications.length}</Text>
            </View>

            {applications.length === 0 ? (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 40 }]}>
                <Text style={{ fontSize: 40, marginBottom: 12 }}>📂</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 6 }}>No Applications Yet</Text>
                <Text style={{ color: '#64748b', textAlign: 'center', marginBottom: 16 }}>
                  Fill in the job details under the Apply tab to generate your first pitch.
                </Text>
                <TouchableOpacity 
                  style={[styles.primaryBtn, { paddingHorizontal: 24 }]}
                  onPress={() => setActiveTab('apply')}
                >
                  <Text style={styles.primaryBtnText}>Create Application</Text>
                </TouchableOpacity>
              </View>
            ) : (
              applications.map((item) => (
                <View key={item.id} style={styles.card}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={styles.itemTitle}>{item.jobTitle}</Text>
                      <Text style={styles.itemCompany}>{item.companyName} • {item.recipientEmail || 'No email'}</Text>
                      <Text style={styles.itemDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
                    </View>
                    <View style={[styles.statusBadge, item.status === 'Applied' ? styles.statusApplied : styles.statusDraft]}>
                      <Text style={[styles.statusBadgeText, item.status === 'Applied' ? styles.statusAppliedText : styles.statusDraftText]}>
                        {item.status}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                    <TouchableOpacity 
                      style={styles.outlineBtn}
                      onPress={() => handleOpenRecord(item)}
                    >
                      <Text style={styles.outlineBtnText}>View Pitch</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.outlineBtn, { borderColor: '#ef4444' }]}
                      onPress={() => handleDeleteRecord(item.id)}
                    >
                      <Text style={[styles.outlineBtnText, { color: '#ef4444' }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* ================= TAB 3: SETTINGS ================= */}
        {activeTab === 'settings' && (
          <View>
            {/* Resume Card */}
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={styles.cardTitle}>1. Candidate Resume</Text>
                <TouchableOpacity style={styles.smallActionBtn} onPress={handleUploadResumeMobile}>
                  <Text style={styles.smallActionBtnText}>📁 Pick File</Text>
                </TouchableOpacity>
              </View>
              
              <Text style={styles.subText}>
                {settings.resumeName ? `Attached: ${settings.resumeName}` : 'No resume file attached.'}
              </Text>

              <Text style={[styles.label, { marginTop: 12 }]}>Resume Summary / Work Experience</Text>
              <TextInput
                style={[styles.input, styles.textArea, { height: 120 }]}
                placeholder="Paste key achievements, tech stack, and background for the AI..."
                value={settings.resumeContent}
                onChangeText={(text) => setSettings(prev => ({ ...prev, resumeContent: text }))}
                multiline
              />

              <TouchableOpacity 
                style={[styles.primaryBtn, isSavingResume && styles.disabledBtn, { marginTop: 6 }]}
                onPress={() => handleSaveSection('resume')}
                disabled={isSavingResume}
              >
                {isSavingResume ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save resume</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* LLM / Backend AI Preferences */}
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <Text style={styles.cardTitle}>2. AI Engine Preferences</Text>
                <View style={{ backgroundColor: '#f0fdf4', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: '#bbf7d0' }}>
                  <Text style={styles.securityLabel}>Processed securely</Text>
                </View>
              </View>
              <Text style={styles.subText}>
                AI generation runs on your backend workflow (n8n). The frontend handles visuals and inputs while LLM prompts and credentials remain safe on the backend.
              </Text>

              <Text style={styles.label}>AI Provider Preference</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                {Object.keys(LLM_PROVIDERS_CONFIG).map((provKey) => {
                  const isSelected = (settings.llmProvider || 'OpenAI') === provKey;
                  return (
                    <TouchableOpacity
                      key={provKey}
                      style={[
                        styles.mobileGuideTab,
                        isSelected && styles.mobileGuideTabActive,
                        { flex: 1, alignItems: 'center' }
                      ]}
                      onPress={() => {
                        const defModel = LLM_PROVIDERS_CONFIG[provKey]?.defaultModel || '';
                        setSettings(prev => ({
                          ...prev,
                          llmProvider: provKey,
                          llmModel: defModel,
                        }));
                      }}
                    >
                      <Text style={[styles.mobileGuideTabText, isSelected && styles.mobileGuideTabTextActive]}>
                        {provKey}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>Target Model ({settings.llmProvider || 'OpenAI'})</Text>
              <View style={{ gap: 6, marginBottom: 16 }}>
                {(LLM_PROVIDERS_CONFIG[settings.llmProvider || 'OpenAI']?.models || []).map((m) => {
                  const isSelected = settings.llmModel === m.id;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        styles.mobileModelOption,
                        isSelected && styles.mobileModelOptionActive,
                      ]}
                      onPress={() => setSettings(prev => ({ ...prev, llmModel: m.id }))}
                    >
                      <Text style={[styles.mobileModelText, isSelected && styles.mobileModelTextActive]}>
                        {m.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity 
                style={[styles.primaryBtn, isSavingLlm && styles.disabledBtn]}
                onPress={() => handleSaveSection('llm')}
                disabled={isSavingLlm}
              >
                {isSavingLlm ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save AI preferences</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Google Console API */}
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={styles.cardTitle}>3. Gmail Account & Setup</Text>
                <TouchableOpacity 
                  style={styles.guideToggleBtn}
                  onPress={() => setShowGmailGuide(!showGmailGuide)}
                >
                  <Text style={styles.guideToggleBtnText}>
                    {showGmailGuide ? 'Hide guide' : 'Connection guide'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.subText}>Connect your account to send applications directly to recruiters.</Text>

              {/* Mobile Guide */}
              {showGmailGuide && (
                <View style={styles.mobileGuideBox}>
                  <View style={styles.mobileGuideTabs}>
                    <TouchableOpacity 
                      style={[styles.mobileGuideTab, guideMethod === 'appPassword' && styles.mobileGuideTabActive]}
                      onPress={() => setGuideMethod('appPassword')}
                    >
                      <Text style={[styles.mobileGuideTabText, guideMethod === 'appPassword' && styles.mobileGuideTabTextActive]}>
                        App password
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.mobileGuideTab, guideMethod === 'oauth' && styles.mobileGuideTabActive]}
                      onPress={() => setGuideMethod('oauth')}
                    >
                      <Text style={[styles.mobileGuideTabText, guideMethod === 'oauth' && styles.mobileGuideTabTextActive]}>
                        Cloud OAuth
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {guideMethod === 'appPassword' ? (
                    <View style={{ gap: 10 }}>
                      <Text style={styles.guideStepText}>
                        <Text style={{ fontWeight: '700' }}>1. Enable 2-Step Verification:</Text> Turn it on in your Google Account security.
                      </Text>
                      <TouchableOpacity 
                        style={styles.linkButtonMobile}
                        onPress={() => Linking.openURL('https://myaccount.google.com/security')}
                      >
                        <Text style={styles.linkButtonMobileText}>Open Google security</Text>
                      </TouchableOpacity>

                      <Text style={styles.guideStepText}>
                        <Text style={{ fontWeight: '700' }}>2. Generate App Password:</Text> Name it Job Apply Pro and copy the 16-letter code.
                      </Text>
                      <TouchableOpacity 
                        style={styles.linkButtonMobile}
                        onPress={() => Linking.openURL('https://myaccount.google.com/apppasswords')}
                      >
                        <Text style={styles.linkButtonMobileText}>Open app passwords</Text>
                      </TouchableOpacity>

                      <Text style={styles.guideStepText}>
                        <Text style={{ fontWeight: '700' }}>3. Paste Below:</Text> Enter your Gmail and paste the 16-letter code into App Password.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ gap: 10 }}>
                      <Text style={styles.guideStepText}>
                        <Text style={{ fontWeight: '700' }}>1. Google Cloud:</Text> Create a project and enable the <Text style={{ fontWeight: '700' }}>Gmail API</Text>.
                      </Text>
                      <TouchableOpacity 
                        style={styles.linkButtonMobile}
                        onPress={() => Linking.openURL('https://console.cloud.google.com')}
                      >
                        <Text style={styles.linkButtonMobileText}>Open Google Cloud</Text>
                      </TouchableOpacity>
                      <Text style={styles.guideStepText}>
                        <Text style={{ fontWeight: '700' }}>2. OAuth Client ID:</Text> Create Web Application credentials with scope <Text style={{ fontFamily: 'monospace' }}>https://www.googleapis.com/auth/gmail.send</Text> and paste keys below.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              <Text style={styles.label}>Sender Gmail Address</Text>
              <TextInput
                style={styles.input}
                placeholder="your.email@gmail.com"
                value={settings.googleSenderEmail}
                onChangeText={(val) => setSettings(prev => ({ ...prev, googleSenderEmail: val }))}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.label}>Google Console Client ID (Optional for App Password)</Text>
              <TextInput
                style={styles.input}
                placeholder="Client ID from Google Cloud"
                value={settings.googleClientId}
                onChangeText={(val) => setSettings(prev => ({ ...prev, googleClientId: val }))}
              />

              <Text style={styles.label}>Google Client Secret OR 16-Char App Password *</Text>
              <TextInput
                style={styles.input}
                placeholder="Secret or App Password"
                value={settings.googleClientSecret}
                onChangeText={(val) => setSettings(prev => ({ ...prev, googleClientSecret: val }))}
                secureTextEntry
              />

              <TouchableOpacity 
                style={[styles.primaryBtn, isSavingGoogle && styles.disabledBtn, { marginTop: 6 }]}
                onPress={() => handleSaveSection('google')}
                disabled={isSavingGoogle}
              >
                {isSavingGoogle ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save Gmail settings</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Record Modal */}
      {selectedRecord && (
        <Modal transparent animationType="slide" visible={!!selectedRecord}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={styles.modalHeading}>{selectedRecord.jobTitle}</Text>
                <TouchableOpacity onPress={() => setSelectedRecord(null)}>
                  <Text style={styles.modalCloseText}>Close</Text>
                </TouchableOpacity>
              </View>

              <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                {selectedRecord.companyName} • {selectedRecord.recipientEmail || 'No recipient'}
              </Text>

              <ScrollView style={{ maxHeight: 300, backgroundColor: '#f8fafc', padding: 12, borderRadius: 8 }}>
                {selectedRecord.isLoadingEmail ? (
                  <ActivityIndicator size="small" color="#10b981" style={{ marginVertical: 20 }} />
                ) : (
                  <Text style={styles.previewText}>{selectedRecord.generatedEmail}</Text>
                )}
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity 
                  style={[styles.primaryBtn, { flex: 1 }]}
                  onPress={() => handleSendEmail(selectedRecord)}
                >
                  <Text style={styles.primaryBtnText}>Send email</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.outlineBtn, { flex: 1 }]}
                  onPress={() => setSelectedRecord(null)}
                >
                  <Text style={styles.outlineBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  authContainer: {
    flex: 1,
    backgroundColor: '#17201c',
    justifyContent: 'center',
    padding: 20,
  },
  authHeaderMobile: {
    alignItems: 'center',
    marginBottom: 28,
  },
  authBadgeMobile: {
    color: '#b9c4bd',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  authTitleMobile: {
    fontSize: 28,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  authSubMobile: {
    color: '#c7d0cb',
    fontSize: 14,
  },
  mobileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  cardHeaderTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#17201c',
    marginBottom: 16,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '500',
  },
  successBox: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#6ee7b7',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  successText: {
    color: '#059669',
    fontSize: 13,
    fontWeight: '500',
  },
  appContainer: {
    flex: 1,
    backgroundColor: '#f5f6f3',
  },
  topBar: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e3e6e1',
  },
  appName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#17201c',
  },
  userEmailLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  signOutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#f0f2ef',
    borderRadius: 6,
  },
  signOutBtnText: {
    color: '#56605a',
    fontSize: 12,
    fontWeight: '600',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e3e6e1',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabItemActive: {
    backgroundColor: '#eef1ed',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#747d78',
  },
  tabTextActive: {
    color: '#253c32',
  },
  contentScroll: {
    flex: 1,
  },
  card: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 14,
    padding: 18,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e3e6e1',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#17201c',
    marginBottom: 4,
  },
  subText: {
    fontSize: 13,
    color: '#747d78',
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3f4944',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d8dcd7',
    borderRadius: 7,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#fafbf9',
    marginBottom: 12,
    color: '#17201c',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    backgroundColor: '#253c32',
    paddingVertical: 12,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  disabledBtn: {
    backgroundColor: '#9ca8a1',
  },
  previewBox: {
    backgroundColor: '#f8fafc',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  previewText: {
    fontSize: 13,
    color: '#1e293b',
    lineHeight: 20,
    fontFamily: 'monospace',
  },
  sendActionBtn: {
    backgroundColor: '#253c32',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  sendActionBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  itemCompany: {
    fontSize: 13,
    color: '#475569',
    marginTop: 2,
  },
  itemDate: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  statusBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  statusApplied: {
    backgroundColor: '#edf3ef',
  },
  statusAppliedText: {
    color: '#3f6954',
    fontSize: 11,
    fontWeight: '600',
  },
  statusDraft: {
    backgroundColor: '#f0f1ee',
  },
  statusDraftText: {
    color: '#5d6761',
    fontSize: 11,
    fontWeight: '600',
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  outlineBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  smallActionBtn: {
    backgroundColor: '#eef1ed',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  smallActionBtnText: {
    color: '#354b40',
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
  },
  modalHeading: {
    fontSize: 18,
    fontWeight: '600',
    color: '#17201c',
  },
  // Mobile guide styles
  guideToggleBtn: {
    backgroundColor: '#f3f5f2',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d8dcd7',
  },
  guideToggleBtnText: {
    color: '#354b40',
    fontSize: 12,
    fontWeight: '600',
  },
  mobileGuideBox: {
    backgroundColor: '#fafbf9',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e3e6e1',
    padding: 12,
    marginBottom: 14,
  },
  mobileGuideTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 8,
  },
  mobileGuideTab: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  mobileGuideTabActive: {
    backgroundColor: '#253c32',
    borderColor: '#253c32',
  },
  mobileGuideTabText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  mobileGuideTabTextActive: {
    color: '#ffffff',
  },
  guideStepText: {
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
  linkButtonMobile: {
    backgroundColor: '#eef1ed',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  linkButtonMobileText: {
    color: '#354b40',
    fontSize: 11,
    fontWeight: '600',
  },
  mobileModelOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  mobileModelOptionActive: {
    borderColor: '#8e9c94',
    backgroundColor: '#eef1ed',
  },
  mobileModelText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  mobileModelTextActive: {
    color: '#253c32',
    fontWeight: '600',
  },
  securityLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#52705f',
  },
  modalCloseText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#606963',
  },
});
