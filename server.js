const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 5173;
const root = __dirname;
const storeDir = path.join(root, 'data');
const uploadDir = path.join(storeDir, 'uploads');
const dbPath = path.join(storeDir, 'o2k-drive.json');
const isProd = process.env.NODE_ENV === 'production';
const quotaBytes = 10 * 1024 * 1024 * 1024;
const TRASH_RETENTION_DAYS = 30;

fs.mkdirSync(uploadDir, { recursive: true });

const hash = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  value: crypto.scryptSync(password, salt, 64).toString('hex')
});

const verify = (password, stored) => {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash(password, stored.salt).value, 'hex'),
      Buffer.from(stored.value, 'hex')
    );
  } catch {
    return false;
  }
};

const publicFile = ({ diskName, ...file }) => file;

function load() {
  const regions = [
    ['Pune', 'PUN-001'],
    ['NCR', 'NCR-002'],
    ['Kerala', 'KER-003'],
    ['Chennai', 'CHE-004'],
    ['Bangalore', 'BLR-005'],
    ['Hyderabad', 'HYD-006']
  ];
  const db = fs.existsSync(dbPath)
    ? JSON.parse(fs.readFileSync(dbPath, 'utf8'))
    : { users: [], projects: [], files: [], sessions: [] };

  db.users ||= [];
  db.projects ||= [];
  db.files ||= [];
  db.sessions ||= [];

  if (!db.users.some((user) => user.email === 'admin@o2k.local')) {
    db.users.push({
      id: 'u-admin',
      name: 'O2K Administrator',
      email: 'karthickraja@office-2000.com',
      password: hash('O2K@28')
    });
  }

  for (const [name, code] of regions) {
    let project = db.projects.find((item) => item.name === name);
    if (!project) {
      project = {
        id: 'region-' + code.toLowerCase(),
        name,
        code,
        members: [{ userId: 'u-admin', role: 'owner' }]
      };
      db.projects.push(project);
    }
    const email = name.toLowerCase() + '@o2k.local';
    let user = db.users.find((item) => item.email === email);
    if (!user) {
      user = {
        id: 'u-' + name.toLowerCase(),
        name: name + ' Regional Owner',
        email,
        password: hash(name + '@2026')
      };
      db.users.push(user);
    }
    if (!project.members.some((member) => member.userId === user.id)) {
      project.members.push({ userId: user.id, role: 'owner' });
    }
    if (!project.members.some((member) => member.userId === 'u-admin')) {
      project.members.push({ userId: 'u-admin', role: 'owner' });
    }
  }

  for (const file of db.files) {
    if (file.parentId === undefined) file.parentId = null;
    if (file.deletedAt === undefined) file.deletedAt = null;
  }

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
  return db;
}

let db = load();

const cleanupExpiredTrash = () => {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expiredIds = new Set();

  for (const file of db.files) {
    if (file.deletedAt && new Date(file.deletedAt).getTime() <= cutoff) {
      expiredIds.add(file.id);
    }
  }

  if (!expiredIds.size) return;

  for (const file of db.files.filter((item) => expiredIds.has(item.id))) {
    if (file.diskName) {
      const targetPath = path.join(uploadDir, file.diskName);
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    }
  }

  db.files = db.files.filter((file) => !expiredIds.has(file.id));
  save();
};

const save = () => fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
const safe = (value) => String(value || '').replace(/[^a-zA-Z0-9._ -]/g, '_').trim();

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, Date.now() + '-' + (safe(file.originalname) || 'file'))
  }),
  limits: { fileSize: 200 * 1024 * 1024 }
});

function auth(req, res, next) {
  const token = req.header('authorization')?.replace('Bearer ', '') || req.query.token;
  const session = db.sessions.find((item) => item.token === token);
  const user = session && db.users.find((item) => item.id === session.userId);
  if (!user) return res.status(401).json({ error: 'Sign in required' });
  req.user = user;
  req.session = session;
  next();
}

function access(req, res, next) {
  const project = db.projects.find((item) => item.id === req.params.projectId);
  const member = project?.members.find((item) => item.userId === req.user.id);
  if (!member) return res.status(403).json({ error: 'Not authorized for this workspace' });
  req.project = project;
  req.member = member;
  next();
}

function fileAccess(req, res, next) {
  const file = db.files.find((item) => item.id === req.params.fileId);
  const project = file && db.projects.find((item) => item.id === file.projectId);
  const member = project?.members.find((item) => item.userId === req.user.id);
  if (!file || !member) return res.status(403).json({ error: 'File access denied' });
  req.fileRecord = file;
  req.project = project;
  req.member = member;
  next();
}

function usedBytes(projectId) {
  return db.files
    .filter((file) => file.projectId === projectId && file.type !== 'folder' && !file.deletedAt)
    .reduce((sum, file) => sum + (file.size || 0), 0);
}

function descendants(id) {
  const ids = [id];
  for (const file of db.files) {
    if (file.parentId === id) ids.push(...descendants(file.id));
  }
  return ids;
}

function folderPath(file) {
  const pathItems = [];
  let current = file;
  while (current) {
    pathItems.unshift({ id: current.id, name: current.name });
    current = current.parentId ? db.files.find((item) => item.id === current.parentId) : null;
  }
  return pathItems;
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/public/projects', (_req, res) => {
  res.json(
    db.projects
      .filter((project) => project.id.startsWith('region-'))
      .map(({ id, name, code }) => ({ id, name, code }))
  );
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.users.find((item) => item.email.toLowerCase() === email);
  if (!user) return res.status(401).json({ error: 'Account not found' });
  if (!verify(req.body.password || '', user.password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const requested = req.body.projectId && db.projects.find((item) => item.id === req.body.projectId);
  if (requested && !requested.members.some((member) => member.userId === user.id)) {
    return res.status(403).json({ error: 'Your account is not authorized for this region' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  save();
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    projectId: requested?.id || null
  });
});

app.post('/api/auth/logout', auth, (req, res) => {
  db.sessions = db.sessions.filter((item) => item.token !== req.session.token);
  save();
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email });
});

app.post('/api/auth/reset-password', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const newPassword = req.body.newPassword;
  if (!email || !newPassword) return res.status(400).json({ error: 'Email and new password are required' });
  const user = db.users.find((item) => item.email.toLowerCase() === email);
  if (!user) return res.status(404).json({ error: 'Account not found' });
  user.password = hash(newPassword);
  db.sessions = db.sessions.filter(s => s.userId !== user.id);
  save();
  res.json({ ok: true });
});

app.get('/api/admin/users', auth, (req, res) => {
  if (req.user.email !== 'admin@o2k.local') return res.status(403).json({ error: 'Admin access required' });
  res.json(db.users.map(u => ({ id: u.id, name: u.name, email: u.email })));
});

app.post('/api/admin/users', auth, (req, res) => {
  if (req.user.email !== 'admin@o2k.local') return res.status(403).json({ error: 'Admin access required' });
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (db.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: 'This email already has an account' });
  }
  const user = { id: crypto.randomUUID(), name, email, password: hash(password) };
  db.users.push(user);
  
  for (const project of db.projects) {
    if (project.id.startsWith('region-')) {
      project.members.push({ userId: user.id, role: 'viewer' });
    }
  }
  
  save();
  res.status(201).json({ id: user.id, name: user.name, email: user.email });
});

app.patch('/api/admin/users/:userId/password', auth, (req, res) => {
  if (req.user.email !== 'admin@o2k.local') return res.status(403).json({ error: 'Admin access required' });
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const user = db.users.find((item) => item.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.password = hash(newPassword);
  db.sessions = db.sessions.filter((session) => session.userId !== user.id);
  save();
  res.json({ ok: true });
});

app.patch('/api/admin/users/:userId/email', auth, (req, res) => {
  if (req.user.email !== 'admin@o2k.local') return res.status(403).json({ error: 'Admin access required' });
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const user = db.users.find((item) => item.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (db.users.some((item) => item.id !== user.id && item.email.toLowerCase() === email)) {
    return res.status(409).json({ error: 'This email already has an account' });
  }
  user.email = email;
  db.sessions = db.sessions.filter((session) => session.userId !== user.id);
  save();
  res.json({ id: user.id, name: user.name, email: user.email });
});

app.delete('/api/admin/users/:userId', auth, (req, res) => {
  if (req.user.email !== 'admin@o2k.local') return res.status(403).json({ error: 'Admin access required' });
  if (req.params.userId === req.user.id) return res.status(400).json({ error: 'You cannot remove your own admin account' });
  const user = db.users.find((item) => item.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.users = db.users.filter((item) => item.id !== user.id);
  db.sessions = db.sessions.filter((session) => session.userId !== user.id);
  for (const project of db.projects) {
    project.members = project.members.filter((member) => member.userId !== user.id);
  }
  save();
  res.json({ ok: true });
});

app.get('/api/projects', auth, (req, res) => {
  res.json(db.projects.filter((project) => project.members.some((member) => member.userId === req.user.id)));
});

app.get('/api/projects/:projectId', auth, access, (req, res) => {
  cleanupExpiredTrash();
  const parentId = req.query.parentId === undefined ? null : req.query.parentId || null;
  const trash = req.query.trash === '1';
  const query = String(req.query.q || '').trim().toLowerCase();
  let files = db.files.filter((file) => file.projectId === req.project.id);
  if (trash) files = files.filter((file) => file.deletedAt);
  else files = files.filter((file) => !file.deletedAt);
  if (!trash && !query) files = files.filter((file) => (file.parentId || null) === parentId);
  if (query) files = files.filter((file) => file.name.toLowerCase().includes(query));
  files.sort((a, b) => {
    if (a.type === 'folder' && b.type !== 'folder') return -1;
    if (a.type !== 'folder' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });
  const parent = parentId ? db.files.find((file) => file.id === parentId) : null;
  res.json({
    id: req.project.id,
    name: req.project.name,
    code: req.project.code,
    members: req.project.members.map((member) => {
      const user = db.users.find((item) => item.id === member.userId);
      return { id: user.id, name: user.name, email: user.email, role: member.role };
    }),
    parentId,
    path: parent ? folderPath(parent) : [],
    usedBytes: usedBytes(req.project.id),
    quotaBytes,
    files: files.map(publicFile)
  });
});

app.post('/api/projects/:projectId/members', auth, access, (req, res) => {
  if (req.member.role !== 'owner') return res.status(403).json({ error: 'Only owners can grant access' });
  const { name, email, password, role = 'viewer' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (db.users.some((user) => user.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: 'This email already has an account' });
  }
  const user = { id: crypto.randomUUID(), name, email, password: hash(password) };
  db.users.push(user);
  req.project.members.push({ userId: user.id, role });
  save();
  res.status(201).json({ id: user.id, name, email, role });
});

app.post('/api/projects/:projectId/folders', auth, access, (req, res) => {
  const name = safe(req.body.name);
  const parentId = req.body.parentId || null;
  if (!name) return res.status(400).json({ error: 'Folder name is required' });
  if (parentId) {
    const parent = db.files.find((file) => file.id === parentId && file.projectId === req.project.id && file.type === 'folder' && !file.deletedAt);
    if (!parent) return res.status(400).json({ error: 'Parent folder not found' });
  }
  const exists = db.files.some(
    (file) =>
      file.projectId === req.project.id &&
      !file.deletedAt &&
      (file.parentId || null) === parentId &&
      file.name.toLowerCase() === name.toLowerCase()
  );
  if (exists) return res.status(409).json({ error: 'A file or folder with this name already exists here' });
  const folder = {
    id: crypto.randomUUID(),
    projectId: req.project.id,
    parentId,
    name,
    type: 'folder',
    owner: req.user.name,
    size: 0,
    createdAt: new Date().toISOString(),
    deletedAt: null
  };
  db.files.push(folder);
  save();
  res.status(201).json(folder);
});

app.post('/api/projects/:projectId/files', auth, access, upload.array('files', 20), (req, res) => {
  const incoming = req.files?.length ? req.files : req.file ? [req.file] : [];
  if (!incoming.length) return res.status(400).json({ error: 'Choose a file first' });
  const parentId = req.body.parentId || null;
  if (parentId) {
    const parent = db.files.find((file) => file.id === parentId && file.projectId === req.project.id && file.type === 'folder' && !file.deletedAt);
    if (!parent) return res.status(400).json({ error: 'Parent folder not found' });
  }
  const extra = incoming.reduce((sum, file) => sum + file.size, 0);
  if (usedBytes(req.project.id) + extra > quotaBytes) {
    for (const file of incoming) fs.unlink(file.path, () => {});
    return res.status(400).json({ error: 'Workspace storage limit reached' });
  }
  const created = incoming.map((file) => {
    const record = {
      id: crypto.randomUUID(),
      projectId: req.project.id,
      parentId,
      name: file.originalname,
      type: path.extname(file.originalname).slice(1).toLowerCase() || 'file',
      owner: req.user.name,
      size: file.size,
      createdAt: new Date().toISOString(),
      diskName: file.filename,
      deletedAt: null
    };
    db.files.push(record);
    return publicFile(record);
  });
  save();
  res.status(201).json(created);
});

app.patch('/api/files/:fileId', auth, fileAccess, (req, res) => {
  const file = req.fileRecord;
  if (req.body.name) {
    const name = file.type === 'folder' ? safe(req.body.name) : String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    file.name = name;
  }
  if (req.body.parentId !== undefined) {
    const parentId = req.body.parentId || null;
    if (parentId === file.id) return res.status(400).json({ error: 'A folder cannot be moved into itself' });
    if (parentId && descendants(file.id).includes(parentId)) {
      return res.status(400).json({ error: 'Cannot move a folder into one of its subfolders' });
    }
    if (parentId) {
      const parent = db.files.find((item) => item.id === parentId && item.projectId === file.projectId && item.type === 'folder');
      if (!parent) return res.status(400).json({ error: 'Destination folder not found' });
    }
    file.parentId = parentId;
  }
  save();
  res.json(publicFile(file));
});

app.post('/api/files/:fileId/trash', auth, fileAccess, (req, res) => {
  const now = new Date().toISOString();
  for (const id of descendants(req.fileRecord.id)) {
    const file = db.files.find((item) => item.id === id);
    if (file && !file.deletedAt) file.deletedAt = now;
  }
  cleanupExpiredTrash();
  save();
  res.json({ ok: true });
});

app.post('/api/files/:fileId/restore', auth, fileAccess, (req, res) => {
  for (const id of descendants(req.fileRecord.id)) {
    const file = db.files.find((item) => item.id === id);
    if (file) file.deletedAt = null;
  }
  req.fileRecord.parentId = null;
  save();
  res.json(publicFile(req.fileRecord));
});

app.delete('/api/files/:fileId', auth, fileAccess, (req, res) => {
  const ids = new Set(descendants(req.fileRecord.id));
  for (const file of db.files.filter((item) => ids.has(item.id))) {
    if (file.diskName) fs.unlink(path.join(uploadDir, file.diskName), () => {});
  }
  db.files = db.files.filter((item) => !ids.has(item.id));
  save();
  res.json({ ok: true });
});

app.get('/api/files/:fileId/download', auth, fileAccess, (req, res) => {
  const file = req.fileRecord;
  if (file.type === 'folder' || !file.diskName) return res.status(400).json({ error: 'Folders cannot be downloaded' });
  res.download(path.join(uploadDir, file.diskName), file.name);
});

app.use((error, _req, res, next) => {
  if (error && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File is larger than 200 MB' });
  }
  if (error) return res.status(500).json({ error: error.message || 'Server error' });
  next();
});

async function start() {
  if (isProd) {
    app.use(express.static(path.join(root, 'dist')));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  } else {
    const vite = await require('vite').createServer({
      root,
      server: { middlewareMode: true },
      appType: 'custom'
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) return next();
      try {
        const template = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (error) {
        next(error);
      }
    });
  }
  app.listen(port, () => {
    console.log(`O2K Drive running at http://127.0.0.1:${port}`);
  });
}

start();
