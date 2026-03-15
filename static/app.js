// static/app.js
const API_BASE = '/api';

// State
let sessionToken = localStorage.getItem('app_token') || null;
let currentRole = localStorage.getItem('app_role') || 'user';
let currentVMsFetchRef = null;

// Dashboard Filter State
let filterStatus = 'all';
let filterType = 'all';
let groupBy = 'none';
let rawDashboardData = []; // Store raw data for local filtering/grouping

// UI Elements
const themeToggleBtn = document.getElementById('theme-toggle');
const authView = document.getElementById('auth-view');
const authForm = document.getElementById('auth-form');
const authSubmitBtn = document.getElementById('auth-submit');
const authError = document.getElementById('auth-error');
const authSuccess = document.getElementById('auth-success');

const dashboardView = document.getElementById('dashboard-view');
const serversView = document.getElementById('servers-view');
const nodeDetailsView = document.getElementById('node-details-view');

const navLinksDesktop = document.getElementById('nav-links-desktop');
const mobileNav = document.getElementById('mobile-nav');

const navBtnDashboard = document.getElementById('nav-btn-dashboard');
const navBtnServers = document.getElementById('nav-btn-servers');
const navBtnSettings = document.getElementById('nav-btn-settings');

const mobBtnDashboard = document.getElementById('mob-btn-dashboard');
const mobBtnServers = document.getElementById('mob-btn-servers');
const mobBtnSettings = document.getElementById('mob-btn-settings');
const logoutBtn = document.getElementById('logout-btn');
const navBrand = document.getElementById('nav-brand');

const settingsView = document.getElementById('settings-view');
const adminSection = document.getElementById('admin-section');
const userList = document.getElementById('user-list');

const changePassForm = document.getElementById('change-pass-form');
const passSuccess = document.getElementById('pass-success');

const addUserBtn = document.getElementById('show-add-user-btn');
const addUserFormContainer = document.getElementById('add-user-form-container');
const addUserForm = document.getElementById('add-user-form');
const cancelUserBtn = document.getElementById('cancel-user-btn');

const loadingOverlay = document.getElementById('loading-overlay');
const dashboardGrid = document.getElementById('dashboard-grid');
const addServerBtn = document.getElementById('add-server-btn');
const addServerFormContainer = document.getElementById('add-server-form-container');
const addServerForm = document.getElementById('add-server-form');
const cancelSrvBtn = document.getElementById('cancel-srv-btn');

const vmsContainer = document.getElementById('vms-container');
const detailServerName = document.getElementById('detail-server-name');
const detailNodeName = document.getElementById('detail-node-name');
const detailVmCount = document.getElementById('detail-vm-count');
const backToDashboardBtn = document.getElementById('back-to-dashboard');

// Theme Management
function initTheme() {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}
themeToggleBtn.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    localStorage.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
});
initTheme();

// Helpers
function showLoading(show) {
    if (show) loadingOverlay.classList.remove('hidden');
    else setTimeout(() => loadingOverlay.classList.add('hidden'), 200);
}

function updateActiveNav(activeView) {
    // Desktop Nav
    [navBtnDashboard, navBtnServers, navBtnSettings].forEach(btn => btn.classList.remove('active-view'));
    if (activeView === 'dashboard-view') navBtnDashboard.classList.add('active-view');
    else if (activeView === 'servers-view') navBtnServers.classList.add('active-view');
    else if (activeView === 'settings-view') navBtnSettings.classList.add('active-view');

    // Mobile Nav
    const mobBtns = [mobBtnDashboard, mobBtnServers, mobBtnSettings];
    mobBtns.forEach(btn => {
        btn.classList.remove('active-view', 'bg-blue-500/10', 'text-blue-500');
        btn.classList.add('text-slate-500', 'dark:text-slate-400');
    });

    let activeMobBtn = null;
    if (activeView === 'dashboard-view') activeMobBtn = mobBtnDashboard;
    else if (activeView === 'servers-view') activeMobBtn = mobBtnServers;
    else if (activeView === 'settings-view') activeMobBtn = mobBtnSettings;

    if (activeMobBtn) {
        activeMobBtn.classList.remove('text-slate-500', 'dark:text-slate-400');
        activeMobBtn.classList.add('active-view', 'bg-blue-500/10', 'text-blue-500');
    }
}

function switchView(viewId) {
    authView.classList.add('hidden');
    dashboardView.classList.add('hidden');
    serversView.classList.add('hidden');
    nodeDetailsView.classList.add('hidden');
    settingsView.classList.add('hidden');
    document.getElementById(viewId).classList.remove('hidden');
    
    // Auto-sync nav
    if (viewId === 'dashboard-view' || viewId === 'servers-view' || viewId === 'settings-view') {
        updateActiveNav(viewId);
    }
}

function updateNav() {
    if (sessionToken) {
        // Keep hidden so it stays hidden on mobile, add md:flex to show on desktop
        navLinksDesktop.classList.add('hidden', 'md:flex');
        mobileNav.classList.remove('hidden');
        
        logoutBtn.classList.remove('hidden');
        if (currentRole === 'admin') {
            adminSection.classList.remove('hidden');
        } else {
            adminSection.classList.add('hidden');
        }
        switchView('dashboard-view');
        loadDashboard();
    } else {
        navLinksDesktop.classList.add('hidden');
        navLinksDesktop.classList.remove('md:flex');
        mobileNav.classList.add('hidden');
        
        logoutBtn.classList.add('hidden');
        switchView('auth-view');
    }
}

async function fetchWithAuth(url, options = {}) {
    if (!sessionToken) throw new Error("No token available");
    const headers = {
        'Authorization': `Bearer ${sessionToken}`,
        ...options.headers
    };
    const response = await fetch(`${API_BASE}${url}`, { ...options, headers });
    if (response.status === 401) {
        sessionToken = null;
        localStorage.removeItem('app_token');
        updateNav();
        throw new Error("Session expired. Please sign in again.");
    }
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "API Request Failed");
    }
    return response.json();
}

// Navigation Listeners
navBtnDashboard.addEventListener('click', () => { switchView('dashboard-view'); loadDashboard(); });
navBtnServers.addEventListener('click', () => { switchView('servers-view'); loadServers(); });
navBtnSettings.addEventListener('click', () => { switchView('settings-view'); if(currentRole === 'admin') loadUsers(); });

mobBtnDashboard.addEventListener('click', () => { switchView('dashboard-view'); loadDashboard(); });
mobBtnServers.addEventListener('click', () => { switchView('servers-view'); loadServers(); });
mobBtnSettings.addEventListener('click', () => { switchView('settings-view'); if(currentRole === 'admin') loadUsers(); });

backToDashboardBtn.addEventListener('click', () => { switchView('dashboard-view'); loadDashboard(); });
navBrand.addEventListener('click', () => { if(sessionToken) { switchView('dashboard-view'); loadDashboard(); }});

// Filter Listeners
// Filter Listeners (Pill Buttons)
function initPillFilters() {
    ['status', 'type'].forEach(filter => {
        const container = document.getElementById(`${filter}-pills`);
        container.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                container.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Update internal state
                const val = btn.getAttribute('data-value');
                if (filter === 'status') filterStatus = val;
                else filterType = val;
                
                // Re-render current detail view if visible
                if (!nodeDetailsView.classList.contains('hidden')) {
                    renderDetailVMs();
                }
            });
        });
    });
}
initPillFilters();

document.getElementById('group-by').addEventListener('change', (e) => { groupBy = e.target.value; renderDashboard(); });

// Authentication
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    if (authSuccess) authSuccess.classList.add('hidden');
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;
    
    const ogHtml = authSubmitBtn.innerHTML;
    authSubmitBtn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> <span>Authenticating...</span>';
    authSubmitBtn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE}/app/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        let data;
        try {
            data = await response.json();
        } catch (parseError) {
            throw new Error(`Server Error (${response.status}): The server encountered a crash or unhandled error.`);
        }
        
        if (!response.ok) throw new Error(data.detail || 'Authentication failed');
        
        sessionToken = data.token;
        currentRole = data.role || 'user';
        localStorage.setItem('app_token', sessionToken);
        localStorage.setItem('app_role', currentRole);
        
        if (authSuccess) {
            authSuccess.textContent = "Authentication successful! Redirecting...";
            authSuccess.classList.remove('hidden');
        }
        
        // Brief delay so user can read the success message
        setTimeout(() => {
            updateNav();
        }, 800);
        
    } catch (err) {
        authError.textContent = err.message;
        authError.classList.remove('hidden');
        authForm.classList.add('animate-pulse');
        setTimeout(() => authForm.classList.remove('animate-pulse'), 500);
    } finally {
        authSubmitBtn.innerHTML = ogHtml;
        authSubmitBtn.disabled = false;
    }
});

logoutBtn.addEventListener('click', () => {
    if(sessionToken) fetch(`${API_BASE}/app/logout`, { headers: {'Authorization': `Bearer ${sessionToken}`} }).catch(()=>{});
    sessionToken = null;
    currentRole = 'user';
    localStorage.removeItem('app_token');
    localStorage.removeItem('app_role');
    updateNav();
});

// Add Server
addServerBtn.addEventListener('click', () => {
    document.getElementById('edit-srv-id').value = '';
    document.getElementById('form-title').innerHTML = '<i class="ph-fill ph-plus-circle text-blue-500"></i> Combine New Instance';
    addServerForm.reset();
    addServerFormContainer.classList.remove('hidden');
});
cancelSrvBtn.addEventListener('click', () => {
    addServerFormContainer.classList.add('hidden');
    document.getElementById('srv-error').classList.add('hidden');
});

addServerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save-srv-btn');
    const errBox = document.getElementById('srv-error');
    errBox.classList.add('hidden');
    
    const payload = {
        name: document.getElementById('srv-name').value,
        host: document.getElementById('srv-host').value,
        pve_username: document.getElementById('srv-username').value,
        pve_password: document.getElementById('srv-password').value,
        verify_ssl: document.getElementById('srv-verify-ssl').checked
    };
    
    const ogHtml = btn.innerHTML;
    btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> Connecting...';
    btn.disabled = true;
    
    try {
        const srvId = document.getElementById('edit-srv-id').value;
        const endpoint = srvId ? `/servers/${srvId}` : '/servers';
        const method = srvId ? 'PUT' : 'POST';

        await fetchWithAuth(endpoint, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        addServerForm.reset();
        addServerFormContainer.classList.add('hidden');
        loadServers(); // Reload list
    } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
    } finally {
        btn.innerHTML = ogHtml;
        btn.disabled = false;
    }
});

async function deleteServer(id) {
    if(!confirm('Are you sure you want to remove this server link?')) return;
    try {
        await fetchWithAuth(`/servers/${id}`, { method: 'DELETE' });
        loadServers();
    } catch (err) {
        alert("Deletion failed: " + err.message);
    }
}

async function editServer(id) {
    try {
        const servers = await fetchWithAuth('/servers');
        const s = servers.find(x => x.id === id);
        if(!s) return;
        
        document.getElementById('edit-srv-id').value = s.id;
        document.getElementById('form-title').innerHTML = '<i class="ph-fill ph-pencil-simple text-blue-500"></i> Adjust Connection';
        document.getElementById('srv-name').value = s.name;
        document.getElementById('srv-host').value = s.host;
        document.getElementById('srv-username').value = s.pve_username;
        document.getElementById('srv-password').value = ''; // Plain text for security
        document.getElementById('srv-verify-ssl').checked = s.verify_ssl;
        
        addServerFormContainer.classList.remove('hidden');
        addServerFormContainer.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        alert("Edit failed: " + err.message);
    }
}

// Data Loaders
async function loadServers() {
    const list = document.getElementById('server-list');
    list.innerHTML = '<div class="text-center py-6 text-slate-500"><i class="ph ph-circle-notch animate-spin text-2xl mb-2"></i><br>Loading nodes...</div>';
    try {
        const servers = await fetchWithAuth('/servers');
        if (servers.length === 0) {
            list.innerHTML = '<div class="glass-card p-6 rounded-2xl border glass-border text-center text-slate-500 shadow-sm">No Proxmox servers have been configured yet.</div>';
            return;
        }
        list.innerHTML = '';
        servers.forEach(s => {
            const el = document.createElement('div');
            el.className = "glass-card p-5 rounded-2xl border glass-border flex justify-between items-center shadow-sm hover:shadow-md transition";
            el.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
                        <i class="ph-fill ph-hard-drives text-2xl"></i>
                    </div>
                    <div>
                        <div class="font-semibold text-lg leading-tight mb-0.5">${s.name}</div>
                        <div class="text-xs text-slate-500 dark:text-slate-400 font-medium">${s.host} <span class="mx-1">•</span> ${s.pve_username}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="editServer(${s.id})" class="p-2 text-blue-500 hover:bg-blue-500/10 rounded-xl transition" title="Edit Server">
                        <i class="ph-bold ph-pencil-simple text-lg"></i>
                    </button>
                    <button onclick="deleteServer(${s.id})" class="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition" title="Remove Server">
                        <i class="ph-bold ph-trash text-lg"></i>
                    </button>
                </div>
            `;
            list.appendChild(el);
        });
    } catch (err) {
        list.innerHTML = `<div class="bg-red-500/10 text-red-500 p-4 rounded-xl text-sm border border-red-500/20">${err.message}</div>`;
    }
}

async function loadDashboard() {
    try {
        rawDashboardData = await fetchWithAuth('/dashboard');
        renderDashboard();
    } catch (err) {
        dashboardGrid.innerHTML = `<div class="col-span-full border border-red-500/20 text-red-500 bg-red-500/10 rounded-2xl p-6 text-center font-medium shadow-sm w-full">${err.message}</div>`;
    }
}

function renderDashboard() {
    dashboardGrid.innerHTML = '';
    
    if (rawDashboardData.length === 0) {
        dashboardGrid.innerHTML = '<div class="glass-card col-span-full text-center py-16 rounded-3xl border glass-border shadow-sm"><div class="w-20 h-20 bg-slate-200 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400"><i class="ph-fill ph-hard-drives text-3xl"></i></div><h3 class="text-xl font-semibold mb-2">No Active Links</h3><p class="text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">Connect your first Proxmox environment to start monitoring your infrastructure.</p><button onclick="switchView(\'servers-view\'); loadServers(); addServerFormContainer.classList.remove(\'hidden\')" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium shadow-lg shadow-blue-500/20 transition">Add First Server</button></div>';
        return;
    }

    // Processing data: Grouping Only
    let processedData = JSON.parse(JSON.stringify(rawDashboardData)); // Deep copy


    // Grouping Logic
    if (groupBy === 'status') {
        const onlineServers = processedData.filter(s => s.status === 'online');
        const offlineServers = processedData.filter(s => s.status !== 'online');
        
        if (onlineServers.length > 0) {
            const div = document.createElement('div');
            div.className = 'col-span-full mt-4 mb-2';
            div.innerHTML = `<h3 class="text-lg font-bold text-green-500 flex items-center gap-2"><i class="ph-fill ph-check-circle"></i> Online Environments</h3>`;
            dashboardGrid.appendChild(div);
            renderCards(onlineServers);
        }
        
        if (offlineServers.length > 0) {
            const div = document.createElement('div');
            div.className = 'col-span-full mt-8 mb-2';
            div.innerHTML = `<h3 class="text-lg font-bold text-red-500 flex items-center gap-2"><i class="ph-fill ph-warning-circle"></i> Offline / Unreachable</h3>`;
            dashboardGrid.appendChild(div);
            renderCards(offlineServers);
        }
    } else if (groupBy === 'server') {
        // Already grouped by server naturally in processedData
        renderCards(processedData);
    } else {
        renderCards(processedData);
    }
}

function renderCards(servers) {
    servers.forEach((srv, i) => {
        const card = document.createElement('div');
        card.className = "glass-card p-5 lg:p-6 rounded-3xl border glass-border shadow-xl hover:shadow-2xl transition-all duration-300 flex flex-col h-full animate-fade-in";
        card.style.animationDelay = `${i * 80}ms`;
        
        let nodesHtml = '';
        if (srv.status === 'online' && srv.nodes && srv.nodes.length > 0) {
            srv.nodes.forEach(n => {
                const isOnline = n.status === 'online';
                const cpuPercent = Math.round((n.cpu || 0) * 100);
                const memPercent = n.maxmem ? Math.round((n.mem / n.maxmem) * 100) : 0;
                
                const cpuColor = cpuPercent > 85 ? 'bg-red-500' : (cpuPercent > 60 ? 'bg-amber-500' : 'bg-blue-500');
                const memColor = memPercent > 85 ? 'bg-red-500' : (memPercent > 60 ? 'bg-amber-500' : 'bg-purple-500');
                
                nodesHtml += `
                    <div class="mt-4 p-4 bg-white/40 dark:bg-slate-800/40 rounded-2xl cursor-pointer hover:bg-white/60 dark:hover:bg-slate-700/60 transition shadow-sm group border border-transparent hover:border-slate-300 dark:hover:border-slate-600" onclick="loadNodeVMs(${srv.id}, '${srv.name}', '${n.node}')">
                        <div class="flex justify-between items-center mb-4">
                            <div class="font-semibold text-[15px] flex items-center gap-2">
                                <span class="w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500'}"></span>
                                ${n.node}
                            </div>
                            <div class="text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 bg-slate-200 dark:bg-slate-800 px-2 py-1 rounded-md flex items-center gap-1 group-hover:text-blue-500 group-hover:bg-blue-500/10 transition-colors"><span>VIEW</span> <i class="ph-bold ph-caret-right"></i></div>
                        </div>
                        ${isOnline ? `
                        <div class="space-y-3">
                            <div>
                                <div class="flex justify-between text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 mb-1.5 uppercase">
                                    <span>CPU Load</span>
                                    <span class="${cpuPercent > 85 ? 'text-red-500 font-bold' : ''}">${cpuPercent}%</span>
                                </div>
                                <div class="w-full bg-slate-200 dark:bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
                                    <div class="${cpuColor} h-1.5 rounded-full transition-all duration-1000" style="width: ${cpuPercent}%"></div>
                                </div>
                            </div>
                            <div>
                                <div class="flex justify-between text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400 mb-1.5 uppercase">
                                    <span>Memory Allocation</span>
                                    <span class="${memPercent > 85 ? 'text-red-500 font-bold' : ''}">${memPercent}%</span>
                                </div>
                                <div class="w-full bg-slate-200 dark:bg-slate-700/50 rounded-full h-1.5 overflow-hidden">
                                    <div class="${memColor} h-1.5 rounded-full transition-all duration-1000" style="width: ${memPercent}%"></div>
                                </div>
                            </div>
                        </div>
                        ` : '<div class="text-xs text-red-500 font-medium py-3 text-center bg-red-500/10 rounded-xl my-2 border border-red-500/20">Node is Offline / Unreachable</div>'}
                    </div>
                `;
            });
        } else if (srv.status === 'offline') {
            nodesHtml = '<div class="mt-4 text-red-500 text-sm text-center py-6 border border-red-500/20 bg-red-500/10 rounded-2xl font-medium">Link Unreachable.<br><span class="text-xs opacity-80 font-normal">Check host availability and credentials.</span></div>';
        } else {
            nodesHtml = '<div class="mt-4 text-slate-500 text-sm text-center py-6 border border-slate-300 dark:border-slate-700 rounded-2xl">No compute nodes found.</div>';
        }
        
        card.innerHTML = `
            <div class="flex justify-between items-start mb-4">
                <div>
                    <div class="font-bold text-xl tracking-tight mb-1 text-slate-800 dark:text-white">${srv.name}</div>
                    <div class="text-xs font-semibold ${srv.status === 'online' ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10'} px-2.5 py-1 rounded-md inline-flex items-center gap-1.5 border ${srv.status === 'online' ? 'border-green-500/20' : 'border-red-500/20'}">
                        <span class="w-1.5 h-1.5 rounded-full ${srv.status === 'online' ? 'bg-green-500' : 'bg-red-500'}"></span>
                        ${srv.status.toUpperCase()}
                    </div>
                </div>
            </div>
            
            ${srv.status === 'online' ? `
            <div class="grid grid-cols-2 gap-3 mt-1 mb-2">
                <div class="bg-white/50 dark:bg-slate-800/60 p-3 rounded-2xl border border-white/40 dark:border-slate-700/50">
                    <div class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5 uppercase tracking-wider flex items-center gap-1"><i class="ph-fill ph-play-circle text-green-500"></i> Running VMs</div>
                    <div class="text-2xl font-bold">${srv.vms_running}</div>
                </div>
                <div class="bg-white/50 dark:bg-slate-800/60 p-3 rounded-2xl border border-white/40 dark:border-slate-700/50">
                    <div class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-0.5 uppercase tracking-wider flex items-center gap-1"><i class="ph-fill ph-stack text-blue-500"></i> Total VMs</div>
                    <div class="text-2xl font-bold">${srv.vms_total}</div>
                </div>
            </div>
            ` : ''}
            
            <div class="flex-1 mt-1">
                ${nodesHtml}
            </div>
        `;
        dashboardGrid.appendChild(card);
    });
}

function formatMemory(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor(seconds % (3600*24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

async function loadNodeVMs(serverId, serverName, nodeName) {
    switchView('node-details-view');
    detailServerName.textContent = serverName;
    detailNodeName.textContent = nodeName;
    showLoading(true);
    vmsContainer.innerHTML = '';
    detailVmCount.textContent = '...';
    
    const fetchRef = Symbol('fetchVMs');
    currentVMsFetchRef = fetchRef;
    
    try {
        currentRawVMs = await fetchWithAuth(`/servers/${serverId}/nodes/${nodeName}/vms`);
        if (currentVMsFetchRef !== fetchRef) return;
        renderDetailVMs();
    } catch (err) {
        vmsContainer.innerHTML = `<div class="col-span-full border border-red-500/20 text-red-500 bg-red-500/10 rounded-2xl p-6 text-center font-medium shadow-sm w-full">${err.message}</div>`;
    } finally {
        showLoading(false);
    }
}

let currentRawVMs = [];
function renderDetailVMs() {
    vmsContainer.innerHTML = '';
    
    // Apply filters locally
    let vms = currentRawVMs.filter(v => {
        if (filterStatus !== 'all') {
            const isRunning = v.status === 'running';
            if (filterStatus === 'running' && !isRunning) return false;
            if (filterStatus === 'stopped' && isRunning) return false;
        }
        if (filterType !== 'all' && v.type !== filterType) return false;
        return true;
    });

    detailVmCount.textContent = vms.length;
    
    if (vms.length === 0) {
        vmsContainer.innerHTML = '<div class="col-span-full text-center py-16 glass-card border glass-border rounded-3xl shadow-sm"><div class="text-slate-400 font-medium mb-2"><i class="ph-fill ph-ghost text-4xl mb-2"></i><br>No Compute Resources</div><p class="text-sm text-slate-500">There are no virtual machines matching your filters.</p></div>';
        return;
    }

    vms.forEach((vm, i) => {
        const isRunning = vm.status === 'running';
        const memPercent = (vm.mem && vm.maxmem) ? Math.round((vm.mem / vm.maxmem) * 100) : 0;
        const cpuPercent = Math.round((vm.cpu || 0) * 100);
        
        const card = document.createElement('div');
        card.className = `glass-card p-4 rounded-2xl border hover:shadow-lg transition relative animate-fade-in ${isRunning ? 'glass-border hover:border-blue-500/30' : 'border-slate-200 dark:border-slate-800 opacity-75'}`;
        card.style.animationDelay = `${i * 40}ms`;
        
        card.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3 w-full">
                    <div class="relative shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${isRunning ? (vm.type === 'qemu' ? 'bg-indigo-500/10 text-indigo-500' : 'bg-orange-500/10 text-orange-500') : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}">
                        <i class="ph-fill ${vm.type === 'qemu' ? 'ph-desktop' : 'ph-package'} text-2xl"></i>
                        <span class="absolute -bottom-1 -right-1 w-3.5 h-3.5 border-2 border-white dark:border-slate-800 rounded-full ${isRunning ? 'bg-green-500' : 'bg-red-500'}"></span>
                    </div>
                    
                    <div class="flex-1 min-w-0 pr-2">
                        <div class="flex items-center gap-2 mb-0.5">
                            <h4 class="font-semibold text-[15px] truncate text-slate-800 dark:text-slate-100">${vm.name || 'VM_'+vm.vmid}</h4>
                            <span class="shrink-0 text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded-md bg-white/50 dark:bg-slate-800/50 text-slate-500 shadow-sm border border-slate-200 dark:border-slate-700">ID: ${vm.vmid}</span>
                        </div>
                        
                        <div class="flex items-center gap-3 mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            ${isRunning ? `
                                <div class="flex items-center gap-1 bg-white/30 dark:bg-slate-800/30 px-2 py-0.5 rounded flex-1 justify-center"><i class="ph-fill ph-cpu text-blue-500"></i> ${cpuPercent}%</div>
                                <div class="flex items-center gap-1 bg-white/30 dark:bg-slate-800/30 px-2 py-0.5 rounded flex-1 justify-center"><i class="ph-fill ph-memory text-purple-500"></i> ${formatMemory(vm.maxmem)}</div>
                                <div class="flex items-center gap-1 ml-auto bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-0.5 rounded whitespace-nowrap"><i class="ph-fill ph-clock"></i> ${formatUptime(vm.uptime)}</div>
                            ` : `
                                <span class="text-red-500 bg-red-500/10 px-2 py-0.5 rounded-md font-semibold">Halted</span>
                            `}
                        </div>
                    </div>
                </div>
            </div>
            
            ${isRunning ? `
            <div class="w-full h-1 bg-slate-200 dark:bg-slate-700/50 absolute bottom-0 left-0 rounded-b-2xl overflow-hidden">
                <div class="h-1 bg-gradient-to-r from-blue-500 to-purple-500" style="width: ${(cpuPercent + memPercent)/2}%"></div>
            </div>
            ` : ''}
        `;
        
        vmsContainer.appendChild(card);
    });
}

// User Management Logic
async function loadUsers() {
    userList.innerHTML = '<div class="text-center py-4"><i class="ph ph-circle-notch animate-spin"></i></div>';
    try {
        const users = await fetchWithAuth('/admin/users');
        userList.innerHTML = '';
        users.forEach(u => {
            const el = document.createElement('div');
            el.className = "flex justify-between items-center p-4 bg-white/30 dark:bg-slate-800/30 rounded-2xl border glass-border";
            el.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                        <i class="ph ph-user text-xl"></i>
                    </div>
                    <div>
                        <div class="font-bold text-sm">${u.username}</div>
                        <div class="text-[10px] uppercase font-bold tracking-wider ${u.role === 'admin' ? 'text-purple-500' : 'text-slate-500'}">${u.role}</div>
                    </div>
                </div>
                ${u.username !== 'admin' ? `
                    <button class="text-xs font-bold text-red-400 hover:text-red-500 transition px-3 py-1 bg-red-500/5 hover:bg-red-500/10 rounded-lg border border-red-500/10">DELETE</button>
                ` : '<span class="text-[10px] font-bold text-slate-400">SYSTEM</span>'}
            `;
            userList.appendChild(el);
        });
    } catch (err) {
        userList.innerHTML = `<div class="text-xs text-red-500 p-3">${err.message}</div>`;
    }
}

changePassForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const new_password = document.getElementById('new-password').value;
    try {
        await fetchWithAuth('/users/me/password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_password })
        });
        passSuccess.classList.remove('hidden');
        changePassForm.reset();
        setTimeout(() => passSuccess.classList.add('hidden'), 3000);
    } catch (err) {
        alert("Failed to update password: " + err.message);
    }
});

addUserBtn.addEventListener('click', () => addUserFormContainer.classList.remove('hidden'));
cancelUserBtn.addEventListener('click', () => {
    addUserFormContainer.classList.add('hidden');
    addUserForm.reset();
});

addUserForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('new-user-name').value;
    const password = document.getElementById('new-user-pass').value;
    const role = document.getElementById('new-user-role').value;
    
    try {
        await fetchWithAuth('/admin/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        addUserForm.reset();
        addUserFormContainer.classList.add('hidden');
        loadUsers();
    } catch (err) {
        alert("Failed to create user: " + err.message);
    }
});

// Run init
updateNav();
