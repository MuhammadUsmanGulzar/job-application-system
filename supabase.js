import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://msyzzsoiuzwwsksfvddj.supabase.co';
// Replace this with your actual Supabase anon key
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zeXp6c29pdXp3d3Nrc2Z2ZGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEwMjU2NTUsImV4cCI6MjEwNjYwMTY1NX0.kjRZKntFlHdeOYhUHVUE5-aYrZIr1h-5DSMt3gABEOU';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
