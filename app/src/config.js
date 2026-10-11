// Public settings for the page. The publishable key is meant to be public: the
// row-level security rules in supabase/migrations/ are what protect the data.
// Never put the secret (service role) key here; it lives in secrets.json.
export const SUPABASE_URL = 'https://xoxpbhsptxttjuthgcai.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_WA7-7xQJe6iD4iqq-jfFjw_z1KgX1P9';

// 'supabase' (default) or 'file' (the old local-folder storage, for offline use):
//   VITE_STORAGE=file npm run dev
export const STORAGE = import.meta.env.VITE_STORAGE === 'file' ? 'file' : 'supabase';
