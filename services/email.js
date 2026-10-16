import { Linking, Platform } from 'react-native';
import { supabase } from '../supabase';

/**
 * Encodes subject and body into a mailto URL and opens the user's default email client
 */
export async function openMailtoComposer({ to, subject, body }) {
  if (!to) {
    throw new Error('Recipient email is required.');
  }

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

  return { success: true, method: 'mailto_fallback' };
}

/**
 * Sends an email directly via the Gmail API using the user's connected OAuth refresh token.
 * Calls the Supabase Edge Function: /functions/v1/gmail-send
 */
export async function sendEmailViaGmailApi({
  to,
  subject,
  body,
  applicationId,
  applicationEmailId,
}) {
  if (!to) {
    throw new Error('Recipient email address is required.');
  }

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    throw new Error('You must be logged in to send emails via Gmail.');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://msyzzsoiuzwwsksfvddj.supabase.co';
  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/gmail-send`;

  const response = await fetch(edgeFunctionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      to,
      subject,
      body,
      applicationId,
      applicationEmailId,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    const errorMsg = result?.error || 'Failed to send email via Gmail API';
    const err = new Error(errorMsg);
    err.notConnected = !!result?.not_connected;
    err.details = result;
    throw err;
  }

  return {
    success: true,
    method: 'gmail-api',
    messageId: result.messageId,
    threadId: result.threadId,
    sender: result.sender,
  };
}

/**
 * Unified send function:
 * First attempts to send directly via Gmail API.
 * If fallbackToMailto is true and Gmail is not connected or fails, falls back to mailto.
 */
export async function sendEmail({
  to,
  subject,
  body,
  applicationId,
  applicationEmailId,
  fallbackToMailto = false,
}) {
  try {
    return await sendEmailViaGmailApi({
      to,
      subject,
      body,
      applicationId,
      applicationEmailId,
    });
  } catch (err) {
    if (fallbackToMailto || err.notConnected) {
      console.warn('Gmail API unavailable or not connected, falling back to mailto:', err.message);
      return await openMailtoComposer({ to, subject, body });
    }
    throw err;
  }
}
