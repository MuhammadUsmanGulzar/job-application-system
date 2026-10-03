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
            <Text style={styles.heroTitle}>Job Application System</Text>
            <Text style={styles.heroSubtitle}>
              Streamline your hiring process. Connect directly to your n8n workflows and manage applications effortlessly.
            </Text>
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
                {isLoginMode ? 'Enter your details to access the portal' : 'Sign up to get started'}
              </Text>
            </View>
            
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
              <Text style={styles.webPrimaryButtonText}>{isLoginMode ? 'Sign In' : 'Sign Up'}</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ marginTop: 24, alignItems: 'center' }}
              onPress={() => setIsLoginMode(!isLoginMode)}
            >
              <Text style={{ color: '#4f46e5', fontWeight: '500', fontSize: 14 }}>
                {isLoginMode ? "Don't have an account? Create one" : "Already have an account? Sign in"}
              </Text>
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
    backgroundColor: '#ffffff',
  },
  leftPanel: {
    flex: 1,
    backgroundColor: '#4f46e5',
    justifyContent: 'center',
    padding: 60,
  },
  heroContent: {
    maxWidth: 500,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 48,
    fontWeight: '800',
    marginBottom: 24,
    lineHeight: 56,
  },
  heroSubtitle: {
    color: '#e0e7ff',
    fontSize: 20,
    lineHeight: 30,
  },
  rightPanel: {
    flex: 1,
    backgroundColor: '#f9fafb',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  authCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    padding: 48,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  authHeader: {
    marginBottom: 32,
  },
  authTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  authSubtitle: {
    fontSize: 15,
    color: '#6b7280',
  },
  
  // Common Form Styles
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  webInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 14,
    fontSize: 15,
    backgroundColor: '#ffffff',
    color: '#111827',
  },
  textArea: {
    height: 120,
    paddingTop: 14,
    outlineStyle: 'none',
  },
  webPrimaryButton: {
    backgroundColor: '#4f46e5',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  webPrimaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#a5b4fc',
  },
  
  // App Portal Styles
  webAppContainer: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    height: '100vh',
  },
  webNavbar: {
    backgroundColor: '#ffffff',
    height: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  navbarBrand: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  navbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userEmail: {
    marginRight: 20,
    color: '#6b7280',
    fontSize: 14,
  },
  logoutButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#fee2e2',
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
    backgroundColor: '#ffffff',
    padding: 32,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    marginBottom: 24,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 24,
  },
  webSecondaryButton: {
    backgroundColor: '#f3f4f6',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  webSecondaryButtonText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
  }
});
