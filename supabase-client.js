// =========================================================
// اتصال Supabase — تسجيل الدخول الحقيقي (Authentication)
// المفاتيح هنا عامة وآمنة للعرض في كود الواجهة (Publishable/Anon keys)،
// التحكم الفعلي بالصلاحيات يتم عبر Row Level Security داخل قاعدة البيانات.
// =========================================================
const SUPABASE_URL = 'https://hycylervsnoreaecmmhj.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vQZWB9UFCOYYu7N-OSVInQ_33quJTLf';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
