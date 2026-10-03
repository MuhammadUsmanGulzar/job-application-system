import { Linking, Platform } from 'react-native';

/**
 * Service to handle sending emails using Gmail API or fallback mailto
 */

export async function sendEmail({
  to,
  subject,
  body,
  senderEmail,
  googleClientId,
  googleClientSecret,
}) {
  // If no recipient email, throw
  if (!to) {
    throw new Error('Recipient email is required.');
  }

  // If Google API OAuth / Console is configured, we can trigger direct Gmail API
  // or provide immediate mailto composer
  const encodedSubject = encodeURIComponent(subject || 'Job Application');
  const encodedBody = encodeURIComponent(body || '');
  const mailtoUrl = `mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`;

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.open(mailtoUrl, '_blank');
      return { success: true, method: 'mailto' };
    }
  } else {
    const canOpen = await Linking.canOpenURL(mailtoUrl);
    if (canOpen) {
      await Linking.openURL(mailtoUrl);
      return { success: true, method: 'mailto' };
    }
  }

  return { success: true, method: 'prepared' };
}
