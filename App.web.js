import React, { useState } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  Alert,
  ActivityIndicator
} from 'react-native';
import { supabase } from './supabase';

export default function AppWeb() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState(null);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthenticated(!!session);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsAuthenticated(!!session);
    });
  }, []);

  // User settings state
  const [webhookUrl, setWebhookUrl] = useState('');
  
  // Job application state
  const [jobTitle, setJobTitle] = useState('');
  const [requirements, setRequirements] = useState('');
  const [description, setDescription] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);

  const currentUser = {
    id: session?.user?.id || 'user-uuid-1234',
    email: session?.user?.email || email || 'user@example.com'
  };

  const handleSaveWebhook = () => {
    if (!webhookUrl.startsWith('http')) {
      Alert.alert('Invalid URL', 'Please enter a valid http/https URL.');
      return;
    }
    Alert.alert('Success', 'Your API Webhook has been saved!');
  };

  const handleSubmitApplication = async () => {
    if (!webhookUrl) {
      Alert.alert('Missing API', 'Please enter your n8n Webhook URL in the settings first.');
      return;
    }

    if (!jobTitle || !requirements) {
      Alert.alert('Missing Fields', 'Please fill in the Job Title and Requirements.');
      return;
    }

    setIsLoading(true);

    const payload = {
      user_id: currentUser.id,
      email: currentUser.email,
      job_details: {
        title: jobTitle,
        requirements: requirements,
        description: description,
      },
      submitted_at: new Date().toISOString(),
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        Alert.alert('Success!', 'Job application data sent to your n8n workflow.');
        setJobTitle('');
        setRequirements('');
        setDescription('');
      } else {
        Alert.alert('Error', 'Failed to send data. Check your n8n webhook configuration.');
      }
    } catch (error) {
      Alert.alert('Network Error', 'Could not reach the webhook URL.');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <View style={styles.webContainer}>
        {/* Left Side: Hero Section */}
        <View style={styles.leftPanel}>
          <View style={styles.heroContent}>
            <Text style={styles.overline}>JOB PORTAL SYSTEM</Text>
            <Text style={styles.heroTitle}>Manage job{"\n"}applications into{"\n"}a working{"\n"}pipeline.</Text>
            <Text style={styles.heroSubtitle}>
              Sign in to run your application tracking and keep your team's results in one private workspace.
            </Text>
          </View>
        </View>
        
        {/* Right Side: Auth Form */}
        <View style={styles.rightPanel}>
          <View style={styles.authCard}>
            
            <View style={styles.tabsContainer}>
              <TouchableOpacity onPress={() => setIsLoginMode(true)} style={[styles.tab, isLoginMode && styles.activeTab]}>
                <Text style={[styles.tabText, isLoginMode && styles.activeTabText]}>Sign in</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setIsLoginMode(false)} style={[styles.tab, !isLoginMode && styles.activeTab]}>
                <Text style={[styles.tabText, !isLoginMode && styles.activeTabText]}>Create account</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.authHeader}>
              <Text style={styles.authTitle}>
                {isLoginMode ? 'Welcome back' : 'Create account'}
              </Text>
              <Text style={styles.authSubtitle}>
                {isLoginMode ? 'Use the email connected to your account.' : 'Sign up to create your workspace.'}
              </Text>
            </View>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.webInput}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.webInput}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>

            <TouchableOpacity 
              style={styles.webPrimaryButton}
              onPress={async () => {
                if (!email || !password) {
                  Alert.alert('Error', 'Please enter both email and password');
                  return;
                }
                
                if (isLoginMode) {
                  const { error } = await supabase.auth.signInWithPassword({ email, password });
                  if (error) Alert.alert('Login Error', error.message);
                } else {
                  const { error } = await supabase.auth.signUp({ email, password });
                  if (error) Alert.alert('Signup Error', error.message);
                  else Alert.alert('Success', 'Check your email for the confirmation link or try signing in if auto-confirm is enabled!');
                }
              }}
            >
              <Text style={styles.webPrimaryButtonText}>{isLoginMode ? 'Sign in' : 'Create account'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // Authenticated Portal
  return (
    <View style={styles.webAppContainer}>
      {/* Top Navbar */}
      <View style={styles.webNavbar}>
        <Text style={styles.navbarBrand}>Job System Portal</Text>
        <View style={styles.navbarRight}>
          <Text style={styles.userEmail}>{currentUser.email}</Text>
          <TouchableOpacity onPress={() => supabase.auth.signOut()} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.webContent}>
        <View style={styles.gridContainer}>
          {/* Settings Card */}
          <View style={styles.webCard}>
            <Text style={styles.cardTitle}>Integration Settings</Text>
            <Text style={styles.cardDescription}>Configure where your job applications will be sent.</Text>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>n8n Webhook API URL</Text>
              <TextInput
                style={styles.webInput}
                placeholder="https://your-n8n-instance.com/webhook/..."
                value={webhookUrl}
                onChangeText={setWebhookUrl}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
            <TouchableOpacity style={styles.webSecondaryButton} onPress={handleSaveWebhook}>
              <Text style={styles.webSecondaryButtonText}>Save Configuration</Text>
            </TouchableOpacity>
          </View>

          {/* Application Form Card */}
          <View style={styles.webCard}>
            <Text style={styles.cardTitle}>Submit New Job Application</Text>
            <Text style={styles.cardDescription}>Fill out the details to send to your n8n workflow.</Text>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Job Title</Text>
              <TextInput
                style={styles.webInput}
                placeholder="e.g., Senior React Native Developer"
                value={jobTitle}
                onChangeText={setJobTitle}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Requirements</Text>
              <TextInput
                style={[styles.webInput, styles.textArea]}
                placeholder="List the job requirements..."
                value={requirements}
                onChangeText={setRequirements}
                multiline={true}
                numberOfLines={4}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Other Details</Text>
              <TextInput
                style={[styles.webInput, styles.textArea]}
                placeholder="Any other details related to the job..."
                value={description}
                onChangeText={setDescription}
                multiline={true}
                numberOfLines={4}
              />
            </View>

            <TouchableOpacity 
              style={[styles.webPrimaryButton, isLoading && styles.disabledButton]} 
              onPress={handleSubmitApplication}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.webPrimaryButtonText}>Submit Application</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Auth Split Screen Styles
  webContainer: {
    flex: 1,
    flexDirection: 'row',
    height: '100vh',
    backgroundColor: '#0a0f0d', // dark background
  },
  leftPanel: {
    flex: 1,
    justifyContent: 'center',
    padding: 60,
    paddingLeft: '10%',
    // gradient simulation:
    backgroundImage: 'radial-gradient(circle at left center, #1b3628 0%, #0a0f0d 50%)',
  },
  heroContent: {
    maxWidth: 600,
  },
  overline: {
    color: '#c4f068',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 24,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#f4f4f5',
    fontSize: 64,
    fontWeight: '800',
    marginBottom: 24,
    lineHeight: 70,
    fontFamily: 'System', // fall back to sans-serif
  },
  heroSubtitle: {
    color: '#9ca3af',
    fontSize: 18,
    lineHeight: 28,
  },
  rightPanel: {
    flex: 1,
    backgroundColor: '#0a0f0d',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  authCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#121a17',
    padding: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#24332d',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  tabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#24332d',
    marginBottom: 32,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 10,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#c4f068',
  },
  tabText: {
    color: '#6b7280',
    fontSize: 15,
    fontWeight: '500',
  },
  activeTabText: {
    color: '#f4f4f5',
    fontWeight: '600',
  },
  authHeader: {
    marginBottom: 24,
  },
  authTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: '#f4f4f5',
    marginBottom: 10,
  },
  authSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
  },
  
  // Common Form Styles
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: '#f4f4f5',
    marginBottom: 8,
  },
  webInput: {
    borderWidth: 1,
    borderColor: '#24332d',
    borderRadius: 6,
    padding: 12,
    fontSize: 15,
    backgroundColor: '#0a0f0d',
    color: '#f4f4f5',
    outlineStyle: 'none',
  },
  textArea: {
    height: 120,
    paddingTop: 12,
    outlineStyle: 'none',
  },
  webPrimaryButton: {
    backgroundColor: '#c4f068',
    padding: 14,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 12,
  },
  webPrimaryButtonText: {
    color: '#0a0f0d',
    fontSize: 15,
    fontWeight: '700',
  },
  disabledButton: {
    backgroundColor: '#a5b4fc',
  },
  
  // App Portal Styles
  webAppContainer: {
    flex: 1,
    backgroundColor: '#0a0f0d',
    height: '100vh',
  },
  webNavbar: {
    backgroundColor: '#121a17',
    height: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    borderBottomWidth: 1,
    borderBottomColor: '#24332d',
  },
  navbarBrand: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f4f4f5',
  },
  navbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userEmail: {
    marginRight: 20,
    color: '#9ca3af',
    fontSize: 14,
  },
  logoutButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 6,
  },
  logoutText: {
    color: '#ef4444',
    fontWeight: '600',
    fontSize: 14,
  },
  webContent: {
    padding: 40,
    alignItems: 'center',
  },
  gridContainer: {
    width: '100%',
    maxWidth: 600,
    gap: 24,
  },
  webCard: {
    backgroundColor: '#121a17',
    padding: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#24332d',
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f4f4f5',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 24,
  },
  webSecondaryButton: {
    backgroundColor: '#1f2e28',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  webSecondaryButtonText: {
    color: '#c4f068',
    fontSize: 15,
    fontWeight: '600',
  }
});
