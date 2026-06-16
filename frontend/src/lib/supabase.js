import { createClient } from "@supabase/supabase-js"

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: 'implicit', // chrome.identity.launchWebAuthFlow needs tokens in hash, not PKCE code
    },
    realtime: { transport: null },
  }
)
