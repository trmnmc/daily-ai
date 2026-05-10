import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { readRequiredServerEnv } from "../server-env";
import type { Database } from "./database.types";

let adminClient: SupabaseClient<Database> | null = null;

export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (adminClient) return adminClient;

  const supabaseUrl = readRequiredServerEnv([
    "SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
  ]);
  const serviceRoleKey = readRequiredServerEnv(["SUPABASE_SERVICE_ROLE_KEY"]);

  adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return adminClient;
}
