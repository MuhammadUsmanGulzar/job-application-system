import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  ActivityIndicator,
  Modal
} from 'react-native';
import { supabase } from './supabase';
import { getSettings, saveSettings, getApplications, saveApplication, deleteApplication, uploadResumeFile } from './services/storage';
import { generateJobApplication } from './services/ai';
import { sendEmail } from './services/email';

export default function AppWeb() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');

  // Active navigation tab: 'apply' | 'history' | 'settings'
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
  const [generatedResult, setGeneratedResult] = useState(null);

  // Applications History State
  const [applications, setApplications] = useState([]);
  const [historySearch, setHistorySearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);

  // Auth session listener
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
      setLlmFeedback(success ? '✓ LLM API Key saved!' : 'Failed to save');
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

  // Generate Application with AI
  const handleGenerateAndApply = async () => {
    if (!jobTitle.trim()) {
      window.alert('Please enter a Job Title.');
      return;
    }

    if (!settings.llmApiKey.trim()) {
      window.alert('Please configure your OpenAI / LLM API Key in the Settings tab first.');
      setActiveTab('settings');
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
        companyName: companyName.trim() || 'Undisclosed Company',
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
      window.alert('Error generating application: ' + err.message);
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
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

  // ---------------- AUTH SCREEN ----------------
  if (!isAuthenticated) {
    return (
      <View style={styles.webContainer}>
        {/* Left Side: Hero Section */}
        <View style={styles.leftPanel}>
          <View style={styles.heroContent}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Next-Gen AI Job Pipeline</Text>
            </View>
            <Text style={styles.heroTitle}>Automate Your Job Applications</Text>
            <Text style={styles.heroSubtitle}>
              Upload your resume, connect your LLM & Google API, and automatically generate tailored, high-converting cover letters & emails in seconds.
            </Text>
            
            <View style={styles.featureList}>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>⚡</Text>
                <Text style={styles.featureText}>Instant bespoke pitch letters mapped to job requirements</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>📄</Text>
                <Text style={styles.featureText}>One-click resume upload & intelligent parsing</Text>
              </View>
              <View style={styles.featureItem}>
                <Text style={styles.featureIcon}>📊</Text>
                <Text style={styles.featureText}>Full application history and automated status tracking</Text>
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

                if (!email.trim() || !password.trim()) {
                  setAuthError('Please enter both email and password');
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
                        setAuthMessage('Account created! Sign in now to access your account.');
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
                <Text style={styles.webPrimaryButtonText}>{isLoginMode ? 'Sign In' : 'Sign Up'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ marginTop: 24, alignItems: 'center' }}
              onPress={() => {
                setIsLoginMode(!isLoginMode);
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
      <View style={styles.webNavbar}>
        <View style={styles.brandContainer}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>⚡</Text>
          </View>
          <Text style={styles.navbarBrand}>JobApply<Text style={{ color: '#2563eb' }}>Pro</Text></Text>
        </View>

        {/* Navigation Tabs */}
        <View style={styles.navTabs}>
          <TouchableOpacity 
            style={[styles.navTabItem, activeTab === 'apply' && styles.navTabItemActive]} 
            onPress={() => setActiveTab('apply')}
          >
            <Text style={[styles.navTabText, activeTab === 'apply' && styles.navTabTextActive]}>
              📝 Apply for Job
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navTabItem, activeTab === 'history' && styles.navTabItemActive]} 
            onPress={() => setActiveTab('history')}
          >
            <Text style={[styles.navTabText, activeTab === 'history' && styles.navTabTextActive]}>
              📜 Application History ({applications.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navTabItem, activeTab === 'settings' && styles.navTabItemActive]} 
            onPress={() => setActiveTab('settings')}
          >
            <Text style={[styles.navTabText, activeTab === 'settings' && styles.navTabTextActive]}>
              ⚙️ APIs & Resume
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.navbarRight}>
          <Text style={styles.userEmail}>{session?.user?.email || 'User'}</Text>
          <TouchableOpacity onPress={() => supabase.auth.signOut()} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content Area */}
      <ScrollView contentContainerStyle={styles.webContent}>
        {/* ================= TAB 1: APPLY FOR JOB ================= */}
        {activeTab === 'apply' && (
          <View style={styles.pageContainer}>
            {/* Quick API status alert if not configured */}
            {!settings.llmApiKey ? (
              <View style={styles.warningCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>⚠️ LLM API Key Needed</Text>
                  <Text style={styles.warningDesc}>
                    Please configure your OpenAI or Gemini API key in the APIs & Resume settings tab to generate applications.
                  </Text>
                </View>
                <TouchableOpacity 
                  style={styles.quickActionBtn}
                  onPress={() => setActiveTab('settings')}
                >
                  <Text style={styles.quickActionBtnText}>Go to Settings</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.splitLayout}>
              {/* Form Card */}
              <View style={styles.flexCard}>
                <Text style={styles.cardTitle}>Job Application Form</Text>
                <Text style={styles.cardDescription}>
                  Enter the details of the job opportunity. Our AI will craft an email matching your uploaded resume.
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
                      <Text style={styles.webPrimaryButtonText}>Generating with AI...</Text>
                    </View>
                  ) : (
                    <Text style={styles.webPrimaryButtonText}>⚡ Generate Tailored Application</Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* Output Preview Card */}
              <View style={styles.flexCard}>
                <Text style={styles.cardTitle}>Generated Application Email</Text>
                <Text style={styles.cardDescription}>
                  Review, edit, copy, or send your personalized email directly to the recruiter.
                </Text>

                {generatedResult ? (
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
                          <Text style={styles.actionPillText}>📋 Copy</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={[styles.actionPill, styles.actionPillPrimary]}
                          onPress={() => handleSendEmail(generatedResult)}
                        >
                          <Text style={styles.actionPillPrimaryText}>✉️ Send</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <ScrollView style={styles.emailPreviewScroll}>
                      <Text style={styles.emailPreviewText}>{generatedResult.generatedEmail}</Text>
                    </ScrollView>
                  </View>
                ) : (
                  <View style={styles.emptyPreviewBox}>
                    <Text style={{ fontSize: 40, marginBottom: 12 }}>✉️</Text>
                    <Text style={styles.emptyPreviewTitle}>No application generated yet</Text>
                    <Text style={styles.emptyPreviewSub}>
                      Fill in the job requirements on the left and click "Generate Tailored Application". Your customized cover email will appear here.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ================= TAB 2: APPLICATION HISTORY ================= */}
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
                          onPress={() => setSelectedRecord(item)}
                        >
                          <Text style={styles.tableActionBtnText}>👁️ View Pitch</Text>
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
                    <Text style={styles.sectionSaveBtnText}>💾 Save Resume</Text>
                  )}
                </TouchableOpacity>
                {resumeFeedback ? <Text style={styles.sectionFeedbackText}>{resumeFeedback}</Text> : null}
              </View>
            </View>

            {/* Section 2: LLM API Configuration */}
            <View style={styles.webCard}>
              <Text style={styles.sectionTitle}>2. LLM API (OpenAI / AI Engine)</Text>
              <Text style={styles.cardDescription}>
                Replaces the old n8n webhook. Directly communicates with OpenAI or Gemini to generate job letters.
              </Text>

              <View style={styles.formRow}>
                <View style={[styles.formGroup, { flex: 1, marginRight: 12 }]}>
                  <Text style={styles.label}>Provider</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {['OpenAI', 'Gemini'].map((prov) => (
                      <TouchableOpacity
                        key={prov}
                        style={[
                          styles.providerPill,
                          settings.llmProvider === prov && styles.providerPillActive,
                        ]}
                        onPress={() => setSettings(prev => ({ ...prev, llmProvider: prov }))}
                      >
                        <Text style={[
                          styles.providerPillText,
                          settings.llmProvider === prov && styles.providerPillTextActive,
                        ]}>
                          {prov}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={[styles.formGroup, { flex: 1 }]}>
                  <Text style={styles.label}>Model</Text>
                  <TextInput
                    style={styles.webInput}
                    placeholder="gpt-4o-mini or gpt-4o"
                    value={settings.llmModel}
                    onChangeText={(val) => setSettings(prev => ({ ...prev, llmModel: val }))}
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.label}>{settings.llmProvider} API Key *</Text>
                <TextInput
                  style={styles.webInput}
                  placeholder={`Enter your ${settings.llmProvider} API Key (e.g. sk-...)`}
                  value={settings.llmApiKey}
                  onChangeText={(val) => setSettings(prev => ({ ...prev, llmApiKey: val }))}
                  secureTextEntry
                  placeholderTextColor="#9ca3af"
                />
                <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  Stored securely in your local browser session.
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
                    <Text style={styles.sectionSaveBtnText}>💾 Save LLM API Configuration</Text>
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
                    {showGmailGuide ? '▲ Hide Guide' : '📖 How to Connect (Guide)'}
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
                        ⚡ Method A: Gmail App Password (2 Mins - Recommended)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.guideTabItem, guideMethod === 'oauth' && styles.guideTabItemActive]}
                      onPress={() => setGuideMethod('oauth')}
                    >
                      <Text style={[styles.guideTabItemText, guideMethod === 'oauth' && styles.guideTabItemTextActive]}>
                        🏢 Method B: Google Cloud Console OAuth 2.0
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
                            <Text style={styles.linkPillText}>🔗 Open Google Security Settings ↗</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>2</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>Generate App Password</Text>
                          <Text style={styles.stepDesc}>
                            Visit the Google App Passwords page. Name it <Text style={{ fontWeight: '700' }}>"Job Apply Pro"</Text> and click <Text style={{ fontWeight: '700' }}>Create</Text>.
                          </Text>
                          <TouchableOpacity 
                            style={styles.linkPill}
                            onPress={() => window.open('https://myaccount.google.com/apppasswords', '_blank')}
                          >
                            <Text style={styles.linkPillText}>🔗 Go to Google App Passwords ↗</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>3</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>Paste Below & Save</Text>
                          <Text style={styles.stepDesc}>
                            Copy the 16-character code (e.g. <Text style={{ fontFamily: 'monospace' }}>abcd efgh ijkl mnop</Text>) into the <Text style={{ fontWeight: '700' }}>"Client Secret / App Password"</Text> field below, and enter your Gmail address!
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
                            Go to Google Cloud Console and create a project named <Text style={{ fontWeight: '700' }}>"Job Apply System"</Text>.
                          </Text>
                          <TouchableOpacity 
                            style={styles.linkPill}
                            onPress={() => window.open('https://console.cloud.google.com/projectcreate', '_blank')}
                          >
                            <Text style={styles.linkPillText}>🔗 Open Google Cloud Console ↗</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      <View style={styles.guideStepRow}>
                        <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>2</Text></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepTitle}>Enable Gmail API</Text>
                          <Text style={styles.stepDesc}>
                            Under <Text style={{ fontWeight: '700' }}>APIs & Services > Library</Text>, search for <Text style={{ fontWeight: '700' }}>"Gmail API"</Text> and click <Text style={{ fontWeight: '700' }}>Enable</Text>.
                          </Text>
                          <TouchableOpacity 
                            style={styles.linkPill}
                            onPress={() => window.open('https://console.cloud.google.com/apis/library/gmail.googleapis.com', '_blank')}
                          >
                            <Text style={styles.linkPillText}>🔗 Enable Gmail API ↗</Text>
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
                    <Text style={styles.sectionSaveBtnText}>💾 Save Gmail & Google API</Text>
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
                  <Text style={{ fontSize: 18, color: '#6b7280' }}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 380, marginVertical: 16 }}>
                <Text style={styles.emailPreviewText}>{selectedRecord.generatedEmail}</Text>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity 
                  style={styles.actionPill} 
                  onPress={() => handleCopy(selectedRecord.generatedEmail)}
                >
                  <Text style={styles.actionPillText}>📋 Copy Text</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.actionPill, styles.actionPillPrimary]} 
                  onPress={() => handleSendEmail(selectedRecord)}
                >
                  <Text style={styles.actionPillPrimaryText}>✉️ Send via Gmail</Text>
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
    backgroundColor: '#ffffff',
  },
  leftPanel: {
    flex: 1.2,
    backgroundColor: '#1e3a8a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 60,
  },
  heroContent: {
    maxWidth: 520,
  },
  badge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  badgeText: {
    color: '#93c5fd',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 42,
    fontWeight: '800',
    color: '#ffffff',
    lineHeight: 52,
    marginBottom: 20,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#bfdbfe',
    lineHeight: 26,
    marginBottom: 36,
  },
  featureList: {
    gap: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  featureText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
  },
  rightPanel: {
    flex: 1,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  authCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#ffffff',
    padding: 44,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  authHeader: {
    marginBottom: 24,
  },
  authTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  authSubtitle: {
    fontSize: 14,
    color: '#64748b',
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
    backgroundColor: '#f8fafc',
    height: '100vh',
  },
  webNavbar: {
    backgroundColor: '#ffffff',
    height: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoBadge: {
    width: 32,
    height: 32,
    backgroundColor: '#dbeafe',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  logoBadgeText: {
    fontSize: 16,
  },
  navbarBrand: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  navTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  navTabItem: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  navTabItemActive: {
    backgroundColor: '#eff6ff',
  },
  navTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  navTabTextActive: {
    color: '#2563eb',
  },
  navbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userEmail: {
    marginRight: 16,
    color: '#64748b',
    fontSize: 14,
    fontWeight: '500',
  },
  logoutButton: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: '#fee2e2',
    borderRadius: 6,
  },
  logoutText: {
    color: '#ef4444',
    fontWeight: '600',
    fontSize: 13,
  },
  webContent: {
    padding: 36,
    alignItems: 'center',
  },
  pageContainer: {
    width: '100%',
    maxWidth: 1100,
  },

  // Split Layout for Apply
  splitLayout: {
    flexDirection: 'row',
    gap: 28,
  },
  flexCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 28,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  webCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 28,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
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
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 14,
    color: '#64748b',
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
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  webInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  textArea: {
    paddingTop: 12,
  },
  webPrimaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webPrimaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#93c5fd',
  },

  // Generated output
  generatedBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    color: '#2563eb',
    fontWeight: '600',
  },
  actionPill: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  actionPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  actionPillPrimary: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  actionPillPrimaryText: {
    fontSize: 13,
    fontWeight: '600',
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
  emptyPreviewBox: {
    height: 380,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cbd5e1',
    padding: 30,
    textAlign: 'center',
  },
  emptyPreviewTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  emptyPreviewSub: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 340,
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
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statNumber: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  tableCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    fontWeight: '700',
    color: '#0f172a',
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
    backgroundColor: '#ecfdf5',
  },
  badgeAppliedText: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '600',
  },
  badgeDraft: {
    backgroundColor: '#eff6ff',
  },
  badgeDraftText: {
    color: '#2563eb',
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
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  uploadBtnText: {
    color: '#2563eb',
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
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  providerPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  providerPillTextActive: {
    color: '#2563eb',
  },

  // Guide styles
  guideToggleBtn: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  guideToggleBtnText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '600',
  },
  guideBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
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
    backgroundColor: '#2563eb',
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
    backgroundColor: '#eff6ff',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  linkPillText: {
    color: '#2563eb',
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
    backgroundColor: '#2563eb',
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
    color: '#059669',
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
    borderRadius: 16,
    padding: 28,
    width: '100%',
    maxWidth: 680,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
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
    fontWeight: '700',
    color: '#0f172a',
  },
  modalSub: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  closeBtn: {
    padding: 4,
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
