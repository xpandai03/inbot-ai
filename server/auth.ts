/**
 * Supabase Auth Middleware
 *
 * Extracts and validates Supabase JWTs from Authorization header.
 * Sets req.user with user metadata for downstream handlers.
 */

import type { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";

// User type attached to request
export interface AuthUser {
  id: string;
  email: string;
  clientId: string | null;
  role: "super_admin" | "client_admin";
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Create a Supabase client for auth verification
// Uses anon key since we're verifying user tokens, not service operations
function getAuthClient() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.warn("[auth] SUPABASE_URL or SUPABASE_ANON_KEY not configured");
    return null;
  }

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Extract JWT from Authorization header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  // Support "Bearer <token>" format
  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }

  // Also support plain token
  return authHeader;
}

/**
 * Auth middleware - validates JWT and attaches user to request
 *
 * If auth fails, responds with 401.
 * If auth succeeds, calls next() with req.user populated.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const supabase = getAuthClient();

  if (!supabase) {
    console.error("[auth] Auth not configured - rejecting request");
    return res.status(500).json({ error: "Authentication not configured" });
  }

  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: "No authorization token provided" });
  }

  try {
    // Verify the JWT and get user
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.log("[auth] Invalid token:", error?.message);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Extract metadata
    const metadata = user.user_metadata || {};
    const role = metadata.role as string;
    const clientId = metadata.client_id as string | null;

    // Validate role
    if (role !== "super_admin" && role !== "client_admin") {
      console.warn(`[auth] User ${user.email} has invalid role: ${role}`);
      return res.status(403).json({ error: "Invalid user role" });
    }

    // Client admins must have a client_id
    if (role === "client_admin" && !clientId) {
      console.warn(`[auth] Client admin ${user.email} missing client_id`);
      return res.status(403).json({ error: "Client admin missing client_id" });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email || "",
      clientId: clientId || null,
      role: role as "super_admin" | "client_admin",
    };

    console.log(`[auth] Authenticated: ${user.email} (${role})`);
    next();
  } catch (err) {
    console.error("[auth] Unexpected error:", err);
    return res.status(500).json({ error: "Authentication failed" });
  }
}

/**
 * Optional auth middleware - attaches user if token present, but doesn't require it
 *
 * Useful for routes that behave differently for authenticated vs anonymous users.
 */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const supabase = getAuthClient();
  const token = extractToken(req);

  if (!supabase || !token) {
    // No auth configured or no token - continue without user
    return next();
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (!error && user) {
      const metadata = user.user_metadata || {};
      const role = metadata.role as string;
      const clientId = metadata.client_id as string | null;

      if (role === "super_admin" || role === "client_admin") {
        req.user = {
          id: user.id,
          email: user.email || "",
          clientId: clientId || null,
          role: role as "super_admin" | "client_admin",
        };
      }
    }
  } catch {
    // Ignore errors in optional auth
  }

  next();
}

/**
 * Super admin only middleware - requires super_admin role
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.user.role !== "super_admin") {
    return res.status(403).json({ error: "Super admin access required" });
  }

  next();
}

/**
 * Get effective client ID for data filtering
 *
 * Super admins can specify any client via query param.
 * Client admins are restricted to their own client.
 */
export function getEffectiveClientId(req: Request): string | undefined {
  const queryClientId = req.query.clientId as string | undefined;

  if (!req.user) {
    // No auth - return query param as-is (will be filtered by RLS)
    return queryClientId;
  }

  if (req.user.role === "super_admin") {
    // Super admins can access any client
    return queryClientId;
  }

  // Client admins are restricted to their own client
  return req.user.clientId || undefined;
}
