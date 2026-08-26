// =========================================================
// AOL GYM — تطبيق صالة أكاديمية التعلم الرياضية (نموذج أولي تفاعلي)
// =========================================================

// النسخة الحقيقية (الموقع المنشور) لا تُظهر أدوات العرض التجريبي — تبقى فقط في نسخة البروتوتايب المستقلة (file:// أو محلياً)
const IS_DEMO_BUILD = (typeof location !== 'undefined') && (location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

const state = {
  role: null,           // 'client' | 'trainer' | 'admin'
  route: 'login',
  params: {},
  ticketDraft: { category: 'فني', subject: '', message: '' },
  toastTimer: null,
  deferredInstallPrompt: null,   // حدث تثبيت PWA (Android/Chrome/Edge) بانتظار الاستخدام
  installBannerDismissed: false,
  isStandalone: window.matchMedia && window.matchMedia('(display-mode: standalone)').matches,
  pendingApprovals: null,
};

const $app = document.getElementById('app');

// ---------------------------------------------------------
// تثبيت التطبيق (PWA) — التقاط حدث المتصفح وعرض زر تثبيت مخصص
// ---------------------------------------------------------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
  render();
});

window.addEventListener('appinstalled', () => {
  state.deferredInstallPrompt = null;
  state.isStandalone = true;
  toast('تم تثبيت التطبيق بنجاح ✔');
  render();
});

function installApp(){
  if (!state.deferredInstallPrompt) return;
  state.deferredInstallPrompt.prompt();
  state.deferredInstallPrompt.userChoice.finally(() => {
    state.deferredInstallPrompt = null;
    render();
  });
}
window.installApp = installApp;

function dismissInstallBanner(){
  state.installBannerDismissed = true;
  render();
}
window.dismissInstallBanner = dismissInstallBanner;

function installBanner(){
  if (state.isStandalone || state.installBannerDismissed) return '';
  if (state.deferredInstallPrompt) {
    return `<div class="install-banner">
      <span class="install-banner-icon">${icon('download')}</span>
      <span class="install-banner-text"><b>ثبّتي تطبيق AOL GYM</b><span>وصول أسرع من الشاشة الرئيسية مباشرة</span></span>
      <button class="install-banner-btn" onclick="installApp()">تثبيت</button>
      <button class="install-banner-x" onclick="dismissInstallBanner()">${icon('x')}</button>
    </div>`;
  }
  if (isIOS) {
    return `<div class="install-banner install-banner-ios">
      <span class="install-banner-icon">${icon('download')}</span>
      <span class="install-banner-text"><b>ثبّتي التطبيق على آيفون</b><span>اضغطي زر المشاركة <b>⬆️</b> ثم "إضافة إلى الشاشة الرئيسية"</span></span>
      <button class="install-banner-x" onclick="dismissInstallBanner()">${icon('x')}</button>
    </div>`;
  }
  return '';
}

function fmtMoney(n){ return n.toLocaleString('ar-SA') + ' ر.س'; }

// قياس InBody الأخير — مع قيمة بديلة عند عدم وجود أي قياسات مسجّلة بعد للمتدرب
function lastInbody(){
  return (DB.inbody && DB.inbody.length) ? DB.inbody.at(-1) : { weight:'—', muscle:'—', fat:'—', date:'لا يوجد قياس بعد' };
}

function go(route, params={}){
  state.route = route;
  state.params = params;
  render();
  const body = document.querySelector('.screen-body');
  if(body) body.scrollTop = 0;
}
window.go = go;

function toast(msg){
  let t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(()=> t.classList.remove('show'), 2200);
}
window.toast = toast;

function openSheet(html){
  const backdrop = document.getElementById('sheet-backdrop');
  const sheet = document.getElementById('sheet-content');
  sheet.innerHTML = `<div class="sheet-handle"></div>` + html;
  backdrop.classList.add('show');
}
window.openSheet = openSheet;
function closeSheet(){
  document.getElementById('sheet-backdrop').classList.remove('show');
}
window.closeSheet = closeSheet;

function setRole(role){
  state.role = role;
  const home = { client:'client-home', trainer:'trainer-home', admin:'admin-dashboard' }[role];
  go(home);
}
window.setRole = setRole;

function logout(){
  state.role = null;
  state.authUser = null;
  state.authProfile = null;
  if (typeof sb !== 'undefined') sb.auth.signOut();
  go('login');
}
window.logout = logout;

// ---------------------------------------------------------
// تسجيل الدخول الحقيقي عبر Supabase (Authentication)
// ---------------------------------------------------------
state.authUser = null;
state.authProfile = null;
state.authBusy = false;
state.authMode = 'signin'; // 'signin' | 'signup'
state.authError = '';

// بيانات خطوة إكمال الملف الشخصي بعد أول تسجيل دخول (نوع الحساب + الفرع)
state.cpNeedsCategory = false;
state.cpCategory = 'trainee'; // 'trainee' | 'staff'
state.cpBranch = null; // 'فرع الدمام' | 'فرع الرياض'

function setAuthMode(mode){
  state.authMode = mode;
  state.authError = '';
  render();
}
window.setAuthMode = setAuthMode;

function setCpCategory(cat){
  state.cpCategory = cat;
  render();
}
window.setCpCategory = setCpCategory;

function setCpBranch(branch){
  state.cpBranch = branch;
  render();
}
window.setCpBranch = setCpBranch;

const OWNER_EMAIL = 'hanan.h.almaymuni@gmail.com';
const ALLOWED_DOMAIN = 'aol.edu.sa';

function isAllowedEmail(email){
  const e = (email || '').trim().toLowerCase();
  if (e === OWNER_EMAIL) return true;
  return e.endsWith('@' + ALLOWED_DOMAIN);
}

async function loadProfileAndEnter(user){
  state.authUser = user;
  let profile = null;
  try {
    const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
    if (!error) profile = data;
  } catch (e) { /* ignore */ }
  state.authProfile = profile;
  const displayName = (profile && profile.full_name) || user.email;
  // نربط بيانات الحساب الحقيقي مع اسم العرض في شاشات العميل الحالية (المحتوى التفصيلي لا يزال تجريبياً في هذه المرحلة)
  DB.users.client.name = displayName;
  DB.users.trainer.name = displayName;
  DB.users.admin.name = displayName;
  DB.users.client.phone = (profile && profile.phone) || '';
  DB.users.client.nationalId = (profile && profile.national_id) || '';
  DB.users.client.email = user.email || '';

  await loadLiveData();

  // نوع الحساب (متدرب/طاقم) والفرع يُختاران بعد تسجيل الدخول لأول مرة (وليس عند التسجيل نفسه)
  const needsCategory = !!(profile && profile.role === 'client' && !profile.branch);
  // المتدرب والطاقم الأكاديمي/الإداري كلاهما يكمل العمر/الوزن/الدبلوم أول مرة يسجل دخول
  const needsExtra = !!(profile && profile.role === 'client' && profile.age == null);
  if (needsCategory || needsExtra) {
    state.cpNeedsCategory = needsCategory;
    state.cpCategory = (profile && profile.category) || 'trainee';
    state.cpBranch = (profile && profile.branch) || null;
    go('complete-profile');
    return;
  }
  setRole((profile && profile.role) || 'client');
}

// ---------------------------------------------------------
// تحويل صفوف Supabase إلى الشكل الذي تتوقعه شاشات الواجهة
// ---------------------------------------------------------
const BRANCHES = ['فرع الدمام', 'فرع الرياض'];
const DIPLOMAS = [
  'دبلوم المحاسبة والضرائب',
  'دبلوم إدارة الفنادق والمنتجعات السياحية',
  'دبلوم التسويق والتجارة الإلكترونية',
  'دبلوم إدارة سلاسل الإمداد والخدمات اللوجستية',
  'دبلوم التأمين وإدارة المخاطر',
  'دبلوم إدارة الأعمال',
  'دبلوم التصميم الجرافيكي',
  'دبلوم الأمن السيبراني',
  'دبلوم الذكاء الاصطناعي',
  'دبلوم السلامة والصحة المهنية',
  'دبلوم العلاقات العامّة والإعلام',
  'دبلوم تنظيم وإدارة الفعاليات',
  'دبلوم الموارد البشرية',
];
function mapClass(r){ return { id:r.id, name:r.name, type:r.type, trainer:r.trainer_name, day:r.day, time:r.time, duration:r.duration, capacity:r.capacity, booked:r.booked, location:r.location, branch:r.branch }; }
function mapSlot(r){ return { id:r.id, trainer:r.trainer_name, date:r.slot_date, time:r.slot_time, type:r.session_type, isBooked:r.is_booked, branch:r.branch }; }
function mapOffer(r){ return { id:r.id, title:r.title, audience:r.audience, status:r.status, sent:(r.created_at||'').slice(0,10), reach:r.reach }; }
function mapBooking(r){ return { id:r.id, classId:r.class_id, slotId:r.slot_id, title:r.title, date:r.booking_date, time:r.booking_time, trainer:r.trainer_name, status:r.status }; }
function mapInbody(r){ return { id:r.id, date:r.record_date, weight:r.weight, muscle:r.muscle, fat:r.fat }; }
function mapProgram(r){ return { id:r.id, type:r.type, title:r.title, trainer:r.trainer_name, date:r.program_date, notes:r.notes }; }
function mapTicket(r){ return { id:r.id, category:r.category, subject:r.subject, status:r.status, date:(r.created_at||'').slice(0,10), reply:r.reply, userId:r.user_id }; }
function mapNotif(r){ return { id:r.id, title:r.title, body:r.body, type:r.type, read:r.read, time:relTimeAr(r.created_at) }; }
function mapStaff(r){ return { id:r.id, name:r.name, role:r.role, access:r.access }; }
function mapRole(r){ return { id:r.id, role:r.role, perms:r.perms||[] }; }
function mapTrainerRating(r){ return { id:r.id, trainer:r.trainer, avg:r.avg, count:r.count }; }
function mapAttendance(r){ return { id:r.id, name:r.member_name, type:r.type, method:r.method, time:arTime(r.occurred_at) }; }

function arTime(iso){
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' }); }
  catch(e){ return ''; }
}

function relTimeAr(iso){
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? 'قبل ساعة' : `قبل ${hrs} ساعات`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'أمس';
  return `قبل ${days} أيام`;
}

// يحمّل الكتالوج المشترك (كلاسات/مواعيد خاصة/عروض/تذاكر) وبيانات المستخدم الخاصة (حجوزاته، قياساته، برامجه، إشعاراته)
async function loadLiveData(){
  if (typeof sb === 'undefined' || !state.authUser) return;
  const uid = state.authUser.id;
  const isAdminUser = state.authProfile && state.authProfile.role === 'admin';

  const [classesRes, slotsRes, offersRes, ticketsRes, bookingsRes, inbodyRes, programsRes, notifRes, ratingsRes] = await Promise.all([
    sb.from('classes').select('*').order('day'),
    sb.from('private_slots').select('*').order('created_at'),
    sb.from('offers').select('*').order('created_at', { ascending: false }),
    sb.from('tickets').select('*').order('created_at', { ascending: false }),
    isAdminUser ? Promise.resolve({ data: [], error: null }) : sb.from('bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    isAdminUser ? Promise.resolve({ data: [], error: null }) : sb.from('inbody_records').select('*').eq('user_id', uid).order('record_date'),
    isAdminUser ? Promise.resolve({ data: [], error: null }) : sb.from('programs').select('*').eq('user_id', uid).order('program_date', { ascending: false }),
    isAdminUser ? Promise.resolve({ data: [], error: null }) : sb.from('notifications').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    sb.from('trainer_ratings').select('*').order('avg', { ascending: false }),
  ]);

  if (!classesRes.error && classesRes.data) DB.classes = classesRes.data.map(mapClass);
  if (!slotsRes.error && slotsRes.data) DB.privateSlots = slotsRes.data.map(mapSlot);
  if (!offersRes.error && offersRes.data) DB.offers = offersRes.data.map(mapOffer);
  if (!ticketsRes.error && ticketsRes.data) DB.tickets = ticketsRes.data.map(mapTicket);
  if (!ratingsRes.error && ratingsRes.data) DB.trainerRatings = ratingsRes.data.map(mapTrainerRating);
  if (!isAdminUser) {
    if (!bookingsRes.error && bookingsRes.data) DB.bookings = bookingsRes.data.map(mapBooking);
    if (!inbodyRes.error && inbodyRes.data) DB.inbody = inbodyRes.data.map(mapInbody);
    if (!programsRes.error && programsRes.data) DB.programs = programsRes.data.map(mapProgram);
    if (!notifRes.error && notifRes.data) DB.notifications = notifRes.data.map(mapNotif);
  }
  if (isAdminUser) {
    await loadAdminData();
  }
  if (state.authProfile && state.authProfile.role === 'trainer') {
    await loadTrainerData();
  }
}

// يحمّل قائمة المتدربين الحقيقيين لشاشة "عملائي" الخاصة بالمدرب
async function loadTrainerData(){
  const { data, error } = await sb.from('profiles').select('id, full_name, phone, branch').eq('role', 'client').order('full_name');
  DB.realClients = (!error && data) ? data : [];
}

// يحمّل بيانات لوحة الإدارة (الفريق، الصلاحيات، سجل الحضور، الإحصائيات) — للأدمن فقط
async function loadAdminData(){
  const [staffRes, rolesRes, logRes, statsRes, bookingsCountRes, newMembersRes, trainersRes] = await Promise.all([
    sb.from('staff_members').select('*').order('sort_order'),
    sb.from('access_roles').select('*').order('sort_order'),
    sb.from('attendance_log').select('*').order('occurred_at', { ascending: false }).limit(20),
    sb.from('admin_stats').select('*').eq('id', 1).maybeSingle(),
    sb.from('bookings').select('id', { count: 'exact', head: true }).eq('status', 'مؤكد'),
    sb.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7*24*60*60*1000).toISOString()),
    sb.from('profiles').select('id, full_name').eq('role', 'trainer').order('full_name'),
  ]);

  if (!staffRes.error && staffRes.data) DB.staff = staffRes.data.map(mapStaff);
  if (!rolesRes.error && rolesRes.data) DB.roles = rolesRes.data.map(mapRole);
  if (!logRes.error && logRes.data) DB.attendanceLog = logRes.data.map(mapAttendance);
  DB.trainers = (!trainersRes.error && trainersRes.data) ? trainersRes.data.map(t=>t.full_name).filter(Boolean) : [];

  const s = (!statsRes.error && statsRes.data) ? statsRes.data : null;
  DB.attendanceTrend = s ? (s.attendance_trend || []) : [];
  DB.serviceUsage = s ? (s.service_usage || []) : [];
  DB.weeklyStats = {
    visits: s ? s.visits : 0,
    completedSessions: s ? s.completed_sessions : 0,
    attendanceRate: s ? s.attendance_rate : 0,
    bookings: bookingsCountRes.error ? 0 : (bookingsCountRes.count || 0),
    newMembers: newMembersRes.error ? 0 : (newMembersRes.count || 0),
  };
}

async function realSignIn(){
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!email || !password) { state.authError = 'الرجاء تعبئة البريد الإلكتروني وكلمة المرور'; render(); return; }
  state.authBusy = true; state.authError = ''; render();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  state.authBusy = false;
  if (error) {
    state.authError = error.message.includes('Invalid') ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : error.message;
    render();
    return;
  }
  await loadProfileAndEnter(data.user);
}
window.realSignIn = realSignIn;

// حسابات تجريبية جاهزة للنقر المباشر (تحتاج إنشاءها مرة واحدة عبر نموذج التسجيل الحقيقي)
const DEMO_ACCOUNTS = [
  { label: 'دخول كمتدرب (تجريبي)', email: 'demo.trainee@aol.edu.sa', password: 'Demo@12345' },
  { label: 'دخول كطاقم أكاديمي (تجريبي)', email: 'demo.staff@aol.edu.sa', password: 'Demo@12345' },
  { label: 'دخول كمدرب رياضي (تجريبي)', email: 'demo.trainer@aol.edu.sa', password: 'Demo@12345' },
  { label: 'دخول كإدارة (تجريبي)', email: 'demo.admin@aol.edu.sa', password: 'Demo@12345' },
];
async function quickLogin(email, password){
  state.authBusy = true; state.authError = ''; render();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  state.authBusy = false;
  if (error) {
    state.authError = 'هذا الحساب التجريبي غير موجود بعد — أنشئيه أولاً من تبويب "إنشاء حساب جديد" بنفس البريد وكلمة المرور المذكورَين';
    render();
    return;
  }
  await loadProfileAndEnter(data.user);
}
window.quickLogin = quickLogin;

async function realSignUp(){
  const name = document.getElementById('auth-name').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;

  if (!name || !email || !password) { state.authError = 'الرجاء تعبئة جميع الحقول'; render(); return; }
  if (password.length < 6) { state.authError = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'; render(); return; }
  if (!isAllowedEmail(email)) { state.authError = `التسجيل متاح فقط للبريد الإلكتروني الرسمي ضمن نطاق @${ALLOWED_DOMAIN}`; render(); return; }

  state.authBusy = true; state.authError = ''; render();
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: name } }
  });
  state.authBusy = false;
  if (error) {
    if (error.message.includes('already registered')) state.authError = 'هذا البريد الإلكتروني مسجّل مسبقاً';
    else if (error.message.includes(ALLOWED_DOMAIN)) state.authError = error.message;
    else state.authError = error.message;
    render();
    return;
  }
  if (data.user && !data.session) {
    // تفعيل البريد الإلكتروني مطلوب قبل الدخول
    state.authError = '';
    toast('تم إنشاء الحساب! تحققي من بريدك الإلكتروني لتفعيله ثم سجّلي الدخول');
    state.authMode = 'signin';
    render();
    return;
  }
  if (data.user) await loadProfileAndEnter(data.user);
}
window.realSignUp = realSignUp;

// عند تحميل التطبيق: تحقق إن كان هناك جلسة محفوظة مسبقاً (المستخدم ما يحتاج يسجل دخول كل مرة)
async function checkExistingSession(){
  if (typeof sb === 'undefined') return;
  const { data } = await sb.auth.getSession();
  if (data && data.session && data.session.user) {
    await loadProfileAndEnter(data.session.user);
  }
}

// ---------------------------------------------------------
// نسيت كلمة المرور — إرسال رابط إعادة تعيين ثم تحديثها
// ---------------------------------------------------------
state.authResetError = '';
state.authResetBusy = false;

function goForgotPassword(){
  state.authError = '';
  state.authResetError = '';
  go('forgot-password');
}
window.goForgotPassword = goForgotPassword;

async function sendPasswordReset(){
  const email = document.getElementById('reset-email').value.trim();
  if (!email) { state.authResetError = 'الرجاء إدخال البريد الإلكتروني'; render(); return; }
  state.authResetBusy = true; state.authResetError = ''; render();
  const redirectTo = window.location.href.split('#')[0].split('?')[0];
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  state.authResetBusy = false;
  if (error) { state.authResetError = error.message; render(); return; }
  toast('تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني');
  state.authMode = 'signin';
  go('login');
}
window.sendPasswordReset = sendPasswordReset;

async function updatePasswordAfterRecovery(){
  const p1 = document.getElementById('reset-new-password').value;
  const p2 = document.getElementById('reset-new-password-confirm').value;
  if (!p1 || p1.length < 6) { state.authResetError = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'; render(); return; }
  if (p1 !== p2) { state.authResetError = 'كلمتا المرور غير متطابقتين'; render(); return; }
  state.authResetBusy = true; state.authResetError = ''; render();
  const { data, error } = await sb.auth.updateUser({ password: p1 });
  state.authResetBusy = false;
  if (error) { state.authResetError = error.message; render(); return; }
  toast('تم تحديث كلمة المرور بنجاح');
  if (data && data.user) await loadProfileAndEnter(data.user);
  else go('login');
}
window.updatePasswordAfterRecovery = updatePasswordAfterRecovery;

// Supabase يفتح رابط البريد ويُنشئ جلسة استرجاع مؤقتة تلقائياً — نلتقط هذا الحدث وننقل المستخدم لشاشة تعيين كلمة مرور جديدة
function setupAuthListener(){
  if (typeof sb === 'undefined') return;
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      state.authResetError = '';
      go('reset-password');
    }
  });
}

// قفل بسيط يمنع تنفيذ أكثر من عملية حجز/إلغاء في نفس اللحظة (نقر متكرر سريع)
state.bookingBusy = false;

async function toggleBooking(classId){
  if (state.bookingBusy) return;
  const c = DB.classes.find(x=>x.id===classId);
  if(!c) return;
  const existing = DB.bookings.find(b=>b.classId===classId && b.status==='مؤكد');
  state.bookingBusy = true; render();
  try {
    if (existing) {
      const { error } = await sb.from('bookings').delete().eq('id', existing.id);
      if (error) { toast('حدث خطأ: ' + error.message); return; }
      toast('تم إلغاء الحجز');
    } else {
      const { error } = await sb.from('bookings').insert({
        user_id: state.authUser.id, class_id: c.id, title: c.name,
        booking_date: c.day, booking_time: c.time, trainer_name: c.trainer, status: 'مؤكد'
      });
      if (error) {
        // 23505 = محاولة حجز مكرر لنفس الكلاس (تحمي منها قاعدة البيانات) — نتجاهلها بهدوء ونحدّث الحالة فقط
        if (error.code !== '23505') toast('حدث خطأ: ' + error.message);
        return;
      }
      toast('تم تأكيد الحجز بنجاح');
    }
  } catch (e) {
    toast('تعذّر الاتصال، حاولي مرة أخرى');
  } finally {
    state.bookingBusy = false;
    await loadLiveData();
    render();
  }
}
window.toggleBooking = toggleBooking;

async function bookPrivateSlot(slotId){
  if (state.bookingBusy) return;
  const s = DB.privateSlots.find(x=>x.id===slotId);
  if(!s || s.isBooked) return;
  state.bookingBusy = true; render();
  try {
    const { error: insErr } = await sb.from('bookings').insert({
      user_id: state.authUser.id, slot_id: s.id, title: s.type,
      booking_date: s.date, booking_time: s.time, trainer_name: s.trainer, status: 'مؤكد'
    });
    if (insErr) {
      if (insErr.code !== '23505') toast('حدث خطأ: ' + insErr.message);
      return;
    }
    const { error: updErr } = await sb.from('private_slots').update({ is_booked: true }).eq('id', s.id);
    if (updErr) { toast('حدث خطأ: ' + updErr.message); return; }
    toast('تم تأكيد حجز الموعد الخاص');
  } catch (e) {
    toast('تعذّر الاتصال، حاولي مرة أخرى');
  } finally {
    state.bookingBusy = false;
    await loadLiveData();
    render();
  }
}
window.bookPrivateSlot = bookPrivateSlot;

function joinTrack(trackId){
  const t = DB.tracks.find(x=>x.id===trackId);
  toast('تم إرسال طلب الانضمام لـ «' + (t?t.name:'المسار') + '» للمشرف الأكاديمي');
}
window.joinTrack = joinTrack;

async function submitTicket(){
  const subj = document.getElementById('tk-subject').value.trim();
  const msg = document.getElementById('tk-message').value.trim();
  if(!subj || !msg){ toast('الرجاء تعبئة كل الحقول'); return; }
  const { error } = await sb.from('tickets').insert({
    user_id: state.authUser.id, category: state.ticketDraft.category, subject: subj, message: msg
  });
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  toast('تم إرسال طلبك للدعم الفني');
  state.ticketDraft = { category: 'فني', subject: '', message: '' };
  await loadLiveData();
  go('client-support');
}
window.submitTicket = submitTicket;

function setTicketCategory(cat){
  state.ticketDraft.category = cat;
  render();
}
window.setTicketCategory = setTicketCategory;

function requestBranchChange(){
  const current = (state.authProfile && state.authProfile.branch) || '';
  const other = BRANCHES.find(b=>b!==current) || BRANCHES[0];
  state.ticketDraft = {
    category: 'إداري',
    subject: 'طلب تغيير الفرع',
    message: `أرغب بتغيير فرعي الحالي (${current}) إلى (${other}).`
  };
  go('client-support-new');
}
window.requestBranchChange = requestBranchChange;

async function markAllRead(){
  const unreadIds = DB.notifications.filter(n=>!n.read).map(n=>n.id);
  if (!unreadIds.length) return;
  const { error } = await sb.from('notifications').update({ read: true }).in('id', unreadIds);
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  await loadLiveData();
  render();
}
window.markAllRead = markAllRead;

function rateSession(stars){
  toast('شكراً لتقييمك! (' + stars + ' نجوم)');
  closeSheet();
}
window.rateSession = rateSession;

function simulateScan(){
  toast('تم تسجيل الدخول بنجاح عبر QR ✔ الساعة ' + new Date().toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}));
}
window.simulateScan = simulateScan;

async function addOffer(){
  const title = document.getElementById('offer-title').value.trim();
  if(!title){ toast('الرجاء كتابة عنوان العرض'); return; }
  const { error } = await sb.from('offers').insert({ title, audience:'جميع المتدربين', status:'مفعّل', reach:0 });
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  toast('تم إرسال العرض للمتدربين');
  await loadLiveData();
  go('admin-offers');
}
window.addOffer = addOffer;

state.editingClass = null;

function openNewClass(){
  state.editingClass = null;
  go('admin-classes-new');
}
window.openNewClass = openNewClass;

function openEditClass(id){
  state.editingClass = DB.classes.find(c=>c.id===id) || null;
  go('admin-classes-new');
}
window.openEditClass = openEditClass;

function formatTimeAr(hhmm){
  if (!hhmm) return '';
  const [h,m] = hhmm.split(':').map(Number);
  if (isNaN(h)) return hhmm;
  const period = h >= 12 ? 'م' : 'ص';
  const h12 = ((h % 12) || 12);
  return `${String(h12).padStart(2,'0')}:${String(m||0).padStart(2,'0')} ${period}`;
}

async function saveClass(){
  const name = document.getElementById('cls-name').value.trim();
  const branch = document.getElementById('cls-branch').value;
  const day = document.getElementById('cls-day').value;
  const timeRaw = document.getElementById('cls-time').value;
  const trainer = document.getElementById('cls-trainer').value;
  const capacity = Number(document.getElementById('cls-capacity').value) || 16;
  if(!name || !timeRaw){ toast('الرجاء تعبئة اسم الصف الرياضي والوقت'); return; }
  if (timeRaw < '08:00' || timeRaw > '20:00') { toast('الوقت يجب أن يكون ضمن أوقات العمل الرسمية: 8:00 ص — 8:00 م'); return; }
  const time = formatTimeAr(timeRaw);
  const editing = state.editingClass;

  const { error } = editing
    ? await sb.from('classes').update({ name, trainer_name: trainer, day, time, capacity, branch }).eq('id', editing.id)
    : await sb.from('classes').insert({ name, type:'عام', trainer_name: trainer, day, time, duration:'45 د', capacity, location:'الصالة الرئيسية', branch });

  if (error) { toast('حدث خطأ: ' + error.message); return; }
  toast(editing ? 'تم تحديث الصف الرياضي' : 'تمت إضافة الصف الرياضي للجدول');
  state.editingClass = null;
  await loadLiveData();
  go('admin-classes');
}
window.saveClass = saveClass;

async function deleteClass(id){
  const { error } = await sb.from('classes').delete().eq('id', id);
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  toast('تم حذف الصف الرياضي من الجدول');
  await loadLiveData();
  render();
}
window.deleteClass = deleteClass;

// اقتراح رد مبدئي يعتمد على تصنيف التذكرة وموضوعها — نقطة بداية يعدّلها الموظف قبل الإرسال
function suggestTicketReply(t){
  const subj = (t.subject || '').trim();
  const byCategory = {
    'فني': `مرحباً، شكراً لإبلاغنا بخصوص "${subj}". قام فريقنا التقني بمراجعة المشكلة وسنعمل على حلها في أقرب وقت، وسنوافيك بأي تحديث.`,
    'إداري': `مرحباً، تم استلام طلبك الإداري بخصوص "${subj}" وسيتم التواصل معك ومتابعته من قبل الإدارة قريباً.`,
    'ملاحظات': `مرحباً، نشكرك على ملاحظتك بخصوص "${subj}"، تم توثيقها ورفعها للفريق المختص للاطلاع عليها.`,
    'اقتراحات': `مرحباً، شكراً لاقتراحك بخصوص "${subj}"! تم رفعه لفريق التطوير وسيتم دراسته ضمن التحديثات القادمة.`,
  };
  return byCategory[t.category] || `مرحباً، شكراً لتواصلك بخصوص "${subj}"، سنعمل على متابعة الأمر والرد عليك في أقرب وقت.`;
}

function openReplyTicketSheet(id){
  const t = DB.tickets.find(x=>x.id===id);
  if (!t) return;
  openSheet(`
    <h3>الرد على التذكرة</h3>
    <div class="muted">${t.subject} · ${t.category}</div>
    <div class="field"><label>نص الرد</label><textarea id="tk-reply-text">${suggestTicketReply(t)}</textarea></div>
    <button class="btn btn-primary" onclick="replyTicket('${id}')">${icon('check')} إرسال الرد</button>
  `);
}
window.openReplyTicketSheet = openReplyTicketSheet;

async function replyTicket(id){
  const replyText = document.getElementById('tk-reply-text').value.trim();
  if (!replyText) { toast('الرجاء كتابة نص الرد'); return; }
  const { error } = await sb.from('tickets').update({ status:'تم الرد', reply: replyText }).eq('id', id);
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  toast('تم إرسال الرد للعميل');
  closeSheet();
  await loadLiveData();
  render();
}
window.replyTicket = replyTicket;

// ---------------------------------------------------------
// Sparkline / bar chart helpers (SVG بدون مكتبات خارجية)
// ---------------------------------------------------------
function sparkline(values, {w=320,h=90,color='#22a866',fillId='sf1'}={}){
  const min = Math.min(...values), max = Math.max(...values);
  const pad = 8;
  const stepX = (w-pad*2)/(values.length-1);
  const scaleY = v => h-pad - ( (v-min)/((max-min)||1) )*(h-pad*2);
  const pts = values.map((v,i)=>[pad+i*stepX, scaleY(v)]);
  const path = pts.map((p,i)=> (i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const area = path + ` L${pts[pts.length-1][0]},${h-pad} L${pts[0][0]},${h-pad} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <defs><linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${fillId})"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${color}"/>`).join('')}
  </svg>`;
}

function barChart(values, labels, {w=320,h=110,color='#22a866'}={}){
  const max = Math.max(...values)*1.15;
  const barW = (w/values.length)*0.55;
  const gap = (w/values.length);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    ${values.map((v,i)=>{
      const bh = (v/max)*(h-24);
      const x = i*gap + (gap-barW)/2;
      const y = h-24-bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="5" fill="${color}"/>
      <text x="${(x+barW/2).toFixed(1)}" y="${h-6}" font-size="9" fill="#9db0aa" text-anchor="middle">${labels[i]}</text>`;
    }).join('')}
  </svg>`;
}

function donut(values, colors, {size=120,stroke=16}={}){
  const total = values.reduce((a,b)=>a+b,0);
  const r = (size-stroke)/2, c = 2*Math.PI*r;
  let offset = 0;
  const circles = values.map((v,i)=>{
    const len = (v/total)*c;
    const seg = `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${colors[i]}" stroke-width="${stroke}"
      stroke-dasharray="${len.toFixed(1)} ${(c-len).toFixed(1)}" stroke-dashoffset="${(-offset).toFixed(1)}" stroke-linecap="butt" transform="rotate(-90 ${size/2} ${size/2})"/>`;
    offset += len;
    return seg;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${circles}</svg>`;
}

function qrSvg(text, size=180){
  // زخرفة تمثيلية لرمز QR (وليست فك تشفير فعلي) — لغرض العرض في النموذج الأولي
  let seed = 0; for(const ch of text) seed = (seed*31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed*1103515245+12345) >>> 0; return (seed/4294967295); };
  const cells = 21; const cell = size/cells;
  let rects = '';
  for(let y=0;y<cells;y++){
    for(let x=0;x<cells;x++){
      const isFinder = (x<7&&y<7)||(x>cells-8&&y<7)||(x<7&&y>cells-8);
      if(isFinder) continue;
      if(rnd() > 0.58) rects += `<rect x="${x*cell}" y="${y*cell}" width="${cell}" height="${cell}" fill="#0b1210"/>`;
    }
  }
  const finder = (fx,fy) => `
    <rect x="${fx}" y="${fy}" width="${cell*7}" height="${cell*7}" fill="#0b1210"/>
    <rect x="${fx+cell}" y="${fy+cell}" width="${cell*5}" height="${cell*5}" fill="#fff"/>
    <rect x="${fx+cell*2}" y="${fy+cell*2}" width="${cell*3}" height="${cell*3}" fill="#0b1210"/>`;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="#fff"/>
    ${rects}
    ${finder(0,0)}
    ${finder((cells-7)*cell,0)}
    ${finder(0,(cells-7)*cell)}
  </svg>`;
}

// ---------------------------------------------------------
// Shell: status bar + bottom nav
// ---------------------------------------------------------
function statusBar(){
  return `<div class="statusbar">
    <span>9:41</span>
    <span style="display:flex;gap:5px;align-items:center;">
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none"><rect x="0" y="7" width="3" height="5" rx="0.5" fill="#0b1210"/><rect x="4.5" y="5" width="3" height="7" rx="0.5" fill="#0b1210"/><rect x="9" y="2.5" width="3" height="9.5" rx="0.5" fill="#0b1210"/><rect x="13" y="0" width="3" height="12" rx="0.5" fill="#0b1210"/></svg>
      <svg width="16" height="12" viewBox="0 0 24 18" fill="none"><path d="M12 15.5a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4Z" fill="#0b1210"/><path d="M6.5 10.8a7.7 7.7 0 0 1 11 0" stroke="#0b1210" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M3 7.3a12.6 12.6 0 0 1 18 0" stroke="#0b1210" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>
      <svg width="22" height="12" viewBox="0 0 24 12" fill="none"><rect x="0.5" y="0.5" width="20" height="11" rx="2.5" stroke="#0b1210"/><rect x="2" y="2" width="15" height="8" rx="1.3" fill="#0b1210"/><rect x="21.5" y="4" width="2" height="4" rx="1" fill="#0b1210"/></svg>
    </span>
  </div>`;
}

function navItem(route, activeRoutes, iconName, label){
  const active = activeRoutes.includes(state.route);
  return `<button class="navitem ${active?'active':''}" onclick="go('${route}')">
    ${icon(iconName)}<span>${label}</span>
  </button>`;
}

function bottomNav(){
  if(state.role==='client'){
    return `<div class="bottomnav">
      ${navItem('client-home', ['client-home'], 'home', 'الرئيسية')}
      ${navItem('client-booking', ['client-booking','client-booking-detail'], 'calendar', 'الحجوزات')}
      ${navItem('client-checkin', ['client-checkin'], 'qr', 'الدخول')}
      ${navItem('client-subscription', ['client-subscription','client-history'], 'wallet', 'عضويتي')}
      ${navItem('client-more', ['client-more','client-profile','client-inbody','client-programs','client-support','client-support-new','client-notifications'], 'more', 'المزيد')}
    </div>`;
  }
  if(state.role==='trainer'){
    return `<div class="bottomnav">
      ${navItem('trainer-home', ['trainer-home'], 'calendar', 'جدولي')}
      ${navItem('trainer-clients', ['trainer-clients'], 'users', 'عملائي')}
      ${navItem('trainer-ratings', ['trainer-ratings'], 'star', 'تقييماتي')}
      ${navItem('client-more', ['client-more'], 'more', 'المزيد')}
    </div>`;
  }
  if(state.role==='admin'){
    return `<div class="bottomnav">
      ${navItem('admin-dashboard', ['admin-dashboard'], 'home', 'الرئيسية')}
      ${navItem('admin-classes', ['admin-classes','admin-classes-new','admin-offers'], 'calendar', 'الكلاسات')}
      ${navItem('admin-reports', ['admin-reports'], 'chart', 'التقارير')}
      ${navItem('admin-support', ['admin-support'], 'support', 'الدعم')}
      ${navItem('admin-permissions', ['admin-permissions'], 'shield', 'الصلاحيات')}
    </div>`;
  }
  return '';
}

// شريط عائم لحساب "الأدمن التقني" فقط — يسمح بمعاينة التطبيق بأي دور دون تسجيل خروج
function superAdminBar(){
  if (!(state.authProfile && state.authProfile.is_super_admin)) return '';
  const roles = [ ['client','عميل'], ['trainer','مدرب'], ['admin','إدارة'] ];
  return `<div style="position:absolute; bottom:76px; left:12px; z-index:45; display:flex; flex-direction:column; gap:3px; background:rgba(15,20,30,.9); backdrop-filter:blur(10px); padding:4px; border-radius:12px; box-shadow:var(--shadow-md);">
    ${roles.map(([r,label])=>`<button onclick="setRole('${r}')" style="border:none; border-radius:9px; padding:6px 10px; font-size:10.5px; font-weight:800; cursor:pointer; background:${state.role===r?'#fff':'transparent'}; color:${state.role===r?'var(--brand-700)':'#fff'}; white-space:nowrap;">${label}</button>`).join('')}
  </div>`;
}

function topBar(title, sub, opts={}){
  return `<div class="topbar">
    <div><h1>${title}</h1>${sub?`<div class="sub">${sub}</div>`:''}</div>
    <div style="display:flex;gap:8px;">
      ${opts.notif!==false && state.role==='client' ? `<button class="icon-btn" onclick="go('client-notifications')">${icon('bell')}${DB.notifications.some(n=>!n.read)?'<span class="dot"></span>':''}</button>`:''}
      ${state.role!=='client' ? `<button class="icon-btn" onclick="logout()" title="تسجيل الخروج">${icon('logout')}</button>`:''}
    </div>
  </div>`;
}

function backBar(title, backRoute){
  return `<div class="back-row">
    <button class="back-btn" onclick="go('${backRoute}')">${icon('back')}</button>
    <h2>${title}</h2>
  </div>`;
}

// =========================================================
// شاشة تسجيل الدخول
// =========================================================
function screenLogin(){
  return `<div class="view no-pad" style="display:flex;flex-direction:column;min-height:100%;">
    <div style="background:var(--brand-900);padding:44px 24px 34px;color:#fff;border-radius:0 0 32px 32px;">
      <img src="${typeof LOGO_DATA_URI!=='undefined'?LOGO_DATA_URI:''}" alt="AOL GYM" style="height:56px;width:auto;display:block;margin-bottom:14px;" />
      <div style="font-size:12px;opacity:.85;">تطبيق صالة أكاديمية التعلم</div>
      <p style="margin:6px 0 0;font-size:13px;opacity:.85;line-height:1.8;">تطبيق صالة أكاديمية التعلم الرياضية — متاح مجاناً لجميع المتدربين والطاقم الإداري، للحجز والمتابعة الصحية والتدريبية.</p>
    </div>
    <div style="padding:22px 20px;flex:1;">
      <div class="tabs" style="margin-top:0;">
        <button class="tab ${state.authMode==='signin'?'active':''}" onclick="setAuthMode('signin')">تسجيل الدخول</button>
        <button class="tab ${state.authMode==='signup'?'active':''}" onclick="setAuthMode('signup')">إنشاء حساب جديد</button>
      </div>

      ${state.authMode==='signup' ? `<div class="field"><label>الاسم الكامل</label><input id="auth-name" placeholder="مثال: سارة العتيبي" /></div>` : ''}
      <div class="field">
        <label>البريد الإلكتروني</label>
        <input id="auth-email" type="email" placeholder="name@aol.edu.sa" />
        ${state.authMode==='signup' ? `<div class="sidebar-note" style="margin-top:4px;">التسجيل متاح فقط بالبريد الرسمي لأكاديمية التعلم (name@aol.edu.sa)</div>` : ''}
      </div>
      <div class="field"><label>كلمة المرور</label><input id="auth-password" type="password" placeholder="••••••••" /></div>
      ${state.authMode==='signin' ? `<div style="text-align:left;margin:-8px 0 12px;"><span style="font-size:12px;color:var(--brand-600);font-weight:700;cursor:pointer;" onclick="goForgotPassword()">نسيت كلمة المرور؟</span></div>` : ''}

      ${state.authMode==='signup' ? `<div class="sidebar-note" style="margin-top:-4px;">بعد إنشاء الحساب وتسجيل الدخول، سنطلب منك اختيار نوع حسابك وفرعك لإكمال ملفك الشخصي.</div>` : ''}

      ${state.authError ? `<div style="background:#fdecec;color:var(--danger);border-radius:12px;padding:10px 12px;font-size:12px;margin-bottom:12px;">${state.authError}</div>` : ''}

      ${state.authMode==='signin'
        ? `<button class="btn btn-primary" ${state.authBusy?'disabled':''} onclick="realSignIn()">${state.authBusy?'جاري الدخول...':'تسجيل الدخول'}</button>`
        : `<button class="btn btn-primary" ${state.authBusy?'disabled':''} onclick="realSignUp()">${state.authBusy?'جاري الإنشاء...':'إنشاء الحساب'}</button>`
      }
      <div class="sidebar-note" style="text-align:center;">حسابك هنا خاص بك ومحمي — بيانات الدخول تُحفظ بشكل آمن عبر Supabase.</div>

      ${state.authMode==='signin' && IS_DEMO_BUILD ? `
      <div class="section-title" style="margin-top:18px;"><h3>حسابات تجريبية سريعة</h3></div>
      ${DEMO_ACCOUNTS.map(a=>`<button class="btn btn-outline" style="margin-bottom:8px;" ${state.authBusy?'disabled':''} onclick="quickLogin('${a.email}','${a.password}')">${a.label}</button>`).join('')}
      <div class="sidebar-note" style="text-align:center;">تحتاجين تنشئي هذه الحسابات مرة واحدة فقط من تبويب "إنشاء حساب جديد"</div>
      ` : ''}
    </div>
  </div>`;
}

// =========================================================
// إكمال البيانات بعد أول تسجيل دخول (للمتدرب والطاقم الأكاديمي/الإداري: العمر، الوزن، الدبلوم)
// =========================================================
async function submitCompleteProfile(){
  if (state.cpNeedsCategory && !state.cpBranch) { toast('الرجاء اختيار الفرع'); return; }

  const update = {};
  if (state.cpNeedsCategory) {
    update.category = state.cpCategory;
    update.branch = state.cpBranch;
  }
  const ageEl = document.getElementById('cp-age');
  const weightEl = document.getElementById('cp-weight');
  const diplomaEl = document.getElementById('cp-diploma');
  const age = ageEl ? ageEl.value.trim() : '';
  const weight = weightEl ? weightEl.value.trim() : '';
  const diploma = diplomaEl ? diplomaEl.value.trim() : '';
  update.age = age ? Number(age) : null;
  update.weight = weight ? Number(weight) : null;
  update.diploma = diploma || null;

  state.authResetBusy = true; render();
  const { data, error } = await sb.from('profiles').update(update).eq('id', state.authUser.id).select().single();
  state.authResetBusy = false;

  if (error) { toast('حدث خطأ أثناء الحفظ: ' + error.message); render(); return; }
  state.authProfile = data;
  setRole((data && data.role) || 'client');
}
window.submitCompleteProfile = submitCompleteProfile;

function skipCompleteProfile(){
  setRole((state.authProfile && state.authProfile.role) || 'client');
}
window.skipCompleteProfile = skipCompleteProfile;

function screenCompleteProfile(){
  return `<div class="view no-pad" style="display:flex;flex-direction:column;min-height:100%;">
    <div style="background:var(--brand-900);padding:36px 24px 28px;color:#fff;border-radius:0 0 32px 32px;text-align:center;">
      <img src="${typeof LOGO_DATA_URI!=='undefined'?LOGO_DATA_URI:''}" alt="AOL GYM" style="height:40px;width:auto;display:block;margin:0 auto 12px;" />
      <h1 style="margin:0;font-size:18px;">${state.cpNeedsCategory ? 'أكملي حسابك' : 'آخر خطوة قبل البدء'}</h1>
      <p style="margin:6px 0 0;font-size:12.5px;opacity:.85;">${state.cpNeedsCategory ? 'اختاري نوع حسابك وفرعك للمتابعة' : 'أكملي بياناتك الصحية والدراسية لتخصيص برنامجك بشكل أفضل'}</p>
    </div>
    <div style="padding:22px 20px;flex:1;">
      ${state.cpNeedsCategory ? `
      <div class="field">
        <label>نوع الحساب</label>
        <div class="tabs" style="margin-top:0;">
          <button type="button" class="tab ${state.cpCategory==='trainee'?'active':''}" onclick="setCpCategory('trainee')">متدرب</button>
          <button type="button" class="tab ${state.cpCategory==='staff'?'active':''}" onclick="setCpCategory('staff')">طاقم أكاديمي / إداري</button>
        </div>
        <div class="sidebar-note" style="margin-top:4px;">المتدرب والطاقم الأكاديمي/الإداري يستفيدان من نفس خدمات الصالة (حجز، قياسات، برامج) — هذا التصنيف للتنظيم الإداري فقط</div>
      </div>
      <div class="field">
        <label>الفرع</label>
        <div class="tabs" style="margin-top:0;">
          ${BRANCHES.map(b=>`<button type="button" class="tab ${state.cpBranch===b?'active':''}" onclick="setCpBranch('${b}')">${b}</button>`).join('')}
        </div>
        <div class="sidebar-note" style="margin-top:4px;">يُحدَّد الفرع مرة واحدة. لتغييره لاحقاً يلزم رفع تذكرة دعم فني لتقوم الإدارة بتغييره.</div>
      </div>
      ` : ''}
      <div style="display:flex;gap:10px;">
        <div class="field" style="flex:1;"><label>العمر</label><input id="cp-age" type="number" min="1" max="120" placeholder="مثال: 27" /></div>
        <div class="field" style="flex:1;"><label>الوزن (كجم)</label><input id="cp-weight" type="number" min="1" max="400" step="0.1" placeholder="مثال: 70" /></div>
      </div>
      <div class="field">
        <label>الدبلوم / التخصص الدراسي</label>
        <select id="cp-diploma">
          <option value="">اختر الدبلوم...</option>
          ${DIPLOMAS.map(d=>`<option value="${d}">${d}</option>`).join('')}
        </select>
      </div>
      <button class="btn btn-primary" ${state.authResetBusy?'disabled':''} onclick="submitCompleteProfile()">${state.authResetBusy?'جاري الحفظ...':'متابعة'}</button>
      ${state.cpNeedsCategory ? '' : `<button class="btn btn-outline" style="margin-top:8px;" onclick="skipCompleteProfile()">تخطي الآن</button>`}
    </div>
  </div>`;
}

// =========================================================
// نسيت كلمة المرور / تعيين كلمة مرور جديدة
// =========================================================
function screenForgotPassword(){
  return `<div class="view no-pad" style="display:flex;flex-direction:column;min-height:100%;">
    ${backBar('نسيت كلمة المرور', 'login')}
    <div style="padding:6px 20px 22px;flex:1;">
      <p style="font-size:12.5px;color:var(--ink-500);line-height:1.8;margin-bottom:14px;">أدخلي بريدك الإلكتروني المسجّل، وسنرسل لك رابط إعادة تعيين كلمة المرور.</p>
      <div class="field"><label>البريد الإلكتروني</label><input id="reset-email" type="email" placeholder="name@aol.edu.sa" /></div>
      ${state.authResetError ? `<div style="background:#fdecec;color:var(--danger);border-radius:12px;padding:10px 12px;font-size:12px;margin-bottom:12px;">${state.authResetError}</div>` : ''}
      <button class="btn btn-primary" ${state.authResetBusy?'disabled':''} onclick="sendPasswordReset()">${state.authResetBusy?'جاري الإرسال...':'إرسال رابط إعادة التعيين'}</button>
    </div>
  </div>`;
}

function screenResetPassword(){
  return `<div class="view no-pad" style="display:flex;flex-direction:column;min-height:100%;">
    <div style="padding:30px 20px 6px;"><h2 style="margin:0;font-size:17px;">تعيين كلمة مرور جديدة</h2></div>
    <div style="padding:6px 20px 22px;flex:1;">
      <div class="field"><label>كلمة المرور الجديدة</label><input id="reset-new-password" type="password" placeholder="••••••••" /></div>
      <div class="field"><label>تأكيد كلمة المرور</label><input id="reset-new-password-confirm" type="password" placeholder="••••••••" /></div>
      ${state.authResetError ? `<div style="background:#fdecec;color:var(--danger);border-radius:12px;padding:10px 12px;font-size:12px;margin-bottom:12px;">${state.authResetError}</div>` : ''}
      <button class="btn btn-primary" ${state.authResetBusy?'disabled':''} onclick="updatePasswordAfterRecovery()">${state.authResetBusy?'جاري التحديث...':'تحديث كلمة المرور'}</button>
    </div>
  </div>`;
}

// =========================================================
// شاشات العميل
// =========================================================
function screenClientHome(){
  const u = DB.users.client;
  const upcoming = DB.bookings.filter(b=>b.status==='مؤكد');
  return `<div class="view">
    ${topBar('أهلاً، ' + u.name.split(' ')[0] + ' 👋', 'نتمنى لك تمريناً موفقاً اليوم')}

    <div class="hero-card">
      <div class="hero-top">
        <div>
          <div class="chip">${icon('bolt')} ${u.membership.track}</div>
          <div style="font-size:12px;margin-top:8px;opacity:.9;">عضوية دائمة ضمن الأكاديمية · بدون رسوم</div>
        </div>
        <div class="avatar">${u.initials}</div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><b>${lastInbody().weight}kg</b><span>الوزن الحالي</span></div>
        <div class="hero-stat"><b>${lastInbody().muscle}%</b><span>الكتلة العضلية</span></div>
        <div class="hero-stat"><b>${upcoming.length}</b><span>حجوزات قادمة</span></div>
      </div>
      <div style="margin-top:14px;"><button class="btn btn-light" onclick="go('client-checkin')">${icon('qr')} عرض رمز الدخول</button></div>
    </div>

    <div class="section-title"><h3>إجراءات سريعة</h3></div>
    <div class="stat-grid">
      <button class="stat-box" style="text-align:right;" onclick="go('client-booking')"><span class="list-icon" style="margin-bottom:8px;">${icon('calendar')}</span><div class="n" style="font-size:13px;">حجز كلاس</div></button>
      <button class="stat-box" style="text-align:right;" onclick="go('client-inbody')"><span class="list-icon" style="margin-bottom:8px;">${icon('chart')}</span><div class="n" style="font-size:13px;">قياساتي الصحية</div></button>
      <button class="stat-box" style="text-align:right;" onclick="go('client-programs')"><span class="list-icon" style="margin-bottom:8px;">${icon('dumbbell')}</span><div class="n" style="font-size:13px;">برامجي</div></button>
      <button class="stat-box" style="text-align:right;" onclick="go('client-support-new')"><span class="list-icon" style="margin-bottom:8px;">${icon('support')}</span><div class="n" style="font-size:13px;">الدعم الفني</div></button>
    </div>

    <div class="section-title"><h3>حجوزاتي القادمة</h3><span class="link" onclick="go('client-booking')">الكل</span></div>
    <div class="card">
      ${upcoming.map(b=>`
        <div class="list-row">
          <span class="list-icon">${icon('calendar')}</span>
          <span class="meta"><b>${b.title}</b><span>${b.date} · ${b.time} · ${b.trainer}</span></span>
          <span class="badge badge-green">${b.status}</span>
        </div>`).join('')}
    </div>

    <div class="section-title"><h3>عروض هذا الأسبوع</h3></div>
    <div class="hscroll">
      ${DB.offers.slice(0,3).map(o=>`
        <div class="class-card" style="min-width:200px;">
          <span class="tag">${icon('megaphone')} عرض</span>
          <h4>${o.title}</h4>
          <div class="info">${icon('users')} ${o.audience}</div>
        </div>`).join('')}
    </div>
  </div>`;
}

function screenClientBooking(){
  const days = DB.weekDays;
  const activeDay = state.params.day || days[0];
  const activeBranch = (state.authProfile && state.authProfile.branch) || BRANCHES[0];
  const list = DB.classes.filter(c=>c.day===activeDay && c.branch===activeBranch);
  const slots = DB.privateSlots.filter(s=>!s.isBooked && s.branch===activeBranch);
  return `<div class="view">
    ${topBar('الحجوزات', 'استكشف الكلاسات الجماعية والجلسات الخاصة')}
    <div class="card" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:10px 14px;">
      <span style="font-size:13px;"><b>${icon('location')} ${activeBranch}</b></span>
      <span class="link" style="font-size:12px;" onclick="requestBranchChange()">طلب تغيير الفرع</span>
    </div>
    <div style="font-size:11px;color:var(--ink-500);margin:-4px 0 10px;">${icon('shield')} الفرعان مخصصان للنساء حالياً</div>
    <div class="tabs">
      <button class="tab ${!state.params.tab||state.params.tab==='group'?'active':''}" onclick="go('client-booking',{tab:'group',day:'${activeDay}',branch:'${activeBranch}'})">كلاسات جماعية</button>
      <button class="tab ${state.params.tab==='private'?'active':''}" onclick="go('client-booking',{tab:'private',branch:'${activeBranch}'})">جلسات خاصة</button>
    </div>

    ${state.params.tab==='private' ? `
      <div class="section-title" style="margin-top:6px;"><h3>مواعيد متاحة</h3></div>
      ${slots.length===0 ? emptyState('لا توجد مواعيد خاصة متاحة حالياً في هذا الفرع') : slots.map(s=>`
        <div class="card" style="margin-bottom:10px;">
          <div class="list-row" style="border:none;padding:0;">
            <span class="list-icon">${icon('user')}</span>
            <span class="meta"><b>${s.type}</b><span>${s.trainer}</span></span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;">
            <span class="badge badge-blue">${icon('clock')} ${s.date} · ${s.time}</span>
            <button class="btn btn-primary btn-sm" ${state.bookingBusy?'disabled':''} onclick="bookPrivateSlot('${s.id}')">${state.bookingBusy?'جاري...':'احجز الآن'}</button>
          </div>
        </div>`).join('')}
    ` : `
      <div class="day-strip">
        ${days.map(d=>`<button class="day-pill ${d===activeDay?'active':''}" onclick="go('client-booking',{tab:'group',day:'${d}',branch:'${activeBranch}'})"><b>${d.slice(0,3)}</b><span>${DB.classes.filter(c=>c.day===d && c.branch===activeBranch).length} كلاس</span></button>`).join('')}
      </div>
      ${list.length===0 ? emptyState('لا توجد كلاسات مجدولة في هذا اليوم لهذا الفرع') : list.map(c=>{
        const booked = DB.bookings.some(b=>b.classId===c.id && b.status==='مؤكد');
        const full = c.booked>=c.capacity && !booked;
        return `<div class="card" style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <span class="tag" style="background:#e6f7ed;color:var(--brand-700);font-size:10px;font-weight:800;padding:3px 8px;border-radius:999px;">${c.type}</span>
              <h4 style="margin:8px 0 2px;font-size:15px;">${c.name}</h4>
              <div class="info">${icon('user')} ${c.trainer}</div>
              <div class="info">${icon('clock')} ${c.time} · ${c.duration}</div>
              <div class="info">${icon('location')} ${c.location}</div>
            </div>
            <span class="badge ${full?'badge-red':'badge-gray'}">${c.booked}/${c.capacity}</span>
          </div>
          <button class="btn ${booked?'btn-danger-ghost':full?'btn-outline':'btn-primary'}" style="margin-top:12px;" ${(full||state.bookingBusy)?'disabled':''} onclick="toggleBooking('${c.id}')">
            ${state.bookingBusy? 'جاري...' : booked? 'إلغاء الحجز' : full? 'مكتمل العدد' : 'احجز مكانك'}
          </button>
        </div>`;
      }).join('')}
    `}
  </div>`;
}

function emptyState(text){
  return `<div class="empty-state">${icon('calendar')}<p>${text}</p></div>`;
}

function screenClientProfile(){
  const u = DB.users.client;
  return `<div class="view">
    ${backBar('ملفي الشخصي','client-more')}
    <div class="card" style="text-align:center;">
      <div class="avatar" style="width:64px;height:64px;font-size:20px;background:var(--surface-sunken);color:var(--brand-700);border-color:var(--border);margin:0 auto 10px;">${u.initials}</div>
      <div style="font-weight:800;font-size:16px;">${u.name}</div>
      <div style="font-size:12px;color:var(--ink-500);margin-top:2px;">عضوة منذ مايو 2026</div>
      <div style="margin-top:10px;"><span class="badge badge-green">${u.membership.track}</span></div>
    </div>

    <div class="section-title"><h3>المعلومات الأساسية</h3><span class="link" onclick="openEditProfileSheet()">تعديل</span></div>
    <div class="card">
      <div class="list-row"><span class="list-icon">${icon('user')}</span><span class="meta"><b>الاسم الكامل</b><span>${u.name || '—'}</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('bell')}</span><span class="meta"><b>رقم الهاتف</b><span>${u.phone || '—'}</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('shield')}</span><span class="meta"><b>رقم الهوية</b><span>${u.nationalId || '—'}</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('file')}</span><span class="meta"><b>البريد الإلكتروني</b><span>${u.email || '—'}</span></span></div>
    </div>

    <div class="section-title"><h3>رمز الدخول السريع</h3></div>
    <div class="card" style="text-align:center;">
      <div class="qr-wrap">${qrSvg(u.qr,150)}</div>
      <div style="font-size:11px;color:var(--ink-500);margin-top:10px;">اعرض هذا الرمز عند الدخول أو الخروج من الصالة</div>
    </div>

    <div class="section-title"><h3>وصول سريع</h3></div>
    <div class="card">
      <div class="list-row" onclick="go('client-inbody')" style="cursor:pointer;"><span class="list-icon">${icon('chart')}</span><span class="meta"><b>القياسات الصحية (InBody)</b><span>آخر قياس: ${lastInbody().date}</span></span><span>${icon('chevron')}</span></div>
      <div class="list-row" onclick="go('client-programs')" style="cursor:pointer;"><span class="list-icon">${icon('dumbbell')}</span><span class="meta"><b>برامجي التدريبية والغذائية</b><span>${DB.programs.length} برامج نشطة</span></span><span>${icon('chevron')}</span></div>
    </div>
  </div>`;
}

function screenClientInbody(){
  if (!DB.inbody || !DB.inbody.length) {
    return `<div class="view">
      ${backBar('القياسات الصحية InBody','client-profile')}
      ${emptyState('لا توجد قياسات InBody مسجّلة لك بعد — احجزي موعد قياس مع مدربك ليظهر هنا')}
      <button class="btn btn-outline" style="margin-top:14px;" onclick="requestInbodyMeasurement()">${icon('plus')} حجز موعد قياس جديد</button>
    </div>`;
  }
  const last = DB.inbody.at(-1); const first = DB.inbody[0];
  const weightDelta = (last.weight-first.weight).toFixed(1);
  const fatDelta = (last.fat-first.fat).toFixed(1);
  const muscleDelta = (last.muscle-first.muscle).toFixed(1);
  return `<div class="view">
    ${backBar('القياسات الصحية InBody','client-profile')}
    <div class="stat-grid">
      <div class="stat-box"><div class="n">${last.weight} كجم</div><div class="l">الوزن الحالي</div><span class="delta ${weightDelta<0?'up':'down'}">${weightDelta} كجم منذ أول قياس</span></div>
      <div class="stat-box"><div class="n">${last.muscle}%</div><div class="l">الكتلة العضلية</div><span class="delta up">${muscleDelta}% تغيّر</span></div>
      <div class="stat-box"><div class="n">${last.fat}%</div><div class="l">نسبة الدهون</div><span class="delta up">${fatDelta}% تغيّر</span></div>
      <div class="stat-box"><div class="n">${DB.inbody.length}</div><div class="l">قياسات مسجّلة</div><span class="delta" style="color:var(--ink-500);">آخرها ${last.date}</span></div>
    </div>

    <div class="section-title"><h3>تطور الوزن (كجم)</h3></div>
    <div class="card">${sparkline(DB.inbody.map(d=>d.weight),{color:'#22a866',fillId:'w1'})}</div>

    <div class="section-title"><h3>تطور الكتلة العضلية مقابل الدهون</h3></div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:14px;font-size:11px;margin-bottom:8px;">
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:9px;height:9px;border-radius:50%;background:#22a866;display:inline-block;"></span> عضلات</span>
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:9px;height:9px;border-radius:50%;background:#ff8a3d;display:inline-block;"></span> دهون</span>
      </div>
      ${sparkline(DB.inbody.map(d=>d.muscle),{color:'#22a866',fillId:'m1'})}
      <div style="margin-top:-14px;">${sparkline(DB.inbody.map(d=>d.fat),{color:'#ff8a3d',fillId:'f1'})}</div>
    </div>

    <div class="section-title"><h3>سجل القياسات</h3></div>
    <div class="card">
      <table class="mini-table">
        <tr><th>التاريخ</th><th>الوزن</th><th>عضلات</th><th>دهون</th></tr>
        ${DB.inbody.slice().reverse().map(d=>`<tr><td>${d.date}</td><td>${d.weight}kg</td><td>${d.muscle}%</td><td>${d.fat}%</td></tr>`).join('')}
      </table>
    </div>
    <button class="btn btn-outline" style="margin-top:14px;" onclick="requestInbodyMeasurement()">${icon('plus')} حجز موعد قياس جديد</button>
  </div>`;
}

function screenClientPrograms(){
  return `<div class="view">
    ${backBar('برامجي التدريبية والغذائية','client-profile')}
    ${!DB.programs.length ? emptyState('لا توجد برامج تدريبية أو غذائية مخصّصة لك بعد') : ''}
    ${DB.programs.map(p=>`
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <span class="badge ${p.type==='تدريبي'?'badge-green':'badge-orange'}">${p.type}</span>
            <h4 style="margin:8px 0 2px;font-size:14.5px;">${p.title}</h4>
            <div class="info" style="font-size:11.5px;color:var(--ink-500);">${icon('user')} ${p.trainer} · ${p.date}</div>
          </div>
        </div>
        <p style="font-size:12.5px;color:var(--ink-700);line-height:1.8;margin:10px 0 0;">${p.notes}</p>
      </div>`).join('')}

    <div class="section-title"><h3>أرشيف توصيات المدربين</h3></div>
    <div class="card">
      ${DB.trainerNotes.map(n=>`
        <div class="list-row" style="align-items:flex-start;">
          <span class="notice-dot" style="margin-top:6px;"></span>
          <span class="meta">
            <b style="font-size:12.5px;">${n.trainer} <span style="color:var(--ink-300);font-weight:500;"> · ${n.date}</span></b>
            <span style="display:block;margin-top:4px;line-height:1.7;color:var(--ink-700);">${n.note}</span>
          </span>
        </div>`).join('')}
    </div>
  </div>`;
}

function screenClientSubscription(){
  const u = DB.users.client;
  return `<div class="view">
    ${topBar('عضويتي', 'عضوية مجانية ضمن أكاديمية التعلم')}
    <div class="hero-card">
      <div class="hero-top">
        <div><div style="font-size:13px;opacity:.85;">مسارك التدريبي</div><div style="font-size:19px;font-weight:800;margin-top:2px;">${u.membership.track}</div></div>
        <span class="chip">${icon('check')} فعّال</span>
      </div>
      <div style="margin-top:14px;background:rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;font-size:12px;line-height:1.8;">
        ${icon('shield')} ${u.membership.note}
      </div>
      <div style="margin-top:10px;font-size:11.5px;opacity:.85;">عضو منذ ${u.membership.joined} · التطبيق متاح مجاناً لجميع متدربي وطاقم الأكاديمية</div>
    </div>

    <div class="section-title"><h3>مزايا عضويتك</h3></div>
    <div class="card">
      ${u.membership.perks.map(p=>`<div class="list-row"><span class="list-icon">${icon('check')}</span><span class="meta">${p}</span></div>`).join('')}
    </div>

    <div class="section-title" id="tracks-sec"><h3>المسارات التدريبية في الأكاديمية</h3></div>
    ${DB.tracks.map(t=>`
      <div class="card" style="margin-bottom:10px; ${t.highlight?'border-color:var(--brand-500);box-shadow:0 0 0 2px rgba(34,168,102,.15);':''}">
        <div style="font-weight:800;font-size:15px;">${t.name} ${t.id===DB.tracks.find(x=>x.name===u.membership.track)?.id || t.name===u.membership.track ?'<span class="badge badge-green" style="margin-right:6px;">مسارك الحالي</span>':''}</div>
        <div style="margin-top:10px;">
          ${t.features.map(f=>`<div style="font-size:12px;color:var(--ink-700);display:flex;align-items:center;gap:6px;margin-top:5px;">${icon('check')} ${f}</div>`).join('')}
        </div>
        ${t.name!==u.membership.track ? `<button class="btn btn-outline" style="margin-top:12px;" onclick="joinTrack('${t.id}')">طلب التحويل لهذا المسار</button>` : ''}
      </div>`).join('')}

    <div class="section-title"><h3>سجل الحضور والإنجاز</h3><span class="link" onclick="go('client-history')">عرض الكل</span></div>
    <div class="card">
      <div class="list-row"><span class="list-icon">${icon('check')}</span><span class="meta"><b>تم إكمال 18 جلسة تدريبية</b><span>خلال آخر 30 يوم</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('chart')}</span><span class="meta"><b>قياس InBody جديد مسجّل</b><span>2026-08-01</span></span></div>
    </div>
  </div>`;
}

function screenClientHistory(){
  return `<div class="view">
    ${backBar('سجل الحضور والإنجاز','client-subscription')}
    ${!DB.bookings.length ? emptyState('لا يوجد سجل حجوزات بعد') : `<div class="card">
      ${DB.bookings.map(b=>`
        <div class="list-row"><span class="list-icon">${icon(b.status==='ملغي'?'x':'check')}</span><span class="meta"><b>${b.title}</b><span>${b.date} · ${b.time} · ${b.trainer}</span></span>
        <span class="badge ${b.status==='مؤكد'?'badge-green':b.status==='منتهي'?'badge-gray':'badge-red'}">${b.status}</span></div>`).join('')}
    </div>`}
  </div>`;
}

function screenClientSupport(){
  return `<div class="view">
    ${backBar('الدعم الفني والشكاوى','client-more')}
    <button class="btn btn-primary" onclick="go('client-support-new')">${icon('plus')} فتح طلب دعم جديد</button>
    <div class="section-title"><h3>طلباتي</h3></div>
    ${!DB.tickets.length ? emptyState('لا توجد طلبات دعم سابقة') : ''}
    ${DB.tickets.map(t=>`
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <span class="badge badge-gray">${t.category}</span>
            <div style="font-weight:700;font-size:13.5px;margin-top:6px;">${t.subject}</div>
            <div style="font-size:11px;color:var(--ink-500);margin-top:2px;">${t.id} · ${t.date}</div>
          </div>
          <span class="badge ${t.status==='تم الرد'?'badge-green':t.status==='مغلقة'?'badge-gray':'badge-orange'}">${t.status}</span>
        </div>
        ${t.reply?`<div style="background:var(--surface-sunken);border-radius:12px;padding:10px 12px;margin-top:10px;font-size:12px;line-height:1.7;color:var(--ink-700);">${icon('support')} ${t.reply}</div>`:''}
      </div>`).join('')}
  </div>`;
}

function screenClientSupportNew(){
  const cats = ['فني','إداري','ملاحظات','اقتراحات'];
  return `<div class="view">
    ${backBar('طلب دعم جديد','client-support')}
    <div class="field"><label>نوع الطلب</label>
      <div class="seg">${cats.map(c=>`<button class="seg-opt ${state.ticketDraft.category===c?'active':''}" onclick="setTicketCategory('${c}')">${c}</button>`).join('')}</div>
    </div>
    <div class="field"><label>عنوان الطلب</label><input id="tk-subject" placeholder="مثال: مشكلة في تسجيل الحضور" value="${state.ticketDraft.subject||''}" /></div>
    <div class="field"><label>تفاصيل الطلب</label><textarea id="tk-message" placeholder="اكتب وصفاً تفصيلياً...">${state.ticketDraft.message||''}</textarea></div>
    <button class="btn btn-primary" onclick="submitTicket()">${icon('check')} إرسال الطلب</button>
  </div>`;
}

function screenClientNotifications(){
  return `<div class="view">
    ${backBar('الإشعارات','client-more')}
    <div style="text-align:left;margin-bottom:6px;"><span class="link" style="cursor:pointer;" onclick="markAllRead()">تعليم الكل كمقروء</span></div>
    ${!DB.notifications.length ? emptyState('لا توجد إشعارات حالياً') : `<div class="card">
      ${DB.notifications.map(n=>`
        <div class="list-row">
          <span class="list-icon">${icon(n.type==='booking'?'calendar':n.type==='billing'?'wallet':n.type==='offer'?'megaphone':'support')}</span>
          <span class="meta"><b>${n.title} ${!n.read?'<span class=\"notice-dot\" style=\"display:inline-block;margin-right:5px;\"></span>':''}</b><span>${n.body}</span></span>
          <span style="font-size:10px;color:var(--ink-300);white-space:nowrap;">${n.time}</span>
        </div>`).join('')}
    </div>`}
  </div>`;
}

function screenClientCheckin(){
  const u = DB.users.client;
  return `<div class="view" style="text-align:center;">
    ${topBar('الدخول والخروج', 'اعرض الرمز عند البوابة لتسجيل الحضور')}
    <div class="card" style="padding:26px;">
      <div class="qr-wrap" style="margin:0 auto;width:fit-content;">${qrSvg(u.qr,190)}</div>
      <div style="margin-top:14px;font-weight:800;">${u.name}</div>
      <div style="font-size:12px;color:var(--ink-500);">${u.membership.track} · ${icon('check')} عضوية فعّالة</div>
    </div>
    <button class="btn btn-primary" style="margin-top:16px;" onclick="simulateScan()">${icon('scan')} محاكاة مسح الرمز (للتجربة)</button>
    <div class="section-title" style="text-align:right;"><h3>آخر مرات الحضور</h3></div>
    <div class="card">
      <div class="list-row"><span class="list-icon">${icon('check')}</span><span class="meta"><b>دخول</b><span>اليوم · 06:52 ص</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('check')}</span><span class="meta"><b>خروج</b><span>أمس · 08:40 ص</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('check')}</span><span class="meta"><b>دخول</b><span>أمس · 07:15 ص</span></span></div>
    </div>
  </div>`;
}

function screenClientMore(){
  const u = DB.users.client;
  const items = [
    { icon:'user', label:'ملفي الشخصي', route:'client-profile' },
    { icon:'chart', label:'القياسات الصحية InBody', route:'client-inbody' },
    { icon:'dumbbell', label:'برامجي التدريبية والغذائية', route:'client-programs' },
    { icon:'bell', label:'الإشعارات', route:'client-notifications' },
    { icon:'support', label:'الدعم الفني والشكاوى', route:'client-support' },
    { icon:'file', label:'سجل الحضور والإنجاز', route:'client-history' },
  ];
  return `<div class="view">
    ${topBar('المزيد', u.name)}
    <div class="card">
      ${items.map(i=>`<div class="list-row" style="cursor:pointer;" onclick="go('${i.route}')"><span class="list-icon">${icon(i.icon)}</span><span class="meta"><b>${i.label}</b></span><span>${icon('chevron')}</span></div>`).join('')}
    </div>
    <button class="btn btn-danger-ghost" style="margin-top:16px;" onclick="logout()">${icon('logout')} تسجيل الخروج</button>
  </div>`;
}

// =========================================================
// شاشات المدرب
// =========================================================
function screenTrainerHome(){
  const t = DB.users.trainer;
  const mySessions = DB.classes.filter(c=>c.trainer.includes('المطيري')||c.trainer==='—').slice(0,4);
  return `<div class="view">
    ${topBar('جدول اليوم', t.name)}
    <div class="hero-card">
      <div class="hero-top">
        <div><div style="font-size:13px;opacity:.85;">${t.specialty}</div><div style="font-size:18px;font-weight:800;margin-top:2px;">4 جلسات اليوم</div></div>
        <div class="avatar">${t.initials}</div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat"><b>28</b><span>عميل نشط</span></div>
        <div class="hero-stat"><b>4.9</b><span>متوسط التقييم</span></div>
        <div class="hero-stat"><b>203</b><span>تقييم</span></div>
      </div>
    </div>
    <div class="section-title"><h3>الجلسات الخاصة اليوم</h3></div>
    <div class="card">
      ${DB.privateSlots.map(s=>`<div class="list-row"><span class="list-icon">${icon('user')}</span><span class="meta"><b>${s.type}</b><span>${s.date} · ${s.time}</span></span><span class="badge ${s.isBooked?'badge-green':'badge-gray'}">${s.isBooked?'محجوز':'متاح'}</span></div>`).join('')}
    </div>
    <div class="section-title"><h3>كلاساتي الجماعية هذا الأسبوع</h3></div>
    <div class="card">
      ${DB.classes.filter(c=>c.trainer.includes('نورة')||c.trainer.includes('عبدالله')).map(c=>`
        <div class="list-row"><span class="list-icon">${icon('calendar')}</span><span class="meta"><b>${c.name}</b><span>${c.day} · ${c.time}</span></span><span class="badge badge-blue">${c.booked}/${c.capacity}</span></div>`).join('')}
    </div>
  </div>`;
}

function screenTrainerClients(){
  const rows = DB.realClients || [];
  return `<div class="view">
    ${topBar('متدربيّ', rows.length + ' متدرب مسجّل')}
    ${!rows.length ? emptyState('لا يوجد متدربون مسجّلون بعد') : ''}
    ${rows.map(r=>`
      <div class="card" style="margin-bottom:10px;">
        <div class="list-row" style="border:none;padding:0;">
          <span class="trainer-avatar" style="width:40px;height:40px;">${(r.full_name||'—').split(' ').map(w=>w[0]).slice(0,2).join('')}</span>
          <span class="meta"><b>${r.full_name || '—'}</b><span>${r.branch || '—'}${r.phone ? ' · ' + r.phone : ''}</span></span>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn btn-outline btn-sm" style="flex:1;" onclick="openAddInbodySheet('${r.id}','${(r.full_name||'').replace(/'/g,'')}')">${icon('chart')} قياس InBody</button>
          <button class="btn btn-outline btn-sm" style="flex:1;" onclick="openAddProgramSheet('${r.id}','${(r.full_name||'').replace(/'/g,'')}')">${icon('edit')} برنامج / ملاحظة</button>
        </div>
      </div>`).join('')}
  </div>`;
}

function screenTrainerRatings(){
  const me = DB.trainerRatings.find(r=>r.trainer==='عبدالله المطيري') || { avg:'—', count:0 };
  return `<div class="view">
    ${topBar('تقييماتي', 'آراء العملاء حول جلساتك')}
    <div class="card" style="text-align:center;">
      <div style="font-size:38px;font-weight:800;color:var(--brand-700);">${me.avg}</div>
      <div class="rating">${[1,2,3,4,5].map(i=>`<span>${icon('star')}</span>`).join('')}</div>
      <div style="font-size:12px;color:var(--ink-500);">بناءً على ${me.count} تقييم</div>
    </div>
    <div class="section-title"><h3>آخر التعليقات</h3></div>
    <div class="card">
      <div class="list-row"><span class="list-icon">${icon('star')}</span><span class="meta"><b>سارة العتيبي</b><span>"أفضل مدرب تعاملت معه، شرح واضح ومتابعة ممتازة"</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('star')}</span><span class="meta"><b>خالد العمري</b><span>"برنامج تدريبي فعّال ونتائج ملموسة خلال شهر"</span></span></div>
    </div>
  </div>`;
}

// =========================================================
// شاشات الإدارة
// =========================================================
function screenAdminDashboard(){
  const a = DB.users.admin; const s = DB.weeklyStats;
  return `<div class="view">
    ${topBar('لوحة التحكم', a.name + ' · ' + a.title)}
    <div class="stat-grid">
      <div class="stat-box"><div class="n">${s.visits.toLocaleString('ar')}</div><div class="l">زيارات هذا الأسبوع</div><span class="delta up">▲ 8.2%</span></div>
      <div class="stat-box"><div class="n">${s.bookings}</div><div class="l">إجمالي الحجوزات</div><span class="delta up">▲ 5%</span></div>
      <div class="stat-box"><div class="n">${s.newMembers}</div><div class="l">متدربون جدد</div><span class="delta up">▲ 12%</span></div>
      <div class="stat-box"><div class="n">${s.completedSessions}</div><div class="l">جلسات مكتملة</div><span class="delta up">▲ 4.5%</span></div>
    </div>

    <div class="section-title"><h3>نسبة الحضور الأسبوعية</h3></div>
    <div class="card">${barChart(DB.attendanceTrend, ['سبت','أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة'])}</div>

    <div class="section-title"><h3>وصول سريع</h3></div>
    <div class="stat-grid">
      <button class="stat-box" style="text-align:right;" onclick="go('admin-classes')"><span class="list-icon" style="margin-bottom:8px;">${icon('calendar')}</span><div class="n" style="font-size:13px;">إدارة الكلاسات</div></button>
      <button class="stat-box" style="text-align:right;" onclick="go('admin-offers')"><span class="list-icon" style="margin-bottom:8px;">${icon('megaphone')}</span><div class="n" style="font-size:13px;">العروض والإشعارات</div></button>
      <button class="stat-box" style="text-align:right;" onclick="go('admin-checkin')"><span class="list-icon" style="margin-bottom:8px;">${icon('qr')}</span><div class="n" style="font-size:13px;">سجل الحضور</div></button>
      <button class="stat-box" style="text-align:right;" onclick="go('admin-support')"><span class="list-icon" style="margin-bottom:8px;">${icon('support')}</span><div class="n" style="font-size:13px;">تذاكر الدعم</div></button>
    </div>

    <div class="section-title"><h3>تنبيهات إدارية</h3></div>
    <div class="card">
      <div class="list-row"><span class="list-icon" style="color:var(--danger);">${icon('bell')}</span><span class="meta"><b>كلاس "زومبا حماسية" مكتمل العدد</b><span>يُنصح بإضافة موعد إضافي هذا الأسبوع</span></span></div>
      <div class="list-row"><span class="list-icon" style="color:var(--warning);">${icon('support')}</span><span class="meta"><b>3 تذاكر دعم قيد الانتظار</b><span>آخر تذكرة منذ ساعتين</span></span></div>
    </div>
  </div>`;
}

state.adminClassBranchFilter = 'الكل';
function setAdminClassBranchFilter(b){
  state.adminClassBranchFilter = b;
  render();
}
window.setAdminClassBranchFilter = setAdminClassBranchFilter;

function screenAdminClasses(){
  const filter = state.adminClassBranchFilter || 'الكل';
  const filtered = filter === 'الكل' ? DB.classes : DB.classes.filter(c=>c.branch===filter);
  return `<div class="view">
    ${topBar('إدارة الصفوف الرياضية', filtered.length + ' صف رياضي مجدول' + (filter==='الكل' ? '' : ' · ' + filter))}
    <button class="btn btn-primary" onclick="openNewClass()">${icon('plus')} إضافة صف رياضي جديد</button>
    <div class="tabs">
      <button class="tab ${filter==='الكل'?'active':''}" onclick="setAdminClassBranchFilter('الكل')">الكل (${DB.classes.length})</button>
      ${BRANCHES.map(b=>`<button class="tab ${filter===b?'active':''}" onclick="setAdminClassBranchFilter('${b}')">${b} (${DB.classes.filter(c=>c.branch===b).length})</button>`).join('')}
    </div>
    <div class="section-title"><h3>الجدول الأسبوعي</h3><span class="link" onclick="go('admin-offers')">العروض ←</span></div>
    ${filtered.length ? filtered.map(c=>`
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <span class="badge badge-gray">${c.day}</span>
            <span class="badge badge-blue">${c.branch}</span>
            <h4 style="margin:8px 0 2px;font-size:14.5px;">${c.name}</h4>
            <div class="info">${icon('user')} ${c.trainer||'—'} · ${icon('clock')} ${c.time}</div>
          </div>
          <span class="badge ${c.booked>=c.capacity?'badge-red':'badge-green'}">${c.booked}/${c.capacity}</span>
        </div>
        <div class="btn-row" style="margin-top:10px;">
          <button class="btn btn-outline btn-sm" onclick="openEditClass('${c.id}')">${icon('edit')} تعديل</button>
          <button class="btn btn-danger-ghost btn-sm" onclick="deleteClass('${c.id}')">${icon('x')} إلغاء</button>
        </div>
      </div>`).join('') : emptyState('لا توجد صفوف رياضية مجدولة بهذا الفرع')}
  </div>`;
}

function parseTimeToHHMM(arTime){
  if (!arTime) return '';
  const m = arTime.match(/(\d{1,2}):(\d{2})\s*(ص|م)?/);
  if (!m) return '';
  let h = Number(m[1]); const min = m[2]; const period = m[3];
  if (period === 'م' && h < 12) h += 12;
  if (period === 'ص' && h === 12) h = 0;
  return `${String(h).padStart(2,'0')}:${min}`;
}

function screenAdminClassesNew(){
  const editing = state.editingClass;
  const trainers = (DB.trainers && DB.trainers.length) ? DB.trainers : (editing && editing.trainer ? [editing.trainer] : []);
  return `<div class="view">
    ${backBar(editing ? 'تعديل الصف الرياضي' : 'إضافة صف رياضي جديد','admin-classes')}
    <div class="field"><label>اسم الصف الرياضي</label><input id="cls-name" placeholder="مثال: يوغا مسائية" value="${editing?editing.name:''}" /></div>
    <div class="field"><label>الفرع</label><select id="cls-branch">${BRANCHES.map(b=>`<option ${editing&&editing.branch===b?'selected':''}>${b}</option>`).join('')}</select></div>
    <div class="field"><label>اليوم</label><select id="cls-day">${DB.weekDays.map(d=>`<option ${editing&&editing.day===d?'selected':''}>${d}</option>`).join('')}</select></div>
    <div class="field"><label>الوقت</label><input type="time" id="cls-time" min="08:00" max="20:00" value="${editing?parseTimeToHHMM(editing.time):''}" /><div class="muted" style="margin-top:4px;">أوقات العمل الرسمية: 8:00 ص — 8:00 م</div></div>
    <div class="field"><label>المدرب</label>
      <select id="cls-trainer">
        ${trainers.length ? trainers.map(t=>`<option ${editing&&editing.trainer===t?'selected':''}>${t}</option>`).join('') : '<option value="">لا يوجد مدربون مسجّلون بعد</option>'}
      </select>
    </div>
    <div class="field"><label>السعة القصوى</label><input type="number" id="cls-capacity" placeholder="16" value="${editing?editing.capacity:16}" /></div>
    <button class="btn btn-primary" onclick="saveClass()">${icon('check')} ${editing ? 'حفظ التعديلات' : 'حفظ ونشر الصف الرياضي'}</button>
  </div>`;
}

function screenAdminOffers(){
  return `<div class="view">
    ${backBar('العروض والإشعارات','admin-classes')}
    <div class="card">
      <div class="field" style="margin-bottom:8px;"><label>عنوان العرض / الإشعار</label><input id="offer-title" placeholder="مثال: خصم نهاية الأسبوع 15%" /></div>
      <div class="field"><label>الفئة المستهدفة</label>
        <div class="seg"><button class="seg-opt active">جميع المتدربين</button><button class="seg-opt">مسار اللياقة والتأهيل</button><button class="seg-opt">متدربون جدد</button></div>
      </div>
      <button class="btn btn-accent" onclick="addOffer()">${icon('megaphone')} إرسال الإشعار الآن</button>
    </div>
    <div class="section-title"><h3>العروض المرسلة</h3></div>
    ${DB.offers.length ? DB.offers.map(o=>`
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div><b style="font-size:13.5px;">${o.title}</b><div style="font-size:11px;color:var(--ink-500);margin-top:2px;">${o.audience} · ${o.sent}</div></div>
          <span class="badge ${o.status==='مفعّل'?'badge-green':'badge-gray'}">${o.status}</span>
        </div>
        <div style="font-size:11px;color:var(--ink-500);margin-top:8px;">${icon('users')} وصل إلى ${o.reach} عضو</div>
      </div>`).join('') : emptyState('لا توجد عروض مُرسلة بعد')}

    <div class="section-title"><h3>تقييمات المدربين</h3></div>
    <div class="card">
      ${DB.trainerRatings.length ? DB.trainerRatings.map(r=>`<div class="list-row"><span class="list-icon">${icon('star')}</span><span class="meta"><b>${r.trainer}</b><span>${r.count} تقييم</span></span><b>${r.avg}</b></div>`).join('') : emptyState('لا توجد تقييمات بعد')}
    </div>
  </div>`;
}

function screenAdminReports(){
  const su = DB.serviceUsage;
  const colors = ['#22a866','#3ecb82','#7ee6ab','#ff8a3d','#c7d4cf'];
  return `<div class="view">
    ${topBar('التقارير والإحصائيات', 'تقارير أسبوعية وشهرية قابلة للتصدير')}
    <div class="btn-row">
      <button class="btn btn-outline" onclick="toast('جاري تجهيز ملف PDF للتحميل...')">${icon('download')} تصدير PDF</button>
      <button class="btn btn-outline" onclick="toast('جاري تجهيز ملف Excel للتحميل...')">${icon('download')} تصدير Excel</button>
    </div>

    <div class="section-title"><h3>معدل الحضور الأسبوعي</h3></div>
    <div class="card">${barChart(DB.attendanceTrend, ['سبت','أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة'])}
      <div style="text-align:center;font-size:12px;color:var(--ink-500);margin-top:4px;">متوسط الحضور: ${DB.weeklyStats.attendanceRate}%</div>
    </div>

    <div class="section-title"><h3>توزيع استخدام الخدمات</h3></div>
    <div class="card" style="display:flex;align-items:center;gap:16px;">
      ${donut(su.map(s=>s.value), colors)}
      <div style="flex:1;">
        ${su.map((s,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;font-size:11.5px;margin-bottom:6px;">
          <span style="display:flex;align-items:center;gap:6px;"><span style="width:9px;height:9px;border-radius:50%;background:${colors[i]};display:inline-block;"></span>${s.name}</span>
          <b>${s.value}%</b></div>`).join('')}
      </div>
    </div>

    <div class="section-title"><h3>ملخص الالتزام الشهري للمتدربين</h3></div>
    <div class="card">
      ${emptyState('لا تتوفر بيانات كافية بعد لعرض ملخص شهري')}
    </div>

    <div class="section-title"><h3>أرشيف التقارير الصحية للأعضاء</h3></div>
    <div class="card">
      ${emptyState('لا توجد تقارير مؤرشفة بعد')}
    </div>
  </div>`;
}

function screenAdminCheckin(){
  const checkins = DB.attendanceLog.filter(a=>a.type==='دخول').length;
  const checkouts = DB.attendanceLog.filter(a=>a.type==='خروج').length;
  return `<div class="view">
    ${topBar('سجل الحضور اليومي', new Date().toLocaleDateString('ar-SA',{weekday:'long', day:'numeric', month:'long'}))}
    <div class="stat-grid">
      <div class="stat-box"><div class="n">${checkins}</div><div class="l">دخول</div></div>
      <div class="stat-box"><div class="n">${Math.max(checkins - checkouts, 0)}</div><div class="l">داخل الصالة الآن</div></div>
    </div>
    <div class="section-title"><h3>آخر عمليات الدخول/الخروج</h3></div>
    <div class="card">
      ${DB.attendanceLog.length ? DB.attendanceLog.map(a=>`
        <div class="list-row"><span class="list-icon" style="color:${a.type==='دخول'?'var(--brand-600)':'var(--ink-500)'};">${icon('scan')}</span>
        <span class="meta"><b>${a.name}</b><span>${a.method} · ${a.type}</span></span><span style="font-size:11px;color:var(--ink-500);">${a.time}</span></div>`).join('') : emptyState('لا توجد عمليات دخول/خروج بعد')}
    </div>
  </div>`;
}

state.adminTicketFilter = 'الكل';
function setAdminTicketFilter(cat){
  state.adminTicketFilter = cat;
  render();
}
window.setAdminTicketFilter = setAdminTicketFilter;

function screenAdminSupport(){
  const filter = state.adminTicketFilter || 'الكل';
  const cats = ['الكل','فني','إداري','ملاحظات','اقتراحات'];
  const filtered = filter === 'الكل' ? DB.tickets : DB.tickets.filter(t=>t.category===filter);
  return `<div class="view">
    ${topBar('تذاكر الدعم الفني', DB.tickets.filter(t=>t.status!=='مغلقة').length + ' تذكرة نشطة')}
    <div class="tabs">
      ${cats.map(c=>`<button class="tab ${filter===c?'active':''}" onclick="setAdminTicketFilter('${c}')">${c}</button>`).join('')}
    </div>
    ${filtered.length ? filtered.map(t=>`
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div><span class="badge badge-gray">${t.category}</span><div style="font-weight:700;font-size:13.5px;margin-top:6px;">${t.subject}</div><div style="font-size:11px;color:var(--ink-500);margin-top:2px;">${t.id} · ${t.date}</div></div>
          <span class="badge ${t.status==='تم الرد'?'badge-green':t.status==='مغلقة'?'badge-gray':'badge-orange'}">${t.status}</span>
        </div>
        ${t.reply?`<div style="background:var(--surface-sunken);border-radius:12px;padding:10px 12px;margin-top:10px;font-size:12px;line-height:1.7;">${t.reply}</div>`:`
        <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="openReplyTicketSheet('${t.id}')">${icon('edit')} كتابة رد</button>`}
      </div>`).join('') : emptyState('لا توجد تذاكر في هذا التصنيف')}
  </div>`;
}

function screenAdminPermissions(){
  const a = DB.users.admin;
  return `<div class="view">
    ${topBar('الصلاحيات والفريق', 'إدارة صلاحيات الوصول لكل مستخدم')}
    <div class="card" style="display:flex;align-items:center;gap:12px;">
      <span class="trainer-avatar" style="width:44px;height:44px;font-size:14px;">${a.initials}</span>
      <span class="meta"><b style="display:block;font-size:14px;">${a.name}</b><span style="font-size:12px;color:var(--ink-500);">${a.title}</span></span>
      <button class="btn btn-danger-ghost btn-sm" onclick="logout()">${icon('logout')} خروج</button>
    </div>
    <div class="section-title"><h3>الأدوار الأساسية</h3></div>
    ${DB.roles.length ? DB.roles.map(r=>`
      <div class="card" style="margin-bottom:10px;">
        <b style="font-size:13.5px;">${r.role}</b>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
          ${r.perms.map(p=>`<span class="badge badge-gray">${p}</span>`).join('')}
        </div>
      </div>`).join('') : emptyState('لا توجد أدوار معرّفة بعد')}

    <div class="section-title"><h3>أعضاء الفريق</h3></div>
    <div class="card">
      ${DB.staff.length ? DB.staff.map(s=>`
        <div class="list-row"><span class="trainer-avatar">${s.name.split(' ').map(w=>w[0]).slice(0,2).join('')}</span>
        <span class="meta"><b>${s.name}</b><span>${s.role}</span></span><span class="badge badge-blue">${s.access}</span></div>`).join('') : emptyState('لا يوجد أعضاء فريق بعد')}
    </div>
    <button class="btn btn-outline" style="margin-top:14px;" onclick="openInviteStaffSheet()">${icon('plus')} دعوة عضو جديد للفريق</button>
  </div>`;
}

function openInviteStaffSheet(){
  const accessOptions = (DB.roles && DB.roles.length) ? DB.roles.map(r=>r.role) : ['متدرب','مدرب','إدارة'];
  openSheet(`
    <h3>دعوة عضو جديد للفريق</h3>
    <div class="muted">يُضاف مباشرة إلى قائمة أعضاء الفريق وصلاحياته</div>
    <div class="field"><label>الاسم</label><input id="staff-name" placeholder="مثال: سارة العتيبي" /></div>
    <div class="field"><label>المسمى الوظيفي</label><input id="staff-role" placeholder="مثال: مديرة العمليات" /></div>
    <div class="field"><label>مستوى الوصول</label><select id="staff-access">${accessOptions.map(a=>`<option>${a}</option>`).join('')}</select></div>
    <button class="btn btn-primary" onclick="submitInviteStaff()">${icon('check')} إضافة العضو</button>
  `);
}
window.openInviteStaffSheet = openInviteStaffSheet;

async function submitInviteStaff(){
  const name = document.getElementById('staff-name').value.trim();
  const role = document.getElementById('staff-role').value.trim();
  const access = document.getElementById('staff-access').value;
  if (!name || !role) { toast('الرجاء تعبئة الاسم والمسمى الوظيفي'); return; }
  const { error } = await sb.from('staff_members').insert({ name, role, access, sort_order: (DB.staff.length || 0) + 1 });
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  toast('تمت إضافة العضو للفريق');
  closeSheet();
  await loadLiveData();
  render();
}
window.submitInviteStaff = submitInviteStaff;

function openEditProfileSheet(){
  const p = state.authProfile || {};
  const u = DB.users.client;
  openSheet(`
    <h3>تعديل المعلومات الأساسية</h3>
    <div class="muted">البريد الإلكتروني غير قابل للتعديل هنا</div>
    <div class="field"><label>الاسم الكامل</label><input id="prof-name" value="${p.full_name || u.name || ''}" /></div>
    <div class="field"><label>رقم الهاتف</label><input id="prof-phone" value="${p.phone || u.phone || ''}" placeholder="05xxxxxxxx" /></div>
    <div class="field"><label>رقم الهوية</label><input id="prof-national-id" value="${p.national_id || u.nationalId || ''}" placeholder="10xxxxxxxx" /></div>
    <div class="field"><label>البريد الإلكتروني</label><input value="${u.email || ''}" disabled /></div>
    <button class="btn btn-primary" onclick="submitEditProfile()">${icon('check')} حفظ التعديلات</button>
  `);
}
window.openEditProfileSheet = openEditProfileSheet;

async function submitEditProfile(){
  const full_name = document.getElementById('prof-name').value.trim();
  const phone = document.getElementById('prof-phone').value.trim();
  const national_id = document.getElementById('prof-national-id').value.trim();
  if (!full_name) { toast('الرجاء إدخال الاسم الكامل'); return; }
  if (!state.authUser) { toast('حدث خطأ: لم يتم التعرف على المستخدم'); return; }
  const { error } = await sb.from('profiles').update({ full_name, phone, national_id }).eq('id', state.authUser.id);
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  if (state.authProfile) { state.authProfile.full_name = full_name; state.authProfile.phone = phone; state.authProfile.national_id = national_id; }
  DB.users.client.name = full_name;
  DB.users.client.phone = phone;
  DB.users.client.nationalId = national_id;
  DB.users.trainer.name = full_name;
  DB.users.admin.name = full_name;
  toast('تم حفظ بياناتك بنجاح');
  closeSheet();
  render();
}
window.submitEditProfile = submitEditProfile;

async function requestInbodyMeasurement(){
  if (!state.authUser) { toast('حدث خطأ: لم يتم التعرف على المستخدم'); return; }
  const { error } = await sb.from('tickets').insert({
    user_id: state.authUser.id,
    category: 'إداري',
    subject: 'طلب حجز موعد قياس InBody جديد',
    message: 'يرجى التواصل معي لتحديد موعد قياس InBody جديد.',
  });
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  toast('تم إرسال طلبك، سيتواصل معك المدرب لتحديد الموعد');
  await loadLiveData();
}
window.requestInbodyMeasurement = requestInbodyMeasurement;

// =========================================================
// شاشات المدرب — أدوات إدخال حقيقية لبيانات المتدربين
// =========================================================
function openAddInbodySheet(clientId, clientName){
  openSheet(`
    <h3>قياس InBody جديد — ${clientName}</h3>
    <div class="muted">سيظهر هذا القياس فوراً في الملف الشخصي للمتدربة/المتدرب</div>
    <div class="field"><label>الوزن (كجم)</label><input id="ib-weight" type="number" step="0.1" placeholder="مثال: 74.5" /></div>
    <div class="field"><label>الكتلة العضلية (%)</label><input id="ib-muscle" type="number" step="0.1" placeholder="مثال: 33.2" /></div>
    <div class="field"><label>نسبة الدهون (%)</label><input id="ib-fat" type="number" step="0.1" placeholder="مثال: 22.8" /></div>
    <button class="btn btn-primary" onclick="submitAddInbody('${clientId}')">${icon('check')} حفظ القياس</button>
  `);
}
window.openAddInbodySheet = openAddInbodySheet;

async function submitAddInbody(clientId){
  const weight = parseFloat(document.getElementById('ib-weight').value);
  const muscle = parseFloat(document.getElementById('ib-muscle').value);
  const fat = parseFloat(document.getElementById('ib-fat').value);
  if (!weight || !muscle || !fat) { toast('الرجاء تعبئة جميع القياسات'); return; }
  const { error } = await sb.from('inbody_records').insert({ user_id: clientId, weight, muscle, fat });
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  toast('تم حفظ قياس InBody بنجاح');
  closeSheet();
  render();
}
window.submitAddInbody = submitAddInbody;

function openAddProgramSheet(clientId, clientName){
  openSheet(`
    <h3>برنامج / ملاحظة جديدة — ${clientName}</h3>
    <div class="muted">سيظهر هذا فوراً ضمن "برامجي التدريبية والغذائية" لدى المتدرب</div>
    <div class="field"><label>النوع</label><select id="pg-type"><option value="تدريبي">تدريبي</option><option value="غذائي">غذائي</option><option value="ملاحظة">ملاحظة تدريبية</option></select></div>
    <div class="field"><label>العنوان</label><input id="pg-title" placeholder="مثال: برنامج بناء القوة - المرحلة 1" /></div>
    <div class="field"><label>التفاصيل</label><textarea id="pg-notes" placeholder="اكتب التفاصيل أو التوصية..."></textarea></div>
    <button class="btn btn-primary" onclick="submitAddProgram('${clientId}')">${icon('check')} حفظ</button>
  `);
}
window.openAddProgramSheet = openAddProgramSheet;

async function submitAddProgram(clientId){
  const type = document.getElementById('pg-type').value;
  const title = document.getElementById('pg-title').value.trim();
  const notes = document.getElementById('pg-notes').value.trim();
  if (!title) { toast('الرجاء إدخال العنوان'); return; }
  const trainerName = (state.authProfile && state.authProfile.full_name) || DB.users.trainer.name;
  const { error } = await sb.from('programs').insert({ user_id: clientId, type, title, notes, trainer_name: trainerName });
  if (error) { toast('حدث خطأ: ' + error.message); return; }
  toast('تم الحفظ بنجاح');
  closeSheet();
  render();
}
window.submitAddProgram = submitAddProgram;

// =========================================================
// الموجّه الرئيسي (Router)
// =========================================================
const SCREENS = {
  'login': screenLogin,
  'complete-profile': screenCompleteProfile,
  'forgot-password': screenForgotPassword,
  'reset-password': screenResetPassword,
  'client-home': screenClientHome,
  'client-booking': screenClientBooking,
  'client-profile': screenClientProfile,
  'client-inbody': screenClientInbody,
  'client-programs': screenClientPrograms,
  'client-subscription': screenClientSubscription,
  'client-history': screenClientHistory,
  'client-support': screenClientSupport,
  'client-support-new': screenClientSupportNew,
  'client-notifications': screenClientNotifications,
  'client-checkin': screenClientCheckin,
  'client-more': screenClientMore,
  'trainer-home': screenTrainerHome,
  'trainer-clients': screenTrainerClients,
  'trainer-ratings': screenTrainerRatings,
  'admin-dashboard': screenAdminDashboard,
  'admin-classes': screenAdminClasses,
  'admin-classes-new': screenAdminClassesNew,
  'admin-offers': screenAdminOffers,
  'admin-reports': screenAdminReports,
  'admin-checkin': screenAdminCheckin,
  'admin-support': screenAdminSupport,
  'admin-permissions': screenAdminPermissions,
};

function render(){
  const screenFn = SCREENS[state.route] || screenLogin;
  const showChrome = state.route !== 'login';
  $app.innerHTML = `
    <div class="phone-screen">
      ${statusBar()}
      ${showChrome ? superAdminBar() : ''}
      ${installBanner()}
      <div class="screen-body">
        ${screenFn()}
      </div>
      ${showChrome ? bottomNav() : ''}
      <div class="modal-backdrop" id="sheet-backdrop" onclick="if(event.target===this) closeSheet()">
        <div class="modal-sheet" id="sheet-content"></div>
      </div>
      <div class="toast" id="toast"></div>
    </div>
  `;
}

render();
setupAuthListener();
checkExistingSession();
