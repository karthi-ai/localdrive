import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const SESSION_KEY = 'o2k-drive-session';
const THEME_KEY = 'o2k-drive-theme';

const req = async (url, options = {}) => {
  const response = await fetch('/api' + url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const formatSize = (bytes) => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const fileIcon = (file) => {
  if (file.type === 'folder') return '📁';
  const type = (file.type || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(type)) return '🖼️';
  if (['pdf'].includes(type)) return '📕';
  if (['xls', 'xlsx', 'csv'].includes(type)) return '📊';
  if (['doc', 'docx'].includes(type)) return '📘';
  if (['ppt', 'pptx'].includes(type)) return '📙';
  if (['zip', 'rar', '7z'].includes(type)) return '🗜️';
  if (['mp4', 'mov', 'webm'].includes(type)) return '🎞️';
  return '📄';
};

const getTrashExpiryLabel = (deletedAt) => {
  if (!deletedAt) return 'Retention: 30 days';
  const remainingMs = 30 * 24 * 60 * 60 * 1000 - (Date.now() - new Date(deletedAt).getTime());
  if (remainingMs <= 0) return 'Scheduled for permanent delete';
  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `Auto-delete in ${days}d ${hours}h`;
};

function App() {
  const [authorizedRegions, setAuthorizedRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [auth, setAuth] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  });
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'light');
  
  // Login/Reset state
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  
  const [workspace, setWorkspace] = useState(null);
  const [parentId, setParentId] = useState(null);
  const [view, setView] = useState('drive'); // 'drive' | 'trash' | 'admin'
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Admin state
  const [users, setUsers] = useState([]);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [passwordUser, setPasswordUser] = useState(null);
  const [adminNewPassword, setAdminNewPassword] = useState('');

  const isAdmin = auth?.user?.email === 'admin@o2k.local';
  const headers = auth ? { Authorization: 'Bearer ' + auth.token } : {};

  // Fetch workspaces & admin users
  useEffect(() => {
    if (!auth) { setAuthorizedRegions([]); return; }
    req('/projects', { headers })
      .then((projects) => {
        setAuthorizedRegions(projects);
        if (projects.length === 1 && !selectedRegion) {
          setSelectedRegion({ id: projects[0].id, name: projects[0].name, code: projects[0].code });
        }
      })
      .catch((err) => {
        if (String(err.message).includes('Sign in')) setAuth(null);
        else setError('Failed to load workspaces: ' + err.message);
      });
      
    if (isAdmin) {
      req('/admin/users', { headers }).then(setUsers).catch(console.error);
    }
  }, [auth]);

  useEffect(() => {
    if (auth) localStorage.setItem(SESSION_KEY, JSON.stringify(auth));
    else localStorage.removeItem(SESSION_KEY);
  }, [auth]);

  useEffect(() => {
    document.body.classList.toggle('theme-dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');

  const loadWorkspace = async (token = auth?.token, region = selectedRegion, folder = parentId, currentView = view, search = query) => {
    if (!token || !region || currentView === 'admin') return;
    const params = new URLSearchParams();
    if (currentView === 'trash') params.set('trash', '1');
    else if (search) params.set('q', search);
    else if (folder) params.set('parentId', folder);
    const data = await req('/projects/' + region.id + '?' + params.toString(), {
      headers: { Authorization: 'Bearer ' + token }
    });
    setWorkspace(data);
  };

  useEffect(() => {
    if (!auth || !selectedRegion || view === 'admin') return;
    loadWorkspace().catch((err) => {
      if (String(err.message).includes('Sign in')) {
        setAuth(null);
        setSelectedRegion(null);
      } else {
        setError(err.message);
      }
    });
  }, [auth, selectedRegion, parentId, view, query]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), 2400);
  };

  const handleRegionSelect = (region) => {
    setSelectedRegion({ id: region.id, name: region.name, code: region.code });
    setError('');
    setView('drive');
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (authMode === 'login') {
        const result = await req('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        setAuth({ token: result.token, user: result.user });
        setSelectedRegion(null);
        setParentId(null);
        setView('drive');
      } else {
        await req('/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, newPassword })
        });
        showToast('Password reset successfully');
        setAuthMode('login');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    try { await req('/auth/logout', { method: 'POST', headers }); } catch {}
    setAuth(null);
    setSelectedRegion(null);
    setWorkspace(null);
    setParentId(null);
    setPassword('');
  };

  const backToWorkspaces = () => {
    setSelectedRegion(null);
    setWorkspace(null);
    setParentId(null);
    setQuery('');
    setView('drive');
    setError('');
  };

  const createFolder = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await req('/projects/' + selectedRegion.id + '/folders', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName, parentId })
      });
      setFolderOpen(false);
      setFolderName('');
      await loadWorkspace();
      showToast('Folder created');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const form = new FormData();
    files.forEach((file) => form.append('files', file));
    if (parentId) form.append('parentId', parentId);
    setBusy(true);
    setError('');
    try {
      await req('/projects/' + selectedRegion.id + '/files', {
        method: 'POST',
        headers,
        body: form
      });
      setUploadOpen(false);
      await loadWorkspace();
      showToast(files.length === 1 ? 'File uploaded' : files.length + ' files uploaded');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadFile = async (file) => {
    const response = await fetch('/api/files/' + file.id + '/download', { headers });
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const trashFile = async (file) => {
    if (!confirm('Move "' + file.name + '" to trash?')) return;
    await req('/files/' + file.id + '/trash', { method: 'POST', headers });
    await loadWorkspace();
    showToast('Moved to trash');
  };

  const restoreFile = async (file) => {
    await req('/files/' + file.id + '/restore', { method: 'POST', headers });
    await loadWorkspace();
    showToast('Restored to My Drive');
  };

  const deleteForever = async (file) => {
    if (!confirm('Permanently delete "' + file.name + '"? This cannot be undone.')) return;
    await req('/files/' + file.id, { method: 'DELETE', headers });
    await loadWorkspace();
    showToast('Deleted permanently');
  };

  const openItem = (file) => {
    if (file.type === 'folder') {
      setQuery('');
      setView('drive');
      setParentId(file.id);
    } else {
      downloadFile(file).catch((err) => setError(err.message));
    }
  };

  const handleAddUser = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const newUser = await req('/admin/users', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newUserName, email: newUserEmail, password: newUserPassword })
      });
      setUsers([...users, newUser]);
      setAddUserOpen(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserPassword('');
      showToast('User created successfully');
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const changeUserPassword = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await req('/admin/users/' + passwordUser.id + '/password', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: adminNewPassword })
      });
      setPasswordUser(null);
      setAdminNewPassword('');
      showToast('Password changed successfully');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async (user) => {
    if (user.id === auth.user.id) return;
    if (!confirm('Remove ' + user.name + '? Their workspace access and active sessions will be revoked.')) return;
    try {
      await req('/admin/users/' + user.id, { method: 'DELETE', headers });
      setUsers(users.filter((item) => item.id !== user.id));
      showToast('User removed');
    } catch (err) {
      setError(err.message);
    }
  };

  const usedPct = workspace ? Math.min(100, Math.round((workspace.usedBytes / workspace.quotaBytes) * 100)) : 0;
  const files = workspace?.files || [];
  const crumb = useMemo(() => workspace?.path || [], [workspace]);

  // Screen 1: Login / Forgot Password
  if (!auth) {
    return (
      <div className="login">
        <div className="orbit-ring"></div>
        <div className="orbit-ring2"></div>
        
        <div className="cloud-layer">
          <span>☁️</span>
          <span>☁</span>
          <span>⛅</span>
          <span>☁️</span>
          <span>☁</span>
          <span>🌥️</span>
        </div>
        
        <form className="login-card" onSubmit={handleAuth}>
          <div className="login-logo-wrap">
            <div className="o2k-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.29 7 12 12 20.71 7"></polyline>
                <line x1="12" y1="22" x2="12" y2="12"></line>
              </svg>
            </div>
            <div>
              <h1 className="login-title">O2K <span>Drive</span></h1>
              <p className="login-sub">Secure Cloud Workspace</p>
            </div>
          </div>
          
          {error && <div className="error">{error}</div>}
          
          {authMode === 'login' ? (
            <>
              <label>Email Address</label>
              <input autoFocus type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@o2k.local" required />
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Authenticating...' : 'Sign In'}</button>
              <button type="button" className="forgot-link" onClick={() => { setAuthMode('forgot'); setError(''); }}>Forgot Password?</button>
            </>
          ) : (
            <>
              <label>Email Address</label>
              <input autoFocus type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@o2k.local" required />
              <label>New Password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New Password" required />
              <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Resetting...' : 'Reset Password'}</button>
              <button type="button" className="forgot-link" onClick={() => { setAuthMode('login'); setError(''); }}>Back to Sign In</button>
            </>
          )}
          
          <small>Restricted access system. Activity is monitored.</small>
        </form>
      </div>
    );
  }

  // Screen 2: Workspace Selection
  if (!selectedRegion) {
    return (
      <div className="region-entry">
        <div className="entry-top">
          <div className="brand">
            <div className="brandmark">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.29 7 12 12 20.71 7"></polyline>
                <line x1="12" y1="22" x2="12" y2="12"></line>
              </svg>
            </div>
            <span className="brand-text">O2K <span>Drive</span></span>
          </div>
          <div className="entry-actions">
            <button className="theme-toggle" onClick={toggleTheme} aria-label={'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode'}>
              {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </button>
            <button className="signout-top" onClick={signOut}>Sign Out</button>
          </div>
        </div>
        <section>
          <span className="eyebrow">Select Environment</span>
          <h1>Welcome, {auth.user.name}</h1>
          <p>You have access to {authorizedRegions.length} workspace{authorizedRegions.length !== 1 ? 's' : ''}. Select a region to connect.</p>
          {error && <div className="error">{error}</div>}
          {authorizedRegions.length === 0 && !error && <div className="empty">No authorized workspaces found. Contact administrator.</div>}
          
          <div className="region-grid">
            {authorizedRegions.map((region) => (
              <button key={region.id} onClick={() => handleRegionSelect(region)}>
                <span className="r-icon">☁️</span>
                <b>{region.name} Workspace</b>
                <small>Node ID: {region.code}</small>
                <i>→</i>
              </button>
            ))}
            
            {isAdmin && (
              <button className="admin-region-card" onClick={() => { setSelectedRegion({ id: 'admin', name: 'Admin Console' }); setView('admin'); }}>
                <span className="r-icon">⚙️</span>
                <b>System Administration</b>
                <small>Global Control Panel</small>
                <i>→</i>
              </button>
            )}
          </div>
        </section>
      </div>
    );
  }

  // Screen 3: Main App Interface
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
              <polyline points="3.29 7 12 12 20.71 7"></polyline>
              <line x1="12" y1="22" x2="12" y2="12"></line>
            </svg>
          </div>
          <span className="brand-text">O2K <span>Drive</span></span>
        </div>
        
        {view !== 'admin' && <button className="new-btn" onClick={() => setUploadOpen(true)}>+ New Upload</button>}
        
        <div className="project-label">Navigation</div>
        
        {selectedRegion.id !== 'admin' ? (
          <>
            <button className={'nav' + (view === 'drive' ? ' active' : '')} onClick={() => { setView('drive'); setParentId(null); setQuery(''); }}>
              <span className="nav-icon">📁</span> My Drive
            </button>
            <button className={'nav' + (view === 'trash' ? ' active' : '')} onClick={() => { setView('trash'); setQuery(''); }}>
              <span className="nav-icon">🗑️</span> Trash
            </button>
          </>
        ) : (
          <button className={'nav' + (view === 'admin' ? ' active' : '')} onClick={() => setView('admin')}>
            <span className="nav-icon">👥</span> User Management
          </button>
        )}
        
        <div className="project-label">Active Connection</div>
        <button className="project selected" onClick={() => setSelectedRegion(null)}>
          <span className="project-dot"></span>{selectedRegion.name}
        </button>
        
        {selectedRegion.id !== 'admin' && (
          <div className="storage">
            <div className="storage-title">Storage Allocation</div>
            <div className="bar"><i style={{ width: usedPct + '%' }}></i></div>
            <p>{formatSize(workspace?.usedBytes)} of {formatSize(workspace?.quotaBytes)} used</p>
          </div>
        )}
        <div className="storage" style={{borderTop: 'none', padding: '0 10px'}}>
          <button onClick={signOut}>Sign Out Securely</button>
        </div>
      </aside>

      <main
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (view === 'drive') uploadFiles(event.dataTransfer.files);
        }}
      >
        <header>
          <button className="back-workspaces" onClick={backToWorkspaces} title="Back to workspaces" aria-label="Back to workspaces">←</button>
          <div className="mobile-brand">O2K <span>Drive</span></div>
          {view !== 'admin' ? (
            <div className="search">
              <span className="search-icon">🔍</span>
              <input
                placeholder={'Search in ' + selectedRegion.name + '...'}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setView('drive');
                }}
              />
            </div>
          ) : <div style={{flex: 1}}></div>}
          
          <div className="header-actions">
            <button className="theme-toggle" onClick={toggleTheme} aria-label={'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode'}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button className="avatar" title={auth.user.email}>{auth.user.name.slice(0, 2).toUpperCase()}</button>
          </div>
        </header>

        <section className="content">
          {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
          
          {view === 'admin' ? (
            <div className="admin-section">
              <div className="title-row">
                <div>
                  <h1>System Administration</h1>
                  <p><span className="live-dot"></span>Global Access Management</p>
                </div>
                <div className="title-actions">
                  <button className="upload-btn" onClick={() => setAddUserOpen(true)}>+ Create User</button>
                </div>
              </div>

              <div className="user-table">
                <div className="user-table-head">
                  <span>Name</span>
                  <span>Email</span>
                  <span>ID</span>
                  <span>Status</span>
                  <span>Actions</span>
                </div>
                {users.map(u => (
                  <div className="user-table-row" key={u.id}>
                    <b>{u.name}</b>
                    <span>{u.email}</span>
                    <span style={{fontFamily: 'monospace', color: '#64748b'}}>{u.id.split('-')[1] || u.id}</span>
                    <span className={'role-badge ' + (u.email === 'admin@o2k.local' ? 'role-owner' : 'role-editor')}>
                      {u.email === 'admin@o2k.local' ? 'Admin' : 'Active'}
                    </span>
                    <div className="user-actions">
                      <button onClick={() => { setPasswordUser(u); setAdminNewPassword(''); }}>Password</button>
                      {u.id !== auth.user.id && <button className="btn-danger" onClick={() => removeUser(u)}>Remove</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="crumb">
                <button className="crumb-link" onClick={() => { setView('drive'); setParentId(null); setQuery(''); }}>My Drive</button>
                {crumb.map((item) => (
                  <span key={item.id}>
                    <span className="sep">›</span>
                    <button className="crumb-link" onClick={() => { setView('drive'); setParentId(item.id); setQuery(''); }}>{item.name}</button>
                  </span>
                ))}
                {view === 'trash' && <><span className="sep">›</span><b>Trash</b></>}
                {query && <><span className="sep">›</span><b>Search</b></>}
              </div>
              
              <div className="title-row">
                <div>
                  <h1>{view === 'trash' ? 'Trash' : query ? 'Search results' : parentId ? (crumb[crumb.length - 1]?.name || 'Folder') : selectedRegion.name + ' Workspace'}</h1>
                  <p><span className="live-dot"></span>{workspace?.members?.length || 1} team members synced</p>
                </div>
                {view === 'drive' && !query && (
                  <div className="title-actions">
                    <button onClick={() => setFolderOpen(true)}>New Folder</button>
                    <button className="upload-btn" onClick={() => setUploadOpen(true)}>Upload Files</button>
                  </div>
                )}
              </div>
              
              {dragOver && view === 'drive' && <div className="drop-hint">Release to upload files securely</div>}
              
              {view === 'trash' && files.length > 0 && (
                <div className="trash-summary">{getTrashExpiryLabel(files[0]?.deletedAt || new Date().toISOString())}</div>
              )}

              {files.length === 0 ? (
                <div className="empty">{view === 'trash' ? 'No items in trash.' : 'Workspace is empty. Create a folder or drop files here.'}</div>
              ) : (
                <div className="file-list">
                  <div className="list-head">
                    <span>Name</span>
                    <span>Owner</span>
                    <span>Modified</span>
                    <span>Size</span>
                    <span></span>
                  </div>
                  {files.map((file) => (
                    <div key={file.id} className="file-row">
                      <button className="file-name file-open" onClick={() => openItem(file)}>
                        <span>{fileIcon(file)}</span>
                        <span>{file.name}</span>
                        {file.type === 'folder' && <span className="access-tag">DIR</span>}
                      </button>
                      <span>{file.owner}</span>
                      <span>{new Date(file.deletedAt || file.createdAt).toLocaleDateString()}</span>
                      <span>{file.type === 'folder' ? '—' : formatSize(file.size)}</span>
                      <div className="row-actions">
                        {view !== 'trash' && file.type !== 'folder' && (
                          <button onClick={() => downloadFile(file).catch((err) => setError(err.message))}>Download</button>
                        )}
                        {view === 'trash' ? (
                          <>
                            <button onClick={() => restoreFile(file).catch((err) => setError(err.message))}>Restore</button>
                            <button className="btn-danger" onClick={() => deleteForever(file).catch((err) => setError(err.message))}>Delete</button>
                          </>
                        ) : (
                          <button className="btn-danger" onClick={() => trashFile(file).catch((err) => setError(err.message))}>Delete</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* Modals */}
      {folderOpen && (
        <div className="overlay" onClick={() => setFolderOpen(false)}>
          <form className="modal" onClick={(event) => event.stopPropagation()} onSubmit={createFolder}>
            <button type="button" className="close" onClick={() => setFolderOpen(false)}>✕</button>
            <h2>Create Folder</h2>
            <p>Establish a new directory in the current location.</p>
            <label>Folder Name</label>
            <input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="e.g. Design Assets" required />
            <div className="modal-actions">
              <button type="button" onClick={() => setFolderOpen(false)}>Cancel</button>
              <button className="primary" disabled={busy}>{busy ? 'Processing...' : 'Create'}</button>
            </div>
          </form>
        </div>
      )}

      {uploadOpen && (
        <div className="overlay" onClick={() => setUploadOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="close" onClick={() => setUploadOpen(false)}>✕</button>
            <h2>Secure Upload</h2>
            <p>Files are end-to-end encrypted and stored in the {selectedRegion.name} node.</p>
            <label className="dropzone">
              <div className="dropzone-icon">☁️</div>
              <b>Select files or drag them here</b>
              <span>Maximum 200 MB per transmission</span>
              <input type="file" multiple onChange={(event) => uploadFiles(event.target.files)} />
            </label>
          </div>
        </div>
      )}

      {addUserOpen && (
        <div className="overlay" onClick={() => setAddUserOpen(false)}>
          <form className="modal" onClick={(event) => event.stopPropagation()} onSubmit={handleAddUser}>
            <button type="button" className="close" onClick={() => setAddUserOpen(false)}>✕</button>
            <h2>Provision User</h2>
            <p>Create a new account with standard system access.</p>
            <label>Full Name</label>
            <input autoFocus value={newUserName} onChange={e => setNewUserName(e.target.value)} required />
            <label>Email Address</label>
            <input type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} required />
            <label>Initial Password</label>
            <input type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} required />
            <div className="modal-actions">
              <button type="button" onClick={() => setAddUserOpen(false)}>Cancel</button>
              <button className="primary" disabled={busy}>{busy ? 'Provisioning...' : 'Create Account'}</button>
            </div>
          </form>
        </div>
      )}

      {passwordUser && (
        <div className="overlay" onClick={() => setPasswordUser(null)}>
          <form className="modal" onClick={(event) => event.stopPropagation()} onSubmit={changeUserPassword}>
            <button type="button" className="close" onClick={() => setPasswordUser(null)}>✕</button>
            <h2>Change Password</h2>
            <p>Set a new password for {passwordUser.name}.</p>
            <label>New Password</label>
            <input autoFocus type="password" value={adminNewPassword} onChange={(event) => setAdminNewPassword(event.target.value)} placeholder="At least 8 characters" minLength="8" required />
            <div className="modal-actions">
              <button type="button" onClick={() => setPasswordUser(null)}>Cancel</button>
              <button className="primary" disabled={busy}>{busy ? 'Updating...' : 'Change Password'}</button>
            </div>
          </form>
        </div>
      )}

      {toast && <div className="toast">✅ {toast}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
