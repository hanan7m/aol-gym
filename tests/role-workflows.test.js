const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createQueryRecorder(results, calls, table){
  const query = {
    select(){ calls.push({ table, action: 'select' }); return query; },
    eq(column, value){ calls.push({ table, action: 'eq', column, value }); return query; },
    in(column, values){ calls.push({ table, action: 'in', column, values }); return query; },
    order(){ return query; },
    limit(){ return query; },
    maybeSingle(){ return query; },
    single(){ return query; },
    update(payload){ calls.push({ table, action: 'update', payload }); return query; },
    insert(payload){ calls.push({ table, action: 'insert', payload }); return query; },
    delete(){ calls.push({ table, action: 'delete' }); return query; },
    then(resolve, reject){ return Promise.resolve(results[table] || { data: [], error: null }).then(resolve, reject); },
  };
  return query;
}

function createApp({ results = {}, rpcResult = { error: null } } = {}){
  const calls = [];
  const elements = new Map();
  const document = {
    getElementById(id){
      if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', classList: { add(){}, remove(){} } });
      return elements.get(id);
    },
  };
  const sandbox = {
    Promise,
    Date,
    Math,
    String,
    Number,
    Set,
    JSON,
    console,
    setTimeout,
    clearTimeout,
    document,
    navigator: { userAgent: '' },
    location: { protocol: 'https:', hostname: 'test.local' },
    window: {
      MSStream: false,
      matchMedia(){ return { matches: false }; },
      addEventListener(){},
    },
    icon(){ return ''; },
    LOGO_DATA_URI: '',
    sb: {
      from(table){ return createQueryRecorder(results, calls, table); },
      rpc(name, args){ calls.push({ action: 'rpc', name, args }); return Promise.resolve(rpcResult); },
      auth: { onAuthStateChange(){}, getSession(){ return Promise.resolve({ data: { session: null } }); } },
    },
  };
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;

  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), context, { filename: 'data.js' });
  let source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  source = source.replace(/\nrender\(\);\nsetupAuthListener\(\);\ncheckExistingSession\(\);\s*$/, '\n');
  vm.runInContext(source, context, { filename: 'app.js' });

  return {
    calls,
    context,
    element(id){ return document.getElementById(id); },
    run(code){ return vm.runInContext(code, context); },
  };
}

test('legacy support categories are normalized for a consistent client view', () => {
  const app = createApp();
  assert.equal(app.run("normalizeTicketCategory('فني')"), 'التطبيق والحساب');
  assert.equal(app.run("normalizeTicketCategory('إداري')"), 'العضوية والخدمات');
  assert.equal(app.run("normalizeTicketCategory('اقتراح')"), 'اقتراح');
});

test('data explorer builds dataset groups for both arrays and singleton stats', () => {
  const app = createApp();
  assert.equal(app.run("getExplorerCatalog().find(item => item.key === 'users').count"), 3);
  assert.equal(app.run("getExplorerCatalog().find(item => item.key === 'weeklyStats').count"), 1);
});

test('data explorer filters support records by section, dataset, and search text', () => {
  const app = createApp();
  app.run("state.explorerSection = 'support'; state.explorerDataset = 'all'; state.explorerSearch = 'تجميد';");
  assert.equal(app.run('getExplorerView().records.length'), 1);
  assert.equal(app.run('getExplorerView().records[0].title'), 'استفسار عن تجميد الاشتراك');

  app.run("state.explorerSection = 'booking'; state.explorerDataset = 'classes'; state.explorerSearch = 'زومبا';");
  assert.equal(app.run('getExplorerView().records.length'), 2);
});

test('a client loads only her own support tickets', async () => {
  const app = createApp({
    results: {
      classes: { data: [], error: null }, private_slots: { data: [], error: null }, offers: { data: [], error: null },
      tickets: { data: [], error: null }, bookings: { data: [], error: null }, inbody_records: { data: [], error: null },
      programs: { data: [], error: null }, notifications: { data: [], error: null }, trainer_ratings: { data: [], error: null },
    },
  });
  app.run("state.authUser = { id: 'client-1' }; state.authProfile = { role: 'client' };");
  await app.run('loadLiveData()');
  assert.ok(app.calls.some(call => call.table === 'tickets' && call.action === 'eq' && call.column === 'user_id' && call.value === 'client-1'));
});

test('a trainer cannot submit a support ticket or add a record for an unassigned client', async () => {
  const app = createApp();
  app.run("state.authUser = { id: 'trainer-1' }; state.authProfile = { role: 'trainer' }; DB.realClients = [];");
  app.element('tk-subject').value = 'اختبار';
  app.element('tk-message').value = 'اختبار';
  await app.run('submitTicket()');
  await app.run("submitAddInbody('client-1')");
  assert.equal(app.calls.filter(call => call.action === 'insert').length, 0);
});

test('private booking uses the atomic database RPC instead of separate writes', async () => {
  const app = createApp();
  app.run("state.authUser = { id: 'client-1' }; state.authProfile = { role: 'client' }; DB.privateSlots = [{ id: 'slot-1', isBooked: false }];");
  await app.run("bookPrivateSlot('slot-1')");
  const rpc = app.calls.find(call => call.action === 'rpc');
  assert.equal(rpc.name, 'book_private_slot');
  assert.equal(rpc.args.p_slot_id, 'slot-1');
  assert.equal(app.calls.some(call => call.table === 'bookings' && call.action === 'insert'), false);
  assert.equal(app.calls.some(call => call.table === 'private_slots' && call.action === 'update'), false);
});

test('client workflows call the persisted rating, attendance, and track RPCs', async () => {
  const app = createApp();
  app.run("state.authUser = { id: 'client-1' }; state.authProfile = { role: 'client' }; DB.bookings = [{ id: 'booking-1', trainer: 'كابتن نورة الحربي', status: 'منتهي' }]; DB.tracks = [{ id: 'track-1', name: 'مسار اللياقة العامة' }];");
  await app.run("rateSession('booking-1', 5)");
  await app.run('recordMyAttendance()');
  await app.run("joinTrack('track-1')");
  const rpcNames = app.calls.filter(call => call.action === 'rpc').map(call => call.name);
  assert.ok(rpcNames.includes('submit_session_rating'));
  assert.ok(rpcNames.includes('record_my_attendance'));
  assert.ok(rpcNames.includes('request_track_change'));
});

test('completed bookings that were already rated do not offer a second rating', () => {
  const app = createApp();
  app.run("DB.bookings = [{ id: 'booking-1', title: 'جلسة', date: 'اليوم', time: '10:00', trainer: 'مدربة', status: 'منتهي' }]; DB.ratedBookingIds = ['booking-1'];");
  const html = app.run('screenClientHistory()');
  assert.match(html, /تم التقييم/);
  assert.doesNotMatch(html, /openRatingSheet\('booking-1'\)/);
});

test('only an admin can send a track-change review RPC', async () => {
  const app = createApp();
  app.run("state.authProfile = { role: 'client' };");
  await app.run("reviewTrackChange('request-1', true)");
  assert.equal(app.calls.some(call => call.name === 'review_track_change'), false);

  app.run("state.authProfile = { role: 'admin' };");
  await app.run("reviewTrackChange('request-1', true)");
  const rpc = app.calls.find(call => call.name === 'review_track_change');
  assert.equal(rpc.args.p_request_id, 'request-1');
  assert.equal(rpc.args.p_approve, true);
});

test('the security migrations include the role boundary and atomic booking function', () => {
  const security = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260826_security_hardening.sql'), 'utf8');
  const booking = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260826_atomic_private_slot_booking.sql'), 'utf8');
  assert.match(security, /create policy gym_tickets_select/);
  assert.match(security, /trainer_client_assignments/);
  assert.match(booking, /for update/);
  assert.match(booking, /book_private_slot/);
  const operations = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260826_operational_features.sql'), 'utf8');
  assert.match(operations, /submit_session_rating/);
  assert.match(operations, /record_my_attendance/);
  assert.match(operations, /request_track_change/);
  const integrity = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260827_fix_workflow_integrity.sql'), 'utf8');
  assert.match(integrity, /review_track_change/);
  assert.match(integrity, /trainer_id uuid/);
  assert.match(integrity, /pg_policies/);
});
