// =========================================================
// AOL GYM — تطبيق صالة أكاديمية التعلم الرياضية (نموذج أولي تفاعلي)
// =========================================================

const state = {
  role: null,           // 'client' | 'trainer' | 'admin'
  route: 'login',
  params: {},
  bookedClassIds: new Set(['c1','c4']),
  ticketDraft: { category: 'فني', subject: '', message: '' },
  toastTimer: null,
  deferredInstallPrompt: null,   // حدث تثبيت PWA (Android/Chrome/Edge) بانتظار الاستخدام
  installBannerDismissed: false,
  isStandalone: window.matchMedia && window.matchMedia('(display-mode: standalone)').matches,
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

function setAuthMode(mode){
  state.authMode = mode;
  state.authError = '';
  render();
}
window.setAuthMode = setAuthMode;

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
  setRole((profile && profile.role) || 'client');
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

async function realSignUp(){
  const name = document.getElementById('auth-name').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  if (!name || !email || !password) { state.authError = 'الرجاء تعبئة جميع الحقول'; render(); return; }
  if (password.length < 6) { state.authError = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'; render(); return; }
  state.authBusy = true; state.authError = ''; render();
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
  state.authBusy = false;
  if (error) {
    state.authError = error.message.includes('already registered') ? 'هذا البريد الإلكتروني مسجّل مسبقاً' : error.message;
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

function toggleBooking(classId){
  if(state.bookedClassIds.has(classId)){
    state.bookedClassIds.delete(classId);
    toast('تم إلغاء الحجز');
  } else {
    state.bookedClassIds.add(classId);
    toast('تم تأكيد الحجز بنجاح');
  }
  render();
}
window.toggleBooking = toggleBooking;

function joinTrack(trackId){
  const t = DB.tracks.find(x=>x.id===trackId);
  toast('تم إرسال طلب الانضمام لـ «' + (t?t.name:'المسار') + '» للمشرف الأكاديمي');
}
window.joinTrack = joinTrack;

function submitTicket(){
  const subj = document.getElementById('tk-subject').value.trim();
  const msg = document.getElementById('tk-message').value.trim();
  if(!subj || !msg){ toast('الرجاء تعبئة كل الحقول'); return; }
  DB.tickets.unshift({ id:'tk-'+Math.floor(Math.random()*900+100), category: state.ticketDraft.category, subject: subj, status:'قيد المعالجة', date:new Date().toISOString().slice(0,10), reply:null });
  toast('تم إرسال طلبك للدعم الفني');
  go('client-support');
}
window.submitTicket = submitTicket;

function setTicketCategory(cat){
  state.ticketDraft.category = cat;
  render();
}
window.setTicketCategory = setTicketCategory;

function markAllRead(){
  DB.notifications.forEach(n=>n.read=true);
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

function addOffer(){
  const title = document.getElementById('offer-title').value.trim();
  if(!title){ toast('الرجاء كتابة عنوان العرض'); return; }
  DB.offers.unshift({ id:'o'+Math.random().toString(36).slice(2,6), title, audience:'جميع المتدربين', status:'مفعّل', sent:new Date().toISOString().slice(0,10), reach:0 });
  toast('تم إرسال العرض للمتدربين');
  go('admin-offers');
}
window.addOffer = addOffer;

function addClass(){
  const name = document.getElementById('cls-name').value.trim();
  const day = document.getElementById('cls-day').value;
  const time = document.getElementById('cls-time').value.trim();
  if(!name || !time){ toast('الرجاء تعبئة اسم الكلاس والوقت'); return; }
  DB.classes.unshift({ id:'c'+Math.random().toString(36).slice(2,6), name, type:'عام', trainer:'—', day, time, duration:'45 د', capacity:16, booked:0, location:'الصالة الرئيسية' });
  toast('تمت إضافة الكلاس للجدول');
  go('admin-classes');
}
window.addClass = addClass;

function replyTicket(id){
  const t = DB.tickets.find(x=>x.id===id);
  if(t){ t.status='تم الرد'; t.reply='شكراً لتواصلك، تم حل المشكلة من قبل فريق الدعم الفني.'; toast('تم إرسال الرد للعميل'); render(); }
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
    <div style="background:linear-gradient(160deg,var(--brand-900),var(--magenta-600) 55%,var(--accent-500));padding:44px 24px 34px;color:#fff;border-radius:0 0 32px 32px;">
      <div style="width:76px;height:76px;border-radius:18px;background:#fff;display:flex;align-items:center;justify-content:center;margin-bottom:14px;padding:8px;box-shadow:var(--shadow-md);">
        <img src="${typeof LOGO_DATA_URI!=='undefined'?LOGO_DATA_URI:''}" alt="أكاديمية التعلم" style="width:100%;height:100%;object-fit:contain;" />
      </div>
      <h1 style="margin:0;font-size:24px;">AOL GYM</h1>
      <div style="font-size:11.5px;opacity:.8;margin-top:2px;">تطبيق صالة أكاديمية التعلم</div>
      <p style="margin:6px 0 0;font-size:13px;opacity:.85;line-height:1.8;">تطبيق صالة أكاديمية التعلم الرياضية — متاح مجاناً لجميع المتدربين والطاقم الإداري، للحجز والمتابعة الصحية والتدريبية.</p>
    </div>
    <div style="padding:22px 20px;flex:1;">
      <div class="tabs" style="margin-top:0;">
        <button class="tab ${state.authMode==='signin'?'active':''}" onclick="setAuthMode('signin')">تسجيل الدخول</button>
        <button class="tab ${state.authMode==='signup'?'active':''}" onclick="setAuthMode('signup')">إنشاء حساب جديد</button>
      </div>

      ${state.authMode==='signup' ? `<div class="field"><label>الاسم الكامل</label><input id="auth-name" placeholder="مثال: سارة العتيبي" /></div>` : ''}
      <div class="field"><label>البريد الإلكتروني</label><input id="auth-email" type="email" placeholder="name@example.com" /></div>
      <div class="field"><label>كلمة المرور</label><input id="auth-password" type="password" placeholder="••••••••" /></div>

      ${state.authError ? `<div style="background:#fdecec;color:var(--danger);border-radius:12px;padding:10px 12px;font-size:12px;margin-bottom:12px;">${state.authError}</div>` : ''}

      ${state.authMode==='signin'
        ? `<button class="btn btn-primary" ${state.authBusy?'disabled':''} onclick="realSignIn()">${state.authBusy?'جاري الدخول...':'تسجيل الدخول'}</button>`
        : `<button class="btn btn-primary" ${state.authBusy?'disabled':''} onclick="realSignUp()">${state.authBusy?'جاري الإنشاء...':'إنشاء الحساب'}</button>`
      }
      <div class="sidebar-note" style="text-align:center;">حسابك هنا خاص بك ومحمي — بيانات الدخول تُحفظ بشكل آمن عبر Supabase.</div>
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
        <div class="hero-stat"><b>${DB.inbody.at(-1).weight}kg</b><span>الوزن الحالي</span></div>
        <div class="hero-stat"><b>${DB.inbody.at(-1).muscle}%</b><span>الكتلة العضلية</span></div>
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
  const list = DB.classes.filter(c=>c.day===activeDay);
  return `<div class="view">
    ${topBar('الحجوزات', 'استكشف الكلاسات الجماعية والجلسات الخاصة')}
    <div class="tabs">
      <button class="tab ${!state.params.tab||state.params.tab==='group'?'active':''}" onclick="go('client-booking',{tab:'group',day:'${activeDay}'})">كلاسات جماعية</button>
      <button class="tab ${state.params.tab==='private'?'active':''}" onclick="go('client-booking',{tab:'private'})">جلسات خاصة</button>
    </div>

    ${state.params.tab==='private' ? `
      <div class="section-title" style="margin-top:6px;"><h3>مواعيد متاحة</h3></div>
      ${DB.privateSlots.map(s=>`
        <div class="card" style="margin-bottom:10px;">
          <div class="list-row" style="border:none;padding:0;">
            <span class="list-icon">${icon('user')}</span>
            <span class="meta"><b>${s.type}</b><span>${s.trainer}</span></span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;">
            <span class="badge badge-blue">${icon('clock')} ${s.date} · ${s.time}</span>
            <button class="btn btn-primary btn-sm" onclick="toast('تم إرسال طلب الحجز للمدرب')">احجز الآن</button>
          </div>
        </div>`).join('')}
    ` : `
      <div class="day-strip">
        ${days.map(d=>`<button class="day-pill ${d===activeDay?'active':''}" onclick="go('client-booking',{tab:'group',day:'${d}'})"><b>${d.slice(0,3)}</b><span>${DB.classes.filter(c=>c.day===d).length} كلاس</span></button>`).join('')}
      </div>
      ${list.length===0 ? emptyState('لا توجد كلاسات مجدولة في هذا اليوم') : list.map(c=>{
        const booked = state.bookedClassIds.has(c.id);
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
          <button class="btn ${booked?'btn-danger-ghost':full?'btn-outline':'btn-primary'}" style="margin-top:12px;" ${full?'disabled':''} onclick="toggleBooking('${c.id}')">
            ${booked? 'إلغاء الحجز' : full? 'مكتمل العدد' : 'احجز مكانك'}
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

    <div class="section-title"><h3>المعلومات الأساسية</h3></div>
    <div class="card">
      <div class="list-row"><span class="list-icon">${icon('user')}</span><span class="meta"><b>الاسم الكامل</b><span>${u.name}</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('bell')}</span><span class="meta"><b>رقم الهاتف</b><span>${u.phone}</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('shield')}</span><span class="meta"><b>رقم الهوية</b><span>${u.nationalId}</span></span></div>
      <div class="list-row"><span class="list-icon">${icon('file')}</span><span class="meta"><b>البريد الإلكتروني</b><span>${u.email}</span></span></div>
    </div>

    <div class="section-title"><h3>رمز الدخول السريع</h3></div>
    <div class="card" style="text-align:center;">
      <div class="qr-wrap">${qrSvg(u.qr,150)}</div>
      <div style="font-size:11px;color:var(--ink-500);margin-top:10px;">اعرض هذا الرمز عند الدخول أو الخروج من الصالة</div>
    </div>

    <div class="section-title"><h3>وصول سريع</h3></div>
    <div class="card">
      <div class="list-row" onclick="go('client-inbody')" style="cursor:pointer;"><span class="list-icon">${icon('chart')}</span><span class="meta"><b>القياسات الصحية (InBody)</b><span>آخر قياس: ${DB.inbody.at(-1).date}</span></span><span>${icon('chevron')}</span></div>
      <div class="list-row" onclick="go('client-programs')" style="cursor:pointer;"><span class="list-icon">${icon('dumbbell')}</span><span class="meta"><b>برامجي التدريبية والغذائية</b><span>${DB.programs.length} برامج نشطة</span></span><span>${icon('chevron')}</span></div>
    </div>
  </div>`;
}

function screenClientInbody(){
  const last = DB.inbody.at(-1); const first = DB.inbody[0];
  const weightDelta = (last.weight-first.weight).toFixed(1);
  const fatDelta = (last.fat-first.fat).toFixed(1);
  const muscleDelta = (last.muscle-first.muscle).toFixed(1);
  return `<div class="view">
    ${backBar('القياسات الصحية InBody','client-profile')}
    <div class="stat-grid">
      <div class="stat-box"><div class="n">${last.weight} كجم</div><div class="l">الوزن الحالي</div><span class="delta ${weightDelta<0?'up':'down'}">${weightDelta} كجم منذ مارس</span></div>
      <div class="stat-box"><div class="n">${last.muscle}%</div><div class="l">الكتلة العضلية</div><span class="delta up">+${muscleDelta}% تحسّن</span></div>
      <div class="stat-box"><div class="n">${last.fat}%</div><div class="l">نسبة الدهون</div><span class="delta up">${fatDelta}% انخفاض</span></div>
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
    <button class="btn btn-outline" style="margin-top:14px;" onclick="toast('تم إرسال طلب حجز قياس InBody جديد للمدرب')">${icon('plus')} حجز موعد قياس جديد</button>
  </div>`;
}

function screenClientPrograms(){
  return `<div class="view">
    ${backBar('برامجي التدريبية والغذائية','client-profile')}
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
    <div class="card">
      ${DB.bookings.map(b=>`
        <div class="list-row"><span class="list-icon">${icon(b.status==='ملغي'?'x':'check')}</span><span class="meta"><b>${b.title}</b><span>${b.date} · ${b.time} · ${b.trainer}</span></span>
        <span class="badge ${b.status==='مؤكد'?'badge-green':b.status==='منتهي'?'badge-gray':'badge-red'}">${b.status}</span></div>`).join('')}
    </div>
  </div>`;
}

function screenClientSupport(){
  return `<div class="view">
    ${backBar('الدعم الفني والشكاوى','client-more')}
    <button class="btn btn-primary" onclick="go('client-support-new')">${icon('plus')} فتح طلب دعم جديد</button>
    <div class="section-title"><h3>طلباتي</h3></div>
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
    <div class="field"><label>عنوان الطلب</label><input id="tk-subject" placeholder="مثال: مشكلة في تسجيل الحضور" /></div>
    <div class="field"><label>تفاصيل الطلب</label><textarea id="tk-message" placeholder="اكتب وصفاً تفصيلياً..."></textarea></div>
    <button class="btn btn-primary" onclick="submitTicket()">${icon('check')} إرسال الطلب</button>
  </div>`;
}

function screenClientNotifications(){
  return `<div class="view">
    ${backBar('الإشعارات','client-more')}
    <div style="text-align:left;margin-bottom:6px;"><span class="link" style="cursor:pointer;" onclick="markAllRead()">تعليم الكل كمقروء</span></div>
    <div class="card">
      ${DB.notifications.map(n=>`
        <div class="list-row">
          <span class="list-icon">${icon(n.type==='booking'?'calendar':n.type==='billing'?'wallet':n.type==='offer'?'megaphone':'support')}</span>
          <span class="meta"><b>${n.title} ${!n.read?'<span class=\"notice-dot\" style=\"display:inline-block;margin-right:5px;\"></span>':''}</b><span>${n.body}</span></span>
          <span style="font-size:10px;color:var(--ink-300);white-space:nowrap;">${n.time}</span>
        </div>`).join('')}
    </div>
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
      ${DB.privateSlots.map(s=>`<div class="list-row"><span class="list-icon">${icon('user')}</span><span class="meta"><b>${s.type}</b><span>${s.date} · ${s.time}</span></span><span class="badge badge-green">مؤكد</span></div>`).join('')}
    </div>
    <div class="section-title"><h3>كلاساتي الجماعية هذا الأسبوع</h3></div>
    <div class="card">
      ${DB.classes.filter(c=>c.trainer.includes('نورة')||c.trainer.includes('عبدالله')).map(c=>`
        <div class="list-row"><span class="list-icon">${icon('calendar')}</span><span class="meta"><b>${c.name}</b><span>${c.day} · ${c.time}</span></span><span class="badge badge-blue">${c.booked}/${c.capacity}</span></div>`).join('')}
    </div>
  </div>`;
}

function screenTrainerClients(){
  const rows = [
    { name:'سارة العتيبي', plan:'مسار اللياقة والتأهيل', progress:82, last:'اليوم' },
    { name:'محمد القحطاني', plan:'مسار اللياقة العامة', progress:54, last:'أمس' },
    { name:'لمى الشمري', plan:'مسار الإعداد الرياضي المتقدم', progress:91, last:'قبل يومين' },
    { name:'خالد العمري', plan:'مسار اللياقة والتأهيل', progress:38, last:'قبل 5 أيام' },
  ];
  return `<div class="view">
    ${topBar('متدربيّ', rows.length + ' متدرب نشط')}
    ${rows.map(r=>`
      <div class="card" style="margin-bottom:10px;">
        <div class="list-row" style="border:none;padding:0;">
          <span class="trainer-avatar" style="width:40px;height:40px;">${r.name.split(' ').map(w=>w[0]).slice(0,2).join('')}</span>
          <span class="meta"><b>${r.name}</b><span>${r.plan} · آخر حضور: ${r.last}</span></span>
        </div>
        <div style="margin-top:10px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-500);margin-bottom:4px;"><span>التقدم نحو الهدف</span><span>${r.progress}%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width:${r.progress}%;"></div></div>
        </div>
        <button class="btn btn-outline btn-sm" style="margin-top:10px;" onclick="openSheet(noteSheet('${r.name}'))">${icon('edit')} إضافة ملاحظة تدريبية</button>
      </div>`).join('')}
  </div>`;
}

function noteSheet(name){
  return `<h3>ملاحظة تدريبية لـ ${name}</h3><div class="muted">ستظهر هذه الملاحظة في أرشيف العميل فوراً</div>
    <div class="field"><textarea placeholder="اكتب توصيتك..."></textarea></div>
    <button class="btn btn-primary" onclick="toast('تم حفظ الملاحظة'); closeSheet();">حفظ الملاحظة</button>`;
}
window.noteSheet = noteSheet;

function screenTrainerRatings(){
  const me = DB.trainerRatings.find(r=>r.trainer==='عبدالله المطيري');
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

function screenAdminClasses(){
  return `<div class="view">
    ${topBar('إدارة الكلاسات', DB.classes.length + ' كلاس مجدول')}
    <button class="btn btn-primary" onclick="go('admin-classes-new')">${icon('plus')} إضافة كلاس جديد</button>
    <div class="section-title"><h3>الجدول الأسبوعي</h3><span class="link" onclick="go('admin-offers')">العروض ←</span></div>
    ${DB.classes.map(c=>`
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <span class="badge badge-gray">${c.day}</span>
            <h4 style="margin:8px 0 2px;font-size:14.5px;">${c.name}</h4>
            <div class="info">${icon('user')} ${c.trainer} · ${icon('clock')} ${c.time}</div>
          </div>
          <span class="badge ${c.booked>=c.capacity?'badge-red':'badge-green'}">${c.booked}/${c.capacity}</span>
        </div>
        <div class="btn-row" style="margin-top:10px;">
          <button class="btn btn-outline btn-sm" onclick="toast('تم فتح نموذج تعديل الكلاس')">${icon('edit')} تعديل</button>
          <button class="btn btn-danger-ghost btn-sm" onclick="toast('تم حذف الكلاس من الجدول')">${icon('x')} إلغاء</button>
        </div>
      </div>`).join('')}
  </div>`;
}

function screenAdminClassesNew(){
  return `<div class="view">
    ${backBar('إضافة كلاس جديد','admin-classes')}
    <div class="field"><label>اسم الكلاس</label><input id="cls-name" placeholder="مثال: يوغا مسائية" /></div>
    <div class="field"><label>اليوم</label><select id="cls-day">${DB.weekDays.map(d=>`<option>${d}</option>`).join('')}</select></div>
    <div class="field"><label>الوقت</label><input id="cls-time" placeholder="مثال: 06:00 م" /></div>
    <div class="field"><label>المدرب</label><select><option>عبدالله المطيري</option><option>نورة الحربي</option><option>ريم الدوسري</option><option>فهد العنزي</option></select></div>
    <div class="field"><label>السعة القصوى</label><input type="number" placeholder="16" /></div>
    <button class="btn btn-primary" onclick="addClass()">${icon('check')} حفظ ونشر الكلاس</button>
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
    ${DB.offers.map(o=>`
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div><b style="font-size:13.5px;">${o.title}</b><div style="font-size:11px;color:var(--ink-500);margin-top:2px;">${o.audience} · ${o.sent}</div></div>
          <span class="badge ${o.status==='مفعّل'?'badge-green':'badge-gray'}">${o.status}</span>
        </div>
        <div style="font-size:11px;color:var(--ink-500);margin-top:8px;">${icon('users')} وصل إلى ${o.reach} عضو</div>
      </div>`).join('')}

    <div class="section-title"><h3>تقييمات المدربين</h3></div>
    <div class="card">
      ${DB.trainerRatings.map(r=>`<div class="list-row"><span class="list-icon">${icon('star')}</span><span class="meta"><b>${r.trainer}</b><span>${r.count} تقييم</span></span><b>${r.avg}</b></div>`).join('')}
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
      <table class="mini-table">
        <tr><th>الشهر</th><th>متدربون جدد</th><th>جلسات مكتملة</th><th>معدل الحضور</th></tr>
        <tr><td>يونيو</td><td>21</td><td>452</td><td>78%</td></tr>
        <tr><td>يوليو</td><td>24</td><td>486</td><td>80%</td></tr>
        <tr><td>أغسطس</td><td>27</td><td>512</td><td>82%</td></tr>
      </table>
    </div>

    <div class="section-title"><h3>أرشيف التقارير الصحية للأعضاء</h3></div>
    <div class="card">
      <div class="list-row"><span class="list-icon">${icon('file')}</span><span class="meta"><b>تقرير القياسات الشهري - أغسطس</b><span>142 عضو · تم التوليد تلقائياً</span></span><span>${icon('download')}</span></div>
      <div class="list-row"><span class="list-icon">${icon('file')}</span><span class="meta"><b>خطط تدريبية نشطة</b><span>89 خطة موزعة على المدربين</span></span><span>${icon('download')}</span></div>
    </div>
  </div>`;
}

function screenAdminCheckin(){
  return `<div class="view">
    ${topBar('سجل الحضور اليومي', new Date().toLocaleDateString('ar-SA',{weekday:'long', day:'numeric', month:'long'}))}
    <div class="stat-grid">
      <div class="stat-box"><div class="n">312</div><div class="l">دخول اليوم</div></div>
      <div class="stat-box"><div class="n">104</div><div class="l">داخل الصالة الآن</div></div>
    </div>
    <div class="section-title"><h3>آخر عمليات الدخول/الخروج</h3></div>
    <div class="card">
      ${DB.attendanceLog.map(a=>`
        <div class="list-row"><span class="list-icon" style="color:${a.type==='دخول'?'var(--brand-600)':'var(--ink-500)'};">${icon('scan')}</span>
        <span class="meta"><b>${a.name}</b><span>${a.method} · ${a.type}</span></span><span style="font-size:11px;color:var(--ink-500);">${a.time}</span></div>`).join('')}
    </div>
  </div>`;
}

function screenAdminSupport(){
  return `<div class="view">
    ${topBar('تذاكر الدعم الفني', DB.tickets.filter(t=>t.status!=='مغلقة').length + ' تذكرة نشطة')}
    <div class="tabs">
      <button class="tab active">الكل</button>
      <button class="tab">فني</button>
      <button class="tab">إداري</button>
      <button class="tab">اقتراحات</button>
    </div>
    ${DB.tickets.map(t=>`
      <div class="card" style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div><span class="badge badge-gray">${t.category}</span><div style="font-weight:700;font-size:13.5px;margin-top:6px;">${t.subject}</div><div style="font-size:11px;color:var(--ink-500);margin-top:2px;">${t.id} · ${t.date}</div></div>
          <span class="badge ${t.status==='تم الرد'?'badge-green':t.status==='مغلقة'?'badge-gray':'badge-orange'}">${t.status}</span>
        </div>
        ${t.reply?`<div style="background:var(--surface-sunken);border-radius:12px;padding:10px 12px;margin-top:10px;font-size:12px;line-height:1.7;">${t.reply}</div>`:`
        <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="replyTicket('${t.id}')">${icon('check')} إرسال رد جاهز</button>`}
      </div>`).join('')}
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
    ${DB.roles.map(r=>`
      <div class="card" style="margin-bottom:10px;">
        <b style="font-size:13.5px;">${r.role}</b>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
          ${r.perms.map(p=>`<span class="badge badge-gray">${p}</span>`).join('')}
        </div>
      </div>`).join('')}

    <div class="section-title"><h3>أعضاء الفريق</h3></div>
    <div class="card">
      ${DB.staff.map(s=>`
        <div class="list-row"><span class="trainer-avatar">${s.name.split(' ').map(w=>w[0]).slice(0,2).join('')}</span>
        <span class="meta"><b>${s.name}</b><span>${s.role}</span></span><span class="badge badge-blue">${s.access}</span></div>`).join('')}
    </div>
    <button class="btn btn-outline" style="margin-top:14px;" onclick="toast('تم فتح نموذج دعوة عضو جديد للفريق')">${icon('plus')} دعوة عضو جديد للفريق</button>
  </div>`;
}

// =========================================================
// الموجّه الرئيسي (Router)
// =========================================================
const SCREENS = {
  'login': screenLogin,
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
checkExistingSession();
