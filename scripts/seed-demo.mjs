#!/usr/bin/env node
/**
 * Demo school seed — fills a NEW school with realistic data through the real API, so every
 * rule (permissions, ledger, RLS) applies exactly as in normal use.
 *
 *   pnpm dev            # API on :4000 and web on :3000 must be running
 *   node scripts/seed-demo.mjs
 *
 * Creates: a school with classes LKG–10, sections, subjects, 21 teachers + office staff,
 * who-teaches-what, class teachers, ~100 students with parents, fee structures with four
 * quarterly installments, payments (some families paid, some partly, some not), old dues
 * for a few students, a week of attendance, the bell and full timetables, a substitution,
 * homework, notices, parent app access and a pending leave request.
 *
 * Every run makes a separate school, so it never touches your existing data. Sign-ins are
 * written to demo-logins.txt in the folder you run it from.
 *
 * Env (optional): API_URL (default http://localhost:4000), WEB_URL (default http://localhost:3000)
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

let API = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api/v1';

/** Macs may serve the API on IPv6 (localhost) or IPv4 (127.0.0.1); use whichever answers. */
async function pickApi() {
  if (process.env.API_URL) return;
  // Wait up to 90 seconds for "pnpm dev" to finish starting.
  for (let i = 0; i < 45; i++) {
    for (const host of ['http://localhost:4000', 'http://127.0.0.1:4000', 'http://[::1]:4000']) {
      try {
        const r = await fetch(`${host}/api/v1/health`);
        if (r.ok) {
          API = `${host}/api/v1`;
          return;
        }
      } catch {
        /* try the next */
      }
    }
    if (i === 0) console.log('  waiting for the app to start…');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const ORIGIN = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const STAFF_PASSWORD = 'Demo@School2026';
const PARENT_PASSWORD = 'Parent@2026';
const TZ = 'Asia/Kolkata';

/* ----------------------------------- tiny HTTP client ----------------------------------- */

class Client {
  cookies = new Map();
  csrf = '';
  constructor(label) {
    this.label = label;
  }
  headers(json) {
    const h = { Origin: ORIGIN, 'X-CSRF-Token': this.csrf };
    if (json) h['content-type'] = 'application/json';
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    return h;
  }
  keep(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, v);
      if (k === 'csrf') this.csrf = decodeURIComponent(v);
    }
  }
  async req(method, path, body, { ok = [200, 201, 204], form } = {}) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(API + path, {
          method,
          headers: this.headers(!form && body !== undefined),
          body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
        });
      } catch (e) {
        if (attempt < 3) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        throw new Error(
          `${method} ${path}: cannot reach the API at ${API} (${e.message}). Is "pnpm dev" running?`,
        );
      }
      this.keep(res);
      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (res.status >= 500 && attempt < 2) {
        await sleep(800);
        continue;
      }
      if (ok !== 'any' && !ok.includes(res.status)) {
        const msg = data?.error?.message ?? data?.message ?? text.slice(0, 300);
        const err = new Error(`${method} ${path} → ${res.status}: ${msg}`);
        err.status = res.status;
        throw err;
      }
      return ok === 'any' ? { status: res.status, body: data } : data;
    }
  }
  get = (p, o) => this.req('GET', p, undefined, o);
  post = (p, b = {}, o) => this.req('POST', p, b, o);
  put = (p, b = {}, o) => this.req('PUT', p, b, o);
  patch = (p, b = {}, o) => this.req('PATCH', p, b, o);
  upload(path, fields, file) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    if (file) fd.set('file', new Blob([file.bytes], { type: file.type }), file.name);
    return this.req('POST', path, undefined, { form: fd });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = (rupees) => Math.round(rupees * 100); // paise
const step = (t) => console.log(`\n▸ ${t}`);
const pick = (arr, i) => arr[i % arr.length];

/** Run tasks with limited parallelism. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDays = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};

/* ----------------------------------------- data ----------------------------------------- */

const tag = String(Math.floor(100 + Math.random() * 900)); // keeps phones/emails unique per run
let phoneSeq = 0;
const staffPhone = () => `8${tag}${String(100000 + phoneSeq++).slice(-6)}`;
let parentSeq = 0;
const parentPhone = () => `9${tag}${String(100000 + parentSeq++).slice(-6)}`;

const BOYS = [
  'Aarav',
  'Vivaan',
  'Aditya',
  'Arjun',
  'Reyansh',
  'Krishna',
  'Ishaan',
  'Kabir',
  'Rohan',
  'Yash',
  'Dev',
  'Kunal',
  'Harsh',
  'Manav',
  'Pranav',
  'Sahil',
  'Tanmay',
  'Om',
  'Rudra',
  'Lakshya',
];
const GIRLS = [
  'Ananya',
  'Diya',
  'Saanvi',
  'Aadhya',
  'Myra',
  'Kiara',
  'Pari',
  'Anika',
  'Ira',
  'Riya',
  'Navya',
  'Meera',
  'Tara',
  'Kavya',
  'Nisha',
  'Pooja',
  'Sneha',
  'Ishita',
  'Khushi',
  'Avni',
];
const SURNAMES = [
  'Sharma',
  'Verma',
  'Gupta',
  'Singh',
  'Agarwal',
  'Jain',
  'Meena',
  'Choudhary',
  'Rathore',
  'Shekhawat',
  'Joshi',
  'Mehta',
  'Saini',
  'Yadav',
  'Khan',
  'Bansal',
  'Mathur',
  'Soni',
  'Kumawat',
  'Sethi',
];
const FATHERS = [
  'Rajesh',
  'Suresh',
  'Mahesh',
  'Ramesh',
  'Anil',
  'Sunil',
  'Vikas',
  'Manoj',
  'Sanjay',
  'Deepak',
  'Amit',
  'Rakesh',
  'Naveen',
  'Pankaj',
  'Imran',
  'Ashok',
  'Mukesh',
  'Vinod',
  'Ajay',
  'Gaurav',
];

const CLASSES = [
  { code: 'LKG', name: 'LKG', stage: 'pre_primary', order: 1, sections: ['A'], group: 'pre' },
  { code: 'UKG', name: 'UKG', stage: 'pre_primary', order: 2, sections: ['A'], group: 'pre' },
  ...[1, 2, 3, 4, 5].map((n) => ({
    code: String(n),
    name: `Class ${n}`,
    stage: 'primary',
    order: 10 + n,
    sections: n === 1 || n === 5 ? ['A', 'B'] : ['A'],
    group: 'pri',
  })),
  ...[6, 7, 8].map((n) => ({
    code: String(n),
    name: `Class ${n}`,
    stage: 'middle',
    order: 10 + n,
    sections: n === 8 ? ['A', 'B'] : ['A'],
    group: 'sec',
  })),
  ...[9, 10].map((n) => ({
    code: String(n),
    name: `Class ${n}`,
    stage: 'secondary',
    order: 10 + n,
    sections: n === 10 ? ['A', 'B'] : ['A'],
    group: 'sec',
  })),
];

const SUBJECTS = [
  ['ENG', 'English'],
  ['HIN', 'Hindi'],
  ['MAT', 'Mathematics'],
  ['EVS', 'EVS'],
  ['SCI', 'Science'],
  ['SST', 'Social Science'],
  ['SKT', 'Sanskrit'],
  ['COMP', 'Computer'],
  ['DRAW', 'Drawing'],
];
/** Periods per week (8 periods × 6 days = 48). */
const QUOTA = {
  pre: { English: 12, Hindi: 12, Mathematics: 12, Drawing: 12 },
  pri: { English: 11, Hindi: 10, Mathematics: 12, EVS: 12, Computer: 3 },
  sec: {
    English: 8,
    Hindi: 7,
    Mathematics: 9,
    Science: 9,
    'Social Science': 8,
    Sanskrit: 4,
    Computer: 3,
  },
};

const TEACHERS = [
  ['Sunita Sharma', 'English'],
  ['Priya Mathur', 'English'],
  ['Neelam Joshi', 'English'],
  ['Rahul Verma', 'English'],
  ['Kamla Devi', 'Hindi'],
  ['Ramesh Chandra', 'Hindi'],
  ['Seema Saini', 'Hindi'],
  ['Anil Gupta', 'Mathematics'],
  ['Deepa Agarwal', 'Mathematics'],
  ['Vikram Singh', 'Mathematics'],
  ['Rekha Jain', 'Mathematics'],
  ['Pooja Meena', 'EVS'],
  ['Kavita Soni', 'EVS'],
  ['Manoj Yadav', 'Science'],
  ['Shalini Mehta', 'Science'],
  ['Arvind Rathore', 'Social Science'],
  ['Farha Khan', 'Social Science'],
  ['Pt. Hariom Shastri', 'Sanskrit'],
  ['Nikhil Bansal', 'Computer'],
  ['Asha Kumawat', 'Pre-primary'],
  ['Ritu Sethi', 'Pre-primary'],
];

/* ----------------------------------------- seed ----------------------------------------- */

async function main() {
  await pickApi();
  const t0 = Date.now();
  const today = todayIST();
  const y0 =
    Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const slug = `demo-${tag}${Math.floor(Math.random() * 90 + 10)}`;
  const logins = [];

  step(`School "Sunrise Demo School" (${slug})`);
  const owner = new Client('owner');
  await owner.get('/health', { ok: 'any' });
  // The first demo school gets an easy email; later runs get a unique one.
  let ownerEmail = 'owner@demo-school.com';
  const register = (email) =>
    owner.post(
      '/auth/register-school',
      {
        schoolName: 'Sunrise Demo School',
        slug,
        campusName: 'Main Campus',
        board: 'CBSE',
        fullName: 'Rajendra Prasad Agarwal',
        email,
        password: STAFF_PASSWORD,
      },
      { ok: 'any' },
    );
  let reg = await register(ownerEmail);
  if (reg.status === 409) {
    ownerEmail = `owner.${slug}@example.com`;
    reg = await register(ownerEmail);
  }
  if (reg.status !== 201) {
    throw new Error(
      `Could not create the demo school (${reg.status}): ${reg.body?.error?.message ?? ''}`,
    );
  }
  logins.push(['Owner', 'Rajendra Prasad Agarwal', ownerEmail]);
  const campusId = (await owner.get('/campuses'))[0].id;

  const year = await owner.post('/academic-years', {
    campusId,
    name: `${y0}-${String((y0 + 1) % 100).padStart(2, '0')}`,
    startsOn: `${y0}-04-01`,
    endsOn: `${y0 + 1}-03-31`,
  });
  await owner.post(`/academic-years/${year.id}/make-current`, {});

  step('Classes, sections and subjects');
  const subj = {};
  for (const [code, name] of SUBJECTS)
    subj[name] = (await owner.post('/subjects', { code, name })).id;
  const sections = []; // { id, label, group, classId, classIndex }
  for (const [ci, c] of CLASSES.entries()) {
    const cls = await owner.post('/classes', {
      campusId,
      code: c.code,
      name: c.name,
      stage: c.stage,
      sortOrder: c.order,
    });
    await owner.put(`/classes/${cls.id}/subjects`, {
      subjects: Object.keys(QUOTA[c.group]).map((n) => ({ subjectId: subj[n] })),
    });
    c.id = cls.id;
    for (const s of c.sections) {
      const sec = await owner.post('/sections', {
        academicYearId: year.id,
        gradeLevelId: cls.id,
        name: s,
      });
      sections.push({
        id: sec.id,
        label: `${c.name} ${s}`,
        group: c.group,
        classId: cls.id,
        classIndex: ci,
        cls: c,
      });
    }
  }
  console.log(
    `  ${CLASSES.length} classes, ${sections.length} sections, ${SUBJECTS.length} subjects`,
  );

  step('Staff (accepting their invites with the demo password)');
  const roles = Object.fromEntries((await owner.get('/roles')).map((r) => [r.key, r.id]));
  const invite = async (fullName, role, designation) => {
    const phone = staffPhone();
    const inv = await owner.post('/members/invite', {
      phone,
      fullName,
      designation,
      assignments: [{ roleId: roles[role], campusId }],
    });
    return {
      id: inv.id,
      phone,
      name: fullName,
      token: new URL(inv.link.url).searchParams.get('token'),
      client: null,
    };
  };
  /** The API allows 10 invite acceptances per 15 minutes from one address, so only some sign in. */
  const activate = async (m) => {
    if (m.client) return m;
    const c = new Client(m.name);
    await c.post('/auth/invite/accept', { token: m.token, password: STAFF_PASSWORD });
    m.client = c;
    return m;
  };
  const office = {};
  for (const [key, name, role, desig] of [
    ['principal', 'Dr. Meenakshi Iyer', 'principal', 'Principal'],
    ['admin', 'Sanjay Malhotra', 'school_admin', 'Office Superintendent'],
    ['accountant', 'Naresh Goyal', 'accountant', 'Accountant'],
    ['reception', 'Komal Arora', 'receptionist', 'Receptionist'],
  ]) {
    office[key] = await activate(await invite(name, role, desig));
    logins.push([desig, name, office[key].phone]);
  }
  const teachers = await pool(TEACHERS, 4, async ([name, subject]) => ({
    ...(await invite(
      name,
      'teacher',
      subject === 'Pre-primary' ? 'Pre-primary Teacher' : `${subject} Teacher`,
    )),
    subject,
  }));
  console.log(`  ${4 + teachers.length} staff`);

  step('Who teaches what, and class teachers');
  // Split each subject's sections across its teachers in blocks, so each teacher has a few classes.
  const teach = {}; // sectionId -> subjectName -> teacher
  const pre = teachers.filter((t) => t.subject === 'Pre-primary');
  sections
    .filter((s) => s.group === 'pre')
    .forEach((s, i) => {
      teach[s.id] = Object.fromEntries(Object.keys(QUOTA.pre).map((n) => [n, pre[i % pre.length]]));
    });
  for (const subject of [
    'English',
    'Hindi',
    'Mathematics',
    'EVS',
    'Science',
    'Social Science',
    'Sanskrit',
    'Computer',
  ]) {
    const pool_ = teachers.filter((t) => t.subject === subject);
    const secs = sections.filter((s) => s.group !== 'pre' && QUOTA[s.group][subject]);
    const per = Math.ceil(secs.length / pool_.length);
    secs.forEach((s, i) => {
      teach[s.id] ??= {};
      teach[s.id][subject] = pool_[Math.min(Math.floor(i / per), pool_.length - 1)];
    });
  }
  await pool(sections, 4, async (s) => {
    for (const [subject, t] of Object.entries(teach[s.id])) {
      await owner.put('/teaching/cell', {
        sectionId: s.id,
        subjectId: subj[subject],
        membershipIds: [t.id],
      });
    }
  });
  // Class teacher: someone who teaches the section, each teacher at most one section.
  const used = new Set();
  for (const s of sections) {
    const order = Object.entries(teach[s.id]).sort(
      (a, b) => QUOTA[s.group][b[0]] - QUOTA[s.group][a[0]],
    );
    const t =
      order.map(([, t]) => t).find((t) => !used.has(t.id)) ?? teachers.find((t) => !used.has(t.id));
    used.add(t.id);
    s.classTeacher = t;
    await owner.patch(`/sections/${s.id}`, { classTeacherMembershipId: t.id });
  }
  // Four teachers get working sign-ins; the rest stay invited (their WhatsApp link is in Settings → Members).
  const ct = (label) => sections.find((x) => x.label === label).classTeacher;
  const live = [
    ct('Class 8 A'),
    ct('Class 1 A'),
    teachers.find((t) => t.subject === 'Hindi'),
    ct('LKG A'),
  ];
  for (const t of [...new Set(live)]) await activate(t);
  for (const t of [...teachers].sort((a, b) => Number(!!b.client) - Number(!!a.client))) {
    const mine = sections.filter((s) => Object.values(teach[s.id]).includes(t)).map((s) => s.label);
    const ct = sections.find((s) => s.classTeacher === t); // eslint-disable-line no-shadow
    logins.push([
      `Teacher — ${t.subject}${ct ? `, class teacher of ${ct.label}` : ''}`,
      t.name,
      t.client ? t.phone : `${t.phone} (not signed in yet — no password)`,
      `teaches ${mine.join(', ')}`,
    ]);
  }

  step('Students and parents');
  let n = 0;
  const students = [];
  const STUDENTS_PER_SECTION = 6;
  for (const s of sections) {
    const age = s.group === 'pre' ? (s.cls.code === 'LKG' ? 4 : 5) : Number(s.cls.code) + 5;
    const rows = Array.from({ length: STUDENTS_PER_SECTION }, (_, i) => {
      const k = n++;
      const girl = k % 2 === 1;
      const first = girl ? pick(GIRLS, k * 7 + 3) : pick(BOYS, k * 5 + 1);
      const last = pick(SURNAMES, k * 3 + s.classIndex);
      const month = String((k % 12) + 1).padStart(2, '0');
      const day = String((k % 27) + 1).padStart(2, '0');
      return {
        s,
        roll: i + 1,
        k,
        girl,
        first,
        last,
        dob: `${y0 - age}-${month}-${day}`,
        father: `${pick(FATHERS, k * 11)} ${last}`,
      };
    });
    const made = await pool(rows, 3, async (r) => {
      const st = await owner.post('/students', {
        firstName: r.first,
        lastName: r.last,
        dateOfBirth: r.dob,
        gender: r.girl ? 'female' : 'male',
        sectionId: s.id,
        rollNumber: r.roll,
        admissionDate: `${y0}-04-01`,
        guardians: [
          {
            fullName: r.father,
            phone: parentPhone(),
            relationship: 'father',
            isPrimary: true,
            isFeePayer: true,
          },
          ...(r.k % 3 === 0
            ? [
                {
                  fullName: `${pick(['Sunita', 'Anita', 'Geeta', 'Rekha', 'Shabana', 'Neha'], r.k)} ${r.last}`,
                  phone: parentPhone(),
                  relationship: 'mother',
                },
              ]
            : []),
        ],
        privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
      });
      return {
        id: st.id,
        admissionNumber: st.admissionNumber,
        name: `${r.first} ${r.last}`,
        father: r.father,
        section: s,
      };
    });
    students.push(...made);
  }
  // A brother in Class 3 for the first Class 1 A student (same father) — shows siblings in the parent app.
  const sib = students[sections.findIndex((x) => x.label === 'Class 1 A') * STUDENTS_PER_SECTION];
  const sibAccess = await owner.get(`/students/${sib.id}/portal-access`);
  const fatherId = sibAccess.guardians[0].id;
  const sec3 = sections.find((x) => x.label === 'Class 3 A');
  const brother = await owner.post('/students', {
    firstName: 'Lakshya',
    lastName: sib.name.split(' ').slice(1).join(' '),
    dateOfBirth: `${y0 - 8}-08-15`,
    gender: 'male',
    sectionId: sec3.id,
    rollNumber: STUDENTS_PER_SECTION + 1,
    admissionDate: `${y0}-04-01`,
    guardians: [
      { guardianId: fatherId, relationship: 'father', isPrimary: true, isFeePayer: true },
    ],
    privacyNotice: { acknowledged: true, version: '1.0', channel: 'in_person' },
  });
  students.push({
    id: brother.id,
    admissionNumber: brother.admissionNumber,
    name: `Lakshya ${sib.name.split(' ').slice(1).join(' ')}`,
    father: sib.father,
    section: sec3,
  });
  console.log(`  ${students.length} students`);

  step('Fees: heads, structures with four quarterly installments, dues');
  const acct = office.accountant.client;
  const heads = {};
  for (const [code, name, category] of [
    ['TUI', 'Tuition fee', 'tuition'],
    ['ANN', 'Annual charges', 'annual'],
    ['EXM', 'Exam fee', 'exam'],
    ['CMP', 'Computer fee', 'other'],
  ])
    heads[code] = (await owner.post('/fees/heads', { code, name, category })).id;
  const FEES = {
    pre: { label: 'Pre-primary', tuition: 2500, annual: 3000, exam: 300, computer: 0 },
    pri: { label: 'Classes 1–5', tuition: 3200, annual: 4000, exam: 400, computer: 300 },
    mid: { label: 'Classes 6–8', tuition: 3800, annual: 4500, exam: 500, computer: 400 },
    high: { label: 'Classes 9–10', tuition: 4500, annual: 5000, exam: 600, computer: 500 },
  };
  const feeGroupOf = (c) =>
    c.group === 'pre' ? 'pre' : c.group === 'pri' ? 'pri' : Number(c.code) <= 8 ? 'mid' : 'high';
  const dues = [`${y0}-04-15`, `${y0}-07-15`, `${y0}-10-15`, `${y0 + 1}-01-15`];
  const installmentTotal = {};
  for (const [g, f] of Object.entries(FEES)) {
    const classIds = CLASSES.filter((c) => feeGroupOf(c) === g).map((c) => c.id);
    const st = await owner.post('/fees/structures', {
      campusId,
      academicYearId: year.id,
      name: `${f.label} fees ${year.name}`,
      kind: 'class',
      gradeLevelIds: classIds,
      lateFee: { kind: 'fixed', amount: R(100), graceDays: 10 },
    });
    const installments = dues.map((dueOn, q) => {
      const items = [{ feeHeadId: heads.TUI, amount: R(f.tuition * 3) }];
      if (q === 0) items.push({ feeHeadId: heads.ANN, amount: R(f.annual) });
      if (q === 1 || q === 3) items.push({ feeHeadId: heads.EXM, amount: R(f.exam) });
      if (f.computer) items.push({ feeHeadId: heads.CMP, amount: R(f.computer * 3) });
      return { label: `Quarter ${q + 1}`, dueOn, items };
    });
    installmentTotal[g] = installments.map((i) => i.items.reduce((a, x) => a + x.amount, 0));
    await owner.put(`/fees/structures/${st.id}/plan`, { installments });
    await owner.post(`/fees/structures/${st.id}/status`, { status: 'published' });
    await owner.post('/fees/demands/generate', { structureId: st.id });
  }

  step('Fee payments at the counter');
  // Real-life mix: most paid what is due, some are a quarter behind, a few paid part, a few nothing.
  const dueSoFar = dues.filter((d) => d <= today).length;
  let receipts = 0;
  await pool(students, 3, async (st, i) => {
    const amounts = installmentTotal[feeGroupOf(st.section.cls)];
    const r = i % 10;
    const quarters = r < 6 ? dueSoFar : r < 8 ? Math.max(dueSoFar - 1, 0) : 0;
    const pays = amounts.slice(0, quarters);
    if (r === 8) pays.push(Math.round(amounts[0] / 2 / 100) * 100); // part payment
    for (const [q, amount] of pays.entries()) {
      const mode = pick(['cash', 'upi', 'cash', 'bank_transfer'], i + q);
      await acct.post('/fees/payments', {
        studentId: st.id,
        mode,
        amount,
        payerName: st.father,
        reference:
          mode === 'cash' ? '' : `${mode === 'upi' ? 'UPI' : 'NEFT'}${String(400000 + i * 10 + q)}`,
        idempotencyKey: randomUUID(),
      });
      receipts++;
    }
  });
  console.log(`  ${receipts} receipts`);

  step('Old dues from last year (opening balances import)');
  const olds = students.filter((_, i) => i % 13 === 5).slice(0, 6);
  const csv = [
    'Admission no,Name,Previous dues,Advance',
    ...olds.map(
      (s, i) =>
        `${s.admissionNumber},${s.name},${i === olds.length - 1 ? '' : 1500 + i * 750},${i === olds.length - 1 ? 2000 : ''}`,
    ),
  ].join('\n');
  const preview = await owner.upload(
    `/opening-balances?campusId=${campusId}`,
    {},
    { name: 'old-balances.csv', type: 'text/csv', bytes: Buffer.from(csv) },
  );
  if (preview.problems?.length)
    console.log('  skipped (problems):', JSON.stringify(preview.problems).slice(0, 300));
  else {
    await owner.post(`/opening-balances/${preview.id}/apply`, {});
    console.log(`  ${olds.length} students with old balances`);
  }

  step('Attendance for the last working days');
  const set = await owner.get(`/attendance/settings?campusId=${campusId}`);
  await owner.put(`/attendance/settings?campusId=${campusId}`, { ...set, cutoffHours: 168 });
  let registers = 0;
  try {
    const days = [];
    for (let d = 6; d >= 0 && days.length < 6; d--) days.push(addDays(today, -d));
    await pool(sections, 3, async (s, si) => {
      for (const [di, date] of days.entries()) {
        const who = s.classTeacher.client ?? owner;
        const reg = await who.get(`/attendance/sections/${s.id}/register?date=${date}&period=0`, {
          ok: 'any',
        });
        if (reg.status !== 200 || !reg.body?.students?.length || reg.body?.working === false)
          continue;
        const records = reg.body.students.map((x, i) => ({
          enrollmentId: x.enrollmentId,
          status: (i + di + si) % 17 === 0 ? 'absent' : (i + di) % 23 === 0 ? 'late' : 'present',
        }));
        const res = await who.put(
          `/attendance/sections/${s.id}/register?date=${date}&period=0`,
          { records },
          { ok: 'any' },
        );
        if (res.status === 200) registers++;
      }
    });
  } finally {
    await owner.put(`/attendance/settings?campusId=${campusId}`, set);
  }
  console.log(`  ${registers} class registers`);

  step('School bell and timetables');
  const bell = await owner.put('/timetable/slots', {
    campusId,
    slots: [
      ['Period 1', '08:00', '08:40'],
      ['Period 2', '08:40', '09:20'],
      ['Period 3', '09:20', '10:00'],
      ['Short break', '10:00', '10:15', true],
      ['Period 4', '10:15', '10:55'],
      ['Period 5', '10:55', '11:35'],
      ['Lunch', '11:35', '12:05', true],
      ['Period 6', '12:05', '12:45'],
      ['Period 7', '12:45', '13:25'],
      ['Period 8', '13:25', '14:05'],
    ].map(([label, startsAt, endsAt, isBreak]) => ({
      label,
      startsAt,
      endsAt,
      isBreak: !!isBreak,
    })),
  });
  const periods = bell.slots.filter((x) => !x.isBreak);
  // Greedy timetable: each slot, each class takes the subject it still needs most whose teacher is free.
  const left = Object.fromEntries(sections.map((s) => [s.id, { ...QUOTA[s.group] }]));
  const cells = [];
  for (let wd = 1; wd <= 6; wd++) {
    for (const [pi, p] of periods.entries()) {
      const busy = new Set();
      const order = [...sections].sort(
        (a, b) => ((a.classIndex * 7 + wd + pi) % 5) - ((b.classIndex * 7 + wd + pi) % 5),
      );
      for (const s of order) {
        const need = Object.entries(left[s.id])
          .filter(([sub, k]) => k > 0 && !busy.has(teach[s.id][sub].id))
          .sort(
            (a, b) => b[1] - a[1] || ((a[0].length + wd + pi) % 3) - ((b[0].length + wd + pi) % 3),
          );
        if (!need.length) continue;
        const [sub] = need[0];
        const t = teach[s.id][sub];
        busy.add(t.id);
        left[s.id][sub]--;
        cells.push({ s, wd, slotId: p.id, subjectId: subj[sub], membershipId: t.id });
      }
    }
  }
  await pool(cells, 6, (c) =>
    owner.put(`/timetable/sections/${c.s.id}/cell`, {
      weekday: c.wd,
      slotId: c.slotId,
      subjectId: c.subjectId,
      membershipId: c.membershipId,
    }),
  );
  console.log(`  ${cells.length} periods filled (${sections.length * 48 - cells.length} free)`);

  step("Today's substitution, homework, notices");
  const wdToday = weekday(today);
  const absentTeacher = teachers.find((t) => t.subject === 'Mathematics');
  if (wdToday <= 6) {
    const day = await owner.get(
      `/timetable/teachers/${absentTeacher.id}/day?campusId=${campusId}&date=${today}`,
    );
    for (const p of day.periods.slice(0, -1)) {
      const sub = p.freeTeachers[0];
      if (sub)
        await owner.put('/timetable/substitutions', {
          onDate: today,
          entryId: p.entryId,
          substituteMembershipId: sub.membershipId,
        });
    }
  }
  const HW = {
    English: [
      'Read the lesson "The Little Bird" and write 5 new words',
      'Write a paragraph on "My School"',
      'Learn spellings of lesson 4',
    ],
    Hindi: ['पाठ 3 के प्रश्न-उत्तर लिखिए', 'सुलेख: एक पृष्ठ', 'कविता याद कीजिए'],
    Mathematics: [
      'Exercise 4.2, questions 1 to 10',
      'Learn tables 12 to 15',
      'Practice sheet on fractions',
    ],
    EVS: ['Draw and label the parts of a plant', 'List 5 sources of water near your home'],
    Science: [
      'Read chapter 5 and answer the in-text questions',
      'Draw the diagram of the human heart',
    ],
    'Social Science': ['Map work: mark the rivers of India', 'Answer questions 1–5 of chapter 3'],
    Sanskrit: ['शब्द रूप: बालक, लता याद करें'],
    Computer: ['Write the parts of a computer with their use'],
    Drawing: ['Colour the mango picture in your drawing book'],
  };
  let hw = 0;
  await pool(sections, 3, async (s, si) => {
    const subs = Object.keys(teach[s.id]).slice(si % 2, (si % 2) + 2);
    for (const [k, sub] of subs.entries()) {
      await (teach[s.id][sub].client ?? owner).upload(
        '/homework',
        {
          sectionId: s.id,
          subjectId: subj[sub],
          title: pick(HW[sub], si + k),
          details: '',
          dueOn: addDays(today, 2),
        },
        null,
      );
      hw++;
    }
  });
  const notices = [
    {
      title: 'Parent-teacher meeting on Saturday',
      body: "PTM for all classes on Saturday from 9 am to 12 noon. Please bring your ward's diary.",
      audience: 'parents',
      pinned: true,
    },
    {
      title: 'Winter uniform from 1st December',
      body: 'Students will come in winter uniform (navy blue sweater/blazer) from 1st December.',
      audience: 'everyone',
    },
    {
      title: 'Half-yearly exam date sheet',
      body: 'Half-yearly exams for Classes 6–10 begin on 8th December. The date sheet is with the class teacher.',
      audience: 'parents',
      gradeLevelIds: CLASSES.filter((c) => c.group === 'sec').map((c) => c.id),
    },
    {
      title: 'Staff meeting today at 2:15 pm',
      body: 'All teachers please assemble in the staff room after the last period.',
      audience: 'staff',
    },
  ];
  for (const nt of notices) {
    const made = await owner.post('/notices', {
      campusId,
      gradeLevelIds: [],
      sectionIds: [],
      pinned: false,
      expiresOn: null,
      ...nt,
    });
    await owner.post(`/notices/${made.id}/publish`, {});
  }
  console.log(`  ${hw} homework, ${notices.length} notices`);

  step('Exams: Periodic Test 1 (results out) and Half-yearly (marks being entered)');
  const examPlan = [
    {
      name: 'Periodic Test 1',
      startsOn: `${y0}-07-20`,
      endsOn: `${y0}-07-26`,
      max: 40,
      fill: 1,
      publish: true,
    },
    {
      name: 'Half-yearly',
      startsOn: `${y0}-09-21`,
      endsOn: `${y0}-09-30`,
      max: 80,
      fill: 0.5,
      publish: false,
    },
  ];
  // A steady "ability" per student so marks look consistent across subjects and exams.
  const ability = (k) => 0.45 + ((k * 37) % 50) / 100; // 45%..94%
  let markCount = 0;
  for (const ex of examPlan) {
    const exam = await owner.post('/exams', {
      campusId,
      name: ex.name,
      startsOn: ex.startsOn,
      endsOn: ex.endsOn,
    });
    const papersByClass = {};
    for (const c of CLASSES) {
      const subjects = Object.keys(QUOTA[c.group]).filter((x) => x !== 'Drawing');
      const res = await owner.put(`/exams/${exam.id}/papers`, {
        gradeLevelId: c.id,
        papers: subjects.map((sub, i) => ({
          subjectId: subj[sub],
          examDate: addDays(ex.startsOn, Math.min(i, 6)),
          startsAt: '09:00',
          maxMarks: c.group === 'pre' ? 20 : ex.max,
          passMarks: Math.ceil((c.group === 'pre' ? 20 : ex.max) * 0.33),
        })),
      });
      papersByClass[c.id] = res.papers;
    }
    await owner.post(`/exams/${exam.id}/status`, { status: 'open' });
    await pool(sections, 3, async (s, si) => {
      const papers = papersByClass[s.classId];
      const doPapers = papers.slice(0, Math.ceil(papers.length * ex.fill));
      for (const [pi, p] of doPapers.entries()) {
        // Leave Half-yearly papers of teachers who can sign in empty, so they have marks to enter.
        if (!ex.publish && teach[s.id][p.subjectName]?.client) continue;
        const path = `/exams/papers/${p.id}/sections/${s.id}`;
        const sheet = await owner.get(path);
        const marks = sheet.students.map((st, k) => {
          const seed = si * 7 + k * 3 + pi;
          if (seed % 29 === 0)
            return { enrollmentId: st.enrollmentId, status: 'absent', marks: null };
          const raw =
            p.maxMarks *
            Math.min(1, Math.max(0.15, ability(si * 10 + k) + (((seed * 13) % 21) - 10) / 100));
          return {
            enrollmentId: st.enrollmentId,
            status: 'present',
            marks: Math.round(raw * 2) / 2,
          };
        });
        await owner.put(path, { marks });
        markCount += marks.length;
        if (ex.publish || pi % 2 === 0) await owner.post(`${path}/submit`, {});
      }
    });
    if (ex.publish) {
      const ct = sections.find((x) => x.label === 'Class 8 A');
      const res = await owner.get(`/exams/${exam.id}/sections/${ct.id}/results`);
      await owner.put(`/exams/${exam.id}/sections/${ct.id}/remarks`, {
        remarks: res.results.map((r) => ({
          enrollmentId: r.enrollmentId,
          remark: r.failedIn.length
            ? `Needs regular practice in ${r.failedIn.join(' and ')}. Please check the diary daily.`
            : (r.percent ?? 0) >= 85
              ? 'Excellent performance. Keep it up!'
              : 'Good effort. Can do better with regular revision.',
        })),
      });
      await owner.post(`/exams/${exam.id}/status`, { status: 'published' });
    }
  }
  console.log(`  2 exams, ${markCount} marks`);

  step('Parent app access');
  const parents = [];
  const parentPicks = [
    sib,
    students[sections.findIndex((x) => x.label === 'Class 8 A') * STUDENTS_PER_SECTION + 2],
    students[sections.findIndex((x) => x.label === 'UKG A') * STUDENTS_PER_SECTION + 1],
  ];
  for (const st of parentPicks) {
    const access = await owner.get(`/students/${st.id}/portal-access`);
    const g = access.guardians.find((x) => x.isPrimary) ?? access.guardians[0];
    const link = await owner.post('/portal/invites', { guardianId: g.id });
    const p = new Client(`parent ${st.father}`);
    await p.post('/portal/activate', {
      token: new URL(link.url).searchParams.get('token'),
      password: PARENT_PASSWORD,
    });
    parents.push({ client: p, student: st, phone: g.phone ?? access.guardians[0].phone });
    logins.push([
      'Parent',
      `${st.father} (${st === sib ? `${st.name}, ${st.section.label} + Lakshya, Class 3 A` : `${st.name}, ${st.section.label}`})`,
      String(g.phone ?? '').replace(/^\+91/, '') || '(see Students → Parent app)',
    ]);
  }
  await parents[1].client.post(
    `/family/children/${parents[1].student.id}/leave`,
    {
      fromDate: addDays(today, 1),
      toDate: addDays(today, 2),
      reason: 'Going to my native village for a family wedding',
    },
    { ok: 'any' },
  );

  /* --------------------------------------- summary --------------------------------------- */
  const lines = [
    'SUNRISE DEMO SCHOOL — demo sign-ins (test data only)',
    `Created ${new Date().toISOString()} · school address: ${slug}`,
    '',
    `Staff sign-in:  ${ORIGIN}/login          password for every staff account: ${STAFF_PASSWORD}`,
    `Parent sign-in: ${ORIGIN}/parent/login   password for every parent account: ${PARENT_PASSWORD}`,
    '',
    'ROLE | NAME | SIGN IN WITH (email or mobile) | NOTES',
    ...logins.map((l) => l.join(' | ')),
    '',
    `Today ${absentTeacher.name} is absent today; the periods are covered (Academics → Substitutions).`,
    'A parent leave request is waiting for the Class 8 A class teacher (Attendance → Leave).',
    'Exams: Periodic Test 1 results are published (parents see them); Half-yearly is open for marks entry.',
  ];
  writeFileSync('demo-logins.txt', lines.join('\n') + '\n');
  console.log(
    `\n✔ Done in ${Math.round((Date.now() - t0) / 1000)}s. Sign-ins saved to demo-logins.txt\n`,
  );
  console.log(lines.slice(3, 9 + logins.length).join('\n'));
}

main().catch((e) => {
  console.error(`\n✖ Seed stopped: ${e.message}`);
  process.exit(1);
});
