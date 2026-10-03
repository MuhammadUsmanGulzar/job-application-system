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

export default function App() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // User settings state
  const [webhookUrl, setWebhookUrl] = useState('');
  
  // Job application state
  const [jobTitle, setJobTitle] = useState('');
  const [requirements, setRequirements] = useState('');
  const [description, setDescription] = useState('');
  
  const [isLoading, setIsLoading] = useState(false);

  // In a real app, this would be loaded from your auth context / secure storage
  const currentUser = {
    id: 'user-uuid-1234',
    email: email || 'user@example.com'
  };

  const handleSaveWebhook = () => {
    // Here you would save the webhook URL to your database for this user
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
      // Send the data directly to the user's specific n8n webhook
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
      <View style={[styles.container, { justifyContent: 'center', padding: 20 }]}>
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { textAlign: 'center', fontSize: 24, marginBottom: 20 }]}>
            {isLoginMode ? 'Welcome Back' : 'Create Account'}
          </Text>
          
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity 
            style={styles.primaryButton}
            onPress={() => {
              if (email && password) {
                setIsAuthenticated(true);
              } else {
                Alert.alert('Error', 'Please enter both email and password');
              }
            }}
          >
            <Text style={styles.primaryButtonText}>{isLoginMode ? 'Login' : 'Sign Up'}</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={{ marginTop: 20, alignItems: 'center' }}
            onPress={() => setIsLoginMode(!isLoginMode)}
          >
            <Text style={{ color: '#3b82f6', fontWeight: '600' }}>
              {isLoginMode ? "Don't have an account? Sign Up" : "Already have an account? Login"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={[styles.header, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
        <Text style={styles.headerTitle}>Portal</Text>
        <TouchableOpacity onPress={() => setIsAuthenticated(false)}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* User Settings Section */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>1. Integration Settings</Text>
        <Text style={styles.label}>Your n8n Webhook API URL:</Text>
        <TextInput
          style={styles.input}
          placeholder="https://your-n8n-instance.com/webhook/..."
          value={webhookUrl}
          onChangeText={setWebhookUrl}
          autoCapitalize="none"
          keyboardType="url"
        />
        <TouchableOpacity style={styles.secondaryButton} onPress={handleSaveWebhook}>
          <Text style={styles.secondaryButtonText}>Save API Key / URL</Text>
        </TouchableOpacity>
      </View>

      {/* Job Application Form */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>2. Job Application Form</Text>
        
        <Text style={styles.label}>Job Title</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Senior React Native Developer"
          value={jobTitle}
          onChangeText={setJobTitle}
        />

        <Text style={styles.label}>Requirements</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="List the job requirements..."
          value={requirements}
          onChangeText={setRequirements}
          multiline={true}
          numberOfLines={4}
        />

        <Text style={styles.label}>Other Details</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Any other details related to the job..."
          value={description}
          onChangeText={setDescription}
          multiline={true}
          numberOfLines={4}
        />

        <TouchableOpacity 
          style={[styles.primaryButton, isLoading && styles.disabledButton]} 
          onPress={handleSubmitApplication}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Submit to n8n</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  header: {
    backgroundColor: '#3b82f6',
    padding: 20,
    paddingTop: 60,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#ffffff',
    margin: 15,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#1f2937',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4b5563',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9fafb',
    marginBottom: 15,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#e5e7eb',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#93c5fd',
  }
});
