import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';

const SESSION_CREATED_AT_KEY = '@job_system_session_created_at';
const SESSION_LAST_ACTIVE_KEY = '@job_system_session_last_active';

// Enforce both requested policies:
// 1. Inactivity timeout: 4 hours
export const INACTIVITY_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

// 2. Absolute maximum session limit: 7 days
export const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

let inMemoryLastActive = Date.now();
let inMemoryCreatedAt = Date.now();
let lastRecordWriteTime = 0;

/**
 * Initialize or refresh session timestamps on sign in or fresh session
 */
export async function initSession(userId) {
  const now = Date.now();
  try {
    const existingCreatedAt = await AsyncStorage.getItem(SESSION_CREATED_AT_KEY);
    if (!existingCreatedAt) {
      inMemoryCreatedAt = now;
      await AsyncStorage.setItem(SESSION_CREATED_AT_KEY, String(now));
    } else {
      inMemoryCreatedAt = parseInt(existingCreatedAt, 10) || now;
    }

    inMemoryLastActive = now;
    lastRecordWriteTime = now;
    await AsyncStorage.setItem(SESSION_LAST_ACTIVE_KEY, String(now));
  } catch (err) {
    console.warn('Session init timestamp warning:', err);
  }
}

/**
 * Record user activity (throttled to avoid writing to storage on every pixel move)
 */
export async function recordUserActivity() {
  const now = Date.now();
  inMemoryLastActive = now;

  // Throttle AsyncStorage writes to at most once every 15 seconds
  if (now - lastRecordWriteTime > 15000) {
    lastRecordWriteTime = now;
    try {
      await AsyncStorage.setItem(SESSION_LAST_ACTIVE_KEY, String(now));
    } catch (_) {}
  }
}

/**
 * Check if the current session has exceeded the 4-hour inactivity timeout
 * or the 7-day maximum absolute session limit.
 */
export async function checkSessionStatus() {
  const now = Date.now();

  try {
    const storedCreatedAtStr = await AsyncStorage.getItem(SESSION_CREATED_AT_KEY);
    const storedLastActiveStr = await AsyncStorage.getItem(SESSION_LAST_ACTIVE_KEY);

    const createdAt = storedCreatedAtStr ? parseInt(storedCreatedAtStr, 10) : inMemoryCreatedAt;
    const lastActive = storedLastActiveStr ? parseInt(storedLastActiveStr, 10) : inMemoryLastActive;

    // If no timestamps exist yet, assume session is starting
    if (!storedCreatedAtStr && !storedLastActiveStr) {
      return { expired: false };
    }

    // 1. Check 7-day maximum absolute session duration
    if (createdAt && (now - createdAt > MAX_SESSION_AGE_MS)) {
      return {
        expired: true,
        reason: 'Your session has reached the maximum duration of 7 days. Please sign in again for your security.',
      };
    }

    // 2. Check 4-hour inactivity timeout
    if (lastActive && (now - lastActive > INACTIVITY_TIMEOUT_MS)) {
      return {
        expired: true,
        reason: 'Your session has expired due to 4 hours of inactivity. Please sign in again.',
      };
    }

    return { expired: false };
  } catch (err) {
    console.warn('Session status check error:', err);
    return { expired: false };
  }
}

/**
 * Clear session timestamps from AsyncStorage on sign out
 */
export async function clearSessionTimestamps() {
  inMemoryLastActive = Date.now();
  inMemoryCreatedAt = Date.now();
  lastRecordWriteTime = 0;
  try {
    await AsyncStorage.multiRemove([SESSION_CREATED_AT_KEY, SESSION_LAST_ACTIVE_KEY]);
  } catch (_) {}
}

/**
 * Setup inactivity tracking listeners (user interaction, visibility change, and interval check)
 */
export function setupSessionTracking(onExpired) {
  let isChecking = false;

  const checkAndHandleExpiry = async () => {
    if (isChecking) return;
    isChecking = true;
    try {
      const status = await checkSessionStatus();
      if (status.expired) {
        await clearSessionTimestamps();
        await supabase.auth.signOut();
        if (typeof onExpired === 'function') {
          onExpired(status.reason);
        }
      }
    } catch (err) {
      console.warn('Session tracking check failed:', err);
    } finally {
      isChecking = false;
    }
  };

  const handleUserActivity = () => {
    recordUserActivity();
  };

  const handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      // Re-focused or laptop woke from sleep: check if expired while asleep/away
      checkAndHandleExpiry();
    }
  };

  // Web event listeners
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, handleUserActivity, { passive: true });
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // Check every 30 seconds
    const intervalId = setInterval(checkAndHandleExpiry, 30000);

    return () => {
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, handleUserActivity);
      });
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      clearInterval(intervalId);
    };
  }

  // Fallback for non-web environments (Expo / React Native)
  const intervalId = setInterval(checkAndHandleExpiry, 30000);
  return () => clearInterval(intervalId);
}
