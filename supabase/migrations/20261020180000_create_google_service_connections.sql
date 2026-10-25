-- Migration: 20261020180000_create_google_service_connections.sql
-- Description: Foundation schema for per-user Google Calendar & Tasks service connections with RLS and encryption support.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Table for storing per-user Google OAuth service integrations (Calendar, Tasks)
CREATE TABLE IF NOT EXISTS public.user_google_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('google_calendar', 'google_tasks')),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  encrypted_refresh_token TEXT,
  encrypted_access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  google_account_email TEXT,
  is_connected BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT user_google_service_unique UNIQUE (user_id, service)
);

-- Index for user service lookup
CREATE INDEX IF NOT EXISTS idx_user_google_connections_user_service 
  ON public.user_google_connections (user_id, service);

-- Enable Row Level Security (RLS)
ALTER TABLE public.user_google_connections ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view their own connection status (never other users)
DROP POLICY IF EXISTS "Users can view their own connections" ON public.user_google_connections;
CREATE POLICY "Users can view their own connections"
  ON public.user_google_connections
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Restrict inserts, updates, and deletes to service_role (Edge Functions only)
DROP POLICY IF EXISTS "Service role can manage connections" ON public.user_google_connections;
CREATE POLICY "Service role can manage connections"
  ON public.user_google_connections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Public safe view that excludes all encrypted token columns
CREATE OR REPLACE VIEW public.user_service_connections_summary AS
  SELECT
    id,
    user_id,
    service,
    scopes,
    google_account_email,
    is_connected,
    token_expires_at,
    created_at,
    updated_at
  FROM public.user_google_connections;
