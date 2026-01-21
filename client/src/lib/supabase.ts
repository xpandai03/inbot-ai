/**
 * Supabase Client for Frontend Authentication
 *
 * Uses the anon (public) key for client-side operations.
 * All auth operations go through Supabase Auth.
 */

import { createClient } from "@supabase/supabase-js";

// Get Supabase config from environment
// In Vite, environment variables are accessed via import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Auth will not work."
  );
}

// Create Supabase client
export const supabase = createClient(
  supabaseUrl || "",
  supabaseAnonKey || "",
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

// Auth helper types
export interface UserMetadata {
  client_id?: string;
  role?: "super_admin" | "client_admin";
}

export interface AuthUser {
  id: string;
  email: string;
  clientId: string | null;
  role: "super_admin" | "client_admin";
}

/**
 * Transform Supabase user to our app's AuthUser type
 *
 * If user has no role set, defaults to client_admin with client_demo access.
 * This allows new users to sign in immediately after magic link verification.
 */
export function toAuthUser(user: {
  id: string;
  email?: string;
  user_metadata?: UserMetadata;
}): AuthUser {
  const metadata = user.user_metadata || {};
  let role = metadata.role;
  let clientId = metadata.client_id || null;

  // Default new users to client_admin with demo client access
  if (role !== "super_admin" && role !== "client_admin") {
    console.log(`[auth] User ${user.email} has no role, defaulting to client_admin`);
    role = "client_admin";
    clientId = "client_demo";
  }

  return {
    id: user.id,
    email: user.email || "",
    clientId,
    role,
  };
}
