import React, { useState, useEffect } from 'react';
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
import { getSettings, saveSettings, getApplications, saveApplication, deleteApplication, uploadResumeFile } from './services/storage';
import { generateJobApplication } from './services/ai';
import { sendEmail } from './services/email';

export default function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');

  // Active Tab: 'apply' | 'history' | 'settings'
  const [activeTab, setActiveTab] = useState('apply');

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
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showGmailGuide, setShowGmailGuide] = useState(true);
  const [guideMethod, setGuideMethod] = useState('appPassword');

  // Job Application Form State
  const [jobTitle, setJobTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [requirements, setRequirements] = useState('');
  const [description, setDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState(null);

  // History State
  const [applications, setApplications] = useState([]);
  const [selectedRecord, setSelectedRecord] = useState(null);

  // Supabase Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthenticated(!!session);
      if (session?.user?.id) {
        loadUserData(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsAuthenticated(!!session);
      if (session?.user?.id) {
        loadUserData(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserData = async (userId) => {
    const userSettings = await getSettings(userId);
    setSettings(userSettings);
    const userApps = await getApplications(userId);
    setApplications(userApps);
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    const success = await saveSettings(session?.user?.id, settings);
    setIsSavingSettings(false);
    if (success) {
      Alert.alert('Saved', 'Your settings and API keys have been saved!');
    } else {
      Alert.alert('Error', 'Failed to save settings.');
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
          } catch (e) {
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

  // Generate Application with AI
  const handleGenerateAndApply = async () => {
    if (!jobTitle.trim()) {
      Alert.alert('Missing Field', 'Please enter a Job Title.');
      return;
    }

    if (!settings.llmApiKey.trim()) {
      Alert.alert('API Key Required', 'Please configure your OpenAI / LLM API Key in the Settings tab first.', [
        { text: 'Go to Settings', onPress: () => setActiveTab('settings') },
        { text: 'Cancel', style: 'cancel' }
      ]);
      return;
    }

    setIsGenerating(true);
    setGeneratedResult(null);

    try {
      const content = await generateJobApplication({
        jobTitle,
        companyName,
        recipientEmail,
        requirements,
        description,
        resumeContent: settings.resumeContent,
        resumeName: settings.resumeName,
        apiKey: settings.llmApiKey,
        model: settings.llmModel,
        provider: settings.llmProvider,
      });

      const newApp = {
        id: Date.now().toString(),
        jobTitle: jobTitle.trim(),
        companyName: companyName.trim() || 'Hiring Company',
        recipientEmail: recipientEmail.trim(),
        requirements: requirements.trim(),
        description: description.trim(),
        generatedEmail: content,
        status: recipientEmail ? 'Generated' : 'Draft',
        createdAt: new Date().toISOString(),
      };

      const updatedList = await saveApplication(session?.user?.id, newApp);
      if (updatedList) setApplications(updatedList);
      setGeneratedResult(newApp);
    } catch (err) {
      Alert.alert('AI Error', err.message);
    } finally {
      setIsGenerating(false);
    }
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

              if (!email.trim() || !password.trim()) {
                setAuthError('Please enter both email and password.');
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
                    setSession(data.session);
                    setIsAuthenticated(true);
                  }
                } else {
                  const { data, error } = await supabase.auth.signUp({
                    email: email.trim(),
                    password: password.trim(),
                  });
                  if (error) {
                    setAuthError(error.message);
                  } else if (data?.session) {
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
                      setAuthMessage('Account created! Sign in to continue.');
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
              <Text style={styles.primaryBtnText}>{isLoginMode ? 'Sign In' : 'Sign Up'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={{ marginTop: 20, alignItems: 'center' }}
            onPress={() => {
              setIsLoginMode(!isLoginMode);
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
          <Text style={styles.userEmailLabel}>{session?.user?.email || 'User'}</Text>
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
          <Text style={[styles.tabText, activeTab === 'apply' && styles.tabTextActive]}>📝 Apply</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'history' && styles.tabItemActive]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
            📜 History ({applications.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tabItem, activeTab === 'settings' && styles.tabItemActive]}
          onPress={() => setActiveTab('settings')}
        >
          <Text style={[styles.tabText, activeTab === 'settings' && styles.tabTextActive]}>⚙️ Settings</Text>
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
                    <Text style={styles.primaryBtnText}>Generating Pitch with AI...</Text>
                  </View>
                ) : (
                  <Text style={styles.primaryBtnText}>⚡ Generate Tailored Pitch</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Generated Result Card */}
            {generatedResult && (
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={styles.cardTitle}>2. Generated Application</Text>
                  <TouchableOpacity 
                    style={styles.sendActionBtn}
                    onPress={() => handleSendEmail(generatedResult)}
                  >
                    <Text style={styles.sendActionBtnText}>✉️ Send Email</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.previewBox}>
                  <Text style={styles.previewText}>{generatedResult.generatedEmail}</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ================= TAB 2: HISTORY ================= */}
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
                      onPress={() => setSelectedRecord(item)}
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
            </View>

            {/* LLM API Card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>2. LLM Engine (OpenAI / Gemini)</Text>
              <Text style={styles.subText}>Replaces old n8n webhook with direct AI generation.</Text>

              <Text style={styles.label}>Provider (OpenAI or Gemini)</Text>
              <TextInput
                style={styles.input}
                value={settings.llmProvider}
                onChangeText={(val) => setSettings(prev => ({ ...prev, llmProvider: val }))}
              />

              <Text style={styles.label}>Model Name</Text>
              <TextInput
                style={styles.input}
                placeholder="gpt-4o-mini"
                value={settings.llmModel}
                onChangeText={(val) => setSettings(prev => ({ ...prev, llmModel: val }))}
              />

              <Text style={styles.label}>API Key *</Text>
              <TextInput
                style={styles.input}
                placeholder="sk-..."
                value={settings.llmApiKey}
                onChangeText={(val) => setSettings(prev => ({ ...prev, llmApiKey: val }))}
                secureTextEntry
              />
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
                    {showGmailGuide ? '▲ Hide Guide' : '📖 Guide'}
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
                        ⚡ App Password (2 min)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.mobileGuideTab, guideMethod === 'oauth' && styles.mobileGuideTabActive]}
                      onPress={() => setGuideMethod('oauth')}
                    >
                      <Text style={[styles.mobileGuideTabText, guideMethod === 'oauth' && styles.mobileGuideTabTextActive]}>
                        🏢 Cloud OAuth 2.0
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
                        <Text style={styles.linkButtonMobileText}>🔗 Open Google Security ↗</Text>
                      </TouchableOpacity>

                      <Text style={styles.guideStepText}>
                        <Text style={{ fontWeight: '700' }}>2. Generate App Password:</Text> Name it "Job Apply Pro" and copy the 16-letter code.
                      </Text>
                      <TouchableOpacity 
                        style={styles.linkButtonMobile}
                        onPress={() => Linking.openURL('https://myaccount.google.com/apppasswords')}
                      >
                        <Text style={styles.linkButtonMobileText}>🔗 Go to App Passwords ↗</Text>
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
                        <Text style={styles.linkButtonMobileText}>🔗 Open Google Cloud Console ↗</Text>
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
            </View>

            <TouchableOpacity 
              style={[styles.primaryBtn, isSavingSettings && styles.disabledBtn, { marginHorizontal: 16 }]}
              onPress={handleSaveSettings}
              disabled={isSavingSettings}
            >
              {isSavingSettings ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>💾 Save All Settings</Text>
              )}
            </TouchableOpacity>
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
                  <Text style={{ fontSize: 20, color: '#64748b' }}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                {selectedRecord.companyName} • {selectedRecord.recipientEmail || 'No recipient'}
              </Text>

              <ScrollView style={{ maxHeight: 300, backgroundColor: '#f8fafc', padding: 12, borderRadius: 8 }}>
                <Text style={styles.previewText}>{selectedRecord.generatedEmail}</Text>
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                <TouchableOpacity 
                  style={[styles.primaryBtn, { flex: 1 }]}
                  onPress={() => handleSendEmail(selectedRecord)}
                >
                  <Text style={styles.primaryBtnText}>✉️ Send Email</Text>
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
    backgroundColor: '#1e3a8a',
    justifyContent: 'center',
    padding: 20,
  },
  authHeaderMobile: {
    alignItems: 'center',
    marginBottom: 28,
  },
  authBadgeMobile: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  authTitleMobile: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 4,
  },
  authSubMobile: {
    color: '#bfdbfe',
    fontSize: 14,
  },
  mobileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  cardHeaderTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
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
    backgroundColor: '#f8fafc',
  },
  topBar: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  appName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  userEmailLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  signOutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#fee2e2',
    borderRadius: 6,
  },
  signOutBtnText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
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
    backgroundColor: '#eff6ff',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  tabTextActive: {
    color: '#2563eb',
  },
  contentScroll: {
    flex: 1,
  },
  card: {
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 14,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  subText: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    backgroundColor: '#f8fafc',
    marginBottom: 12,
    color: '#0f172a',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  disabledBtn: {
    backgroundColor: '#93c5fd',
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
    backgroundColor: '#2563eb',
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
    backgroundColor: '#ecfdf5',
  },
  statusAppliedText: {
    color: '#059669',
    fontSize: 11,
    fontWeight: '600',
  },
  statusDraft: {
    backgroundColor: '#eff6ff',
  },
  statusDraftText: {
    color: '#2563eb',
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
    backgroundColor: '#eff6ff',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  smallActionBtnText: {
    color: '#2563eb',
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
    borderRadius: 14,
    padding: 20,
  },
  modalHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  // Mobile guide styles
  guideToggleBtn: {
    backgroundColor: '#eff6ff',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  guideToggleBtnText: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '600',
  },
  mobileGuideBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
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
    backgroundColor: '#eff6ff',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  linkButtonMobileText: {
    color: '#2563eb',
    fontSize: 11,
    fontWeight: '600',
  },
});
