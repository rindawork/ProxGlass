// static/app.js
const API_BASE = '/api';

// State
let sessionToken = localStorage.getItem('app_token') || null;
let currentVMsFetchRef = null;
let isRegisterMode = false;

// UI Elements
const authView = document.getElementById('auth-view');
const authForm = document.getElementById('auth-form');
const authSubmitBtn = document.getElementById('auth-submit');
const authToggleBtn = document.getElementById('auth-toggle-btn');
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const authError = document.getElementById('auth-error');

const dashboardView = document.getElementById('dashboard-view');
const serversView = document.getElementById('servers-view');
const nodeDetailsView = document.getElementById('node-details-view');

const navBtnDashboard = document.getElementById('nav-btn-dashboard');
const navBtnServers = document.getElementById('nav-btn-servers');
const logoutBtn = document.getElementById('logout-btn');

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

// Helpers
function showLoading(show) {
    if (show) loadingOverlay.classList.remove('hidden');
    else setTimeout(() => loadingOverlay.classList.add('hidden'), 200);
}

function switchView(viewId) {
    authView.classList.add('hidden');
    dashboardView.classList.add('hidden');
    serversView.classList.add('hidden');
    nodeDetailsView.classList.add('hidden');
    document.getElementById(viewId).classList.remove('hidden');
}

function updateNav() {
    if (sessionToken) {
        navBtnDashboard.classList.remove('hidden');
        navBtnServers.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');
        switchView('dashboard-view');
        loadDashboard();
    } else {
        navBtnDashboard.classList.add('hidden');
        navBtnServers.classList.add('hidden');
        logoutBtn.classList.add('hidden');
        switchView('auth-view');
    }
}

async function fetchWithAuth(url, options = {}) {
    if (!sessionToken) throw new Error("AUTH_ERR // NO_TOKEN");
    const headers = {
        'Authorization': `Bearer ${sessionToken}`,
        ...options.headers
    };
    const response = await fetch(`${API_BASE}${url}`, { ...options, headers });
    if (response.status === 401) {
        sessionToken = null;
        localStorage.removeItem('app_token');
        updateNav();
        throw new Error("AUTH_ERR // TOKEN_EXPIRED");
    }
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "SYS_ERR // UNKNOWN");
    }
    return response.json();
}

// Navigation Listeners
navBtnDashboard.addEventListener('click', () => { switchView('dashboard-view'); loadDashboard(); });
navBtnServers.addEventListener('click', () => { switchView('servers-view'); loadServers(); });
backToDashboardBtn.addEventListener('click', () => { switchView('dashboard-view'); loadDashboard(); });

// Authentication
authToggleBtn.addEventListener('click', () => {
    isRegisterMode = !isRegisterMode;
    if (isRegisterMode) {
        authTitle.textContent = "REG_REQ";
        authSubtitle.textContent = "Establish new local operator profile";
        authSubmitBtn.textContent = "REGISTER";
        authToggleBtn.textContent = "<< Return to local auth";
    } else {
        authTitle.textContent = "AUTH_REQ";
        authSubtitle.textContent = "Establish secure local terminal session";
        authSubmitBtn.textContent = "INITIALIZE";
        authToggleBtn.textContent = ">> Switch to Network Registration";
    }
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.classList.add('hidden');
    const username = document.getElementById('auth-username').value;
    const password = document.getElementById('auth-password').value;
    
    authSubmitBtn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> SYNCING...';
    authSubmitBtn.disabled = true;
    
    try {
        const endpoint = isRegisterMode ? '/app/register' : '/app/login';
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Auth failed');
        
        if (isRegisterMode) {
            // Auto login after register
            const loginResp = await fetch(`${API_BASE}/app/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const loginData = await loginResp.json();
            if (!loginResp.ok) throw new Error(loginData.detail);
            sessionToken = loginData.token;
        } else {
            sessionToken = data.token;
        }
        
        localStorage.setItem('app_token', sessionToken);
        updateNav();
    } catch (err) {
        authError.textContent = err.message;
        authError.classList.remove('hidden');
        authForm.classList.add('animate-pulse');
        setTimeout(() => authForm.classList.remove('animate-pulse'), 500);
    } finally {
        authSubmitBtn.textContent = isRegisterMode ? "REGISTER" : "INITIALIZE";
        authSubmitBtn.disabled = false;
    }
});

logoutBtn.addEventListener('click', () => {
    if(sessionToken) fetch(`${API_BASE}/app/logout`, { headers: {'Authorization': `Bearer ${sessionToken}`} }).catch(()=>{});
    sessionToken = null;
    localStorage.removeItem('app_token');
    updateNav();
});

// Add Server
addServerBtn.addEventListener('click', () => {
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
    
    btn.innerHTML = '<i class="ph ph-circle-notch animate-spin"></i> PROBING...';
    btn.disabled = true;
    
    try {
        await fetchWithAuth('/servers', {
            method: 'POST',
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
        btn.textContent = "ESTABLISH LINK";
        btn.disabled = false;
    }
});

async function deleteServer(id) {
    if(!confirm('TERMINATE THIS LINK?')) return;
    try {
        await fetchWithAuth(`/servers/${id}`, { method: 'DELETE' });
        loadServers();
    } catch (err) {
        alert("FAIL // " + err.message);
    }
}

// Data Loaders
async function loadServers() {
    const list = document.getElementById('server-list');
    list.innerHTML = '<div class="text-cyan font-mono animate-pulse">FETCHING_LINKS...</div>';
    try {
        const servers = await fetchWithAuth('/servers');
        if (servers.length === 0) {
            list.innerHTML = '<div class="cyber-card text-center text-cyan-dim font-mono py-8">NO UPLINKS ESTABLISHED.</div>';
            return;
        }
        list.innerHTML = '';
        servers.forEach(s => {
            const el = document.createElement('div');
            el.className = "cyber-card flex justify-between items-center";
            el.innerHTML = `
                <div>
                    <div class="font-bold text-lg text-cyan font-mono">${s.name}</div>
                    <div class="text-xs text-cyan-dim font-mono">${s.host} // ${s.pve_username}</div>
                </div>
                <button onclick="deleteServer(${s.id})" class="cyber-btn danger text-xs py-1 px-3">TERMINATE</button>
            `;
            list.appendChild(el);
        });
    } catch (err) {
        list.innerHTML = `<div class="text-magenta font-mono">${err.message}</div>`;
    }
}

async function loadDashboard() {
    dashboardGrid.innerHTML = '<div class="col-span-full text-center py-10"><i class="ph ph-circle-notch animate-spin text-3xl text-cyan mb-2"></i><br><span class="text-cyan font-mono animate-pulse">GATHERING_FLEET_TELEMETRY...</span></div>';
    
    try {
        const dashData = await fetchWithAuth('/dashboard');
        dashboardGrid.innerHTML = '';
        
        if (dashData.length === 0) {
            dashboardGrid.innerHTML = '<div class="cyber-card col-span-full text-center py-12"><div class="text-xl text-cyan-dim font-mono mb-4">NO ACTIVE UPLINKS</div><button onclick="switchView(\\'servers-view\\'); loadServers(); addServerFormContainer.classList.remove(\\'hidden\\')" class="cyber-btn py-2 px-6">CONFIGURE NEW UPLINK</button></div>';
            return;
        }
        
        dashData.forEach(srv => {
            const card = document.createElement('div');
            card.className = "cyber-card flex flex-col h-full";
            
            let nodesHtml = '';
            if (srv.status === 'online' && srv.nodes.length > 0) {
                srv.nodes.forEach(n => {
                    const isOnline = n.status === 'online';
                    const cpuPercent = Math.round((n.cpu || 0) * 100);
                    const memPercent = n.maxmem ? Math.round((n.mem / n.maxmem) * 100) : 0;
                    
                    const cpuColor = cpuPercent > 85 ? 'bar-red' : (cpuPercent > 60 ? 'bar-cyan' : 'bar-green');
                    const memColor = memPercent > 85 ? 'bar-red' : (memPercent > 60 ? 'bar-cyan' : 'bar-green');
                    
                    nodesHtml += `
                        <div class="mt-4 p-3 bg-black/40 border border-cyan-dim rounded cursor-pointer hover:border-cyan hover:bg-cyan/5 transition-colors group" onclick="loadNodeVMs(${srv.id}, '${srv.name}', '${n.node}')">
                            <div class="flex justify-between items-center mb-2">
                                <div class="font-mono text-sm text-white group-hover:text-cyan group-hover:glitch" data-text="${n.node}"><span class="status-dot ${isOnline ? 'online' : 'offline'} mr-2"></span>${n.node}</div>
                                <div class="text-xs text-cyan-dim font-mono">>_VIEW_VMS</div>
                            </div>
                            ${isOnline ? `
                            <div class="flex items-center gap-2 mb-1.5">
                                <div class="text-[10px] text-cyan-dim font-mono w-8">CPU</div>
                                <div class="cyber-bar-container flex-1"><div class="cyber-bar ${cpuColor}" style="width: ${cpuPercent}%"></div></div>
                                <div class="text-[10px] text-cyan font-mono w-8 text-right">${cpuPercent}%</div>
                            </div>
                            <div class="flex items-center gap-2">
                                <div class="text-[10px] text-cyan-dim font-mono w-8">RAM</div>
                                <div class="cyber-bar-container flex-1"><div class="cyber-bar ${memColor}" style="width: ${memPercent}%"></div></div>
                                <div class="text-[10px] text-cyan font-mono w-8 text-right">${memPercent}%</div>
                            </div>
                            ` : '<div class="text-xs text-magenta font-mono">NODE_OFFLINE</div>'}
                        </div>
                    `;
                });
            } else if (srv.status === 'offline') {
                nodesHtml = '<div class="mt-4 text-magenta font-mono text-sm uppercase text-center py-4 border border-magenta/30 bg-magenta/10">LINK_UNREACHABLE</div>';
            } else {
                nodesHtml = '<div class="mt-4 text-cyan-dim font-mono text-sm text-center py-4 border border-cyan-dim/30">NO_COMPUTE_NODES_FOUND</div>';
            }
            
            card.innerHTML = `
                <div class="flex justify-between items-start mb-2 border-b border-cyan-dim pb-3">
                    <div>
                        <div class="font-bold text-xl text-cyan font-mono tracking-wider">${srv.name}</div>
                        <div class="text-xs text-cyan-dim font-mono uppercase mt-1">STATUS: <span class="${srv.status === 'online' ? 'text-green-500' : 'text-magenta'}">${srv.status}</span></div>
                    </div>
                </div>
                
                ${srv.status === 'online' ? `
                <div class="grid grid-cols-2 gap-2 mt-2">
                    <div class="bg-black/40 p-2 border border-cyan-dim">
                        <div class="text-[10px] text-cyan-dim font-mono mb-1">RUNNING_VMS</div>
                        <div class="text-2xl font-bold font-mono text-white">${srv.vms_running}</div>
                    </div>
                    <div class="bg-black/40 p-2 border border-cyan-dim">
                        <div class="text-[10px] text-cyan-dim font-mono mb-1">TOTAL_VMS</div>
                        <div class="text-2xl font-bold font-mono text-white">${srv.vms_total}</div>
                    </div>
                </div>
                ` : ''}
                
                <div class="flex-1 mt-2">
                    ${nodesHtml}
                </div>
            `;
            dashboardGrid.appendChild(card);
        });
        
    } catch (err) {
        dashboardGrid.innerHTML = `<div class="col-span-full text-center text-magenta font-mono bg-magenta/10 border border-magenta p-4 mt-4 w-full">${err.message}</div>`;
    }
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
        const vms = await fetchWithAuth(`/servers/${serverId}/nodes/${nodeName}/vms`);
        if (currentVMsFetchRef !== fetchRef) return;
        
        detailVmCount.textContent = vms.length;
        
        if (vms.length === 0) {
            vmsContainer.innerHTML = '<div class="col-span-full text-center py-12 border border-cyan-dim cyber-card"><div class="text-cyan-dim font-mono">NO COMPUTE RESOURCES ALLOCATED ON THIS NODE</div></div>';
            return;
        }
        
        vms.forEach((vm, i) => {
            const isRunning = vm.status === 'running';
            const memPercent = (vm.mem && vm.maxmem) ? Math.round((vm.mem / vm.maxmem) * 100) : 0;
            const cpuPercent = Math.round((vm.cpu || 0) * 100);
            
            const card = document.createElement('div');
            card.className = `cyber-card p-3 border ${isRunning ? 'border-cyan-dim' : 'border-[#333] opacity-60'} hover:border-cyan transition-colors`;
            card.style.animation = `fade-in 0.3s ease-out ${i * 0.05}s forwards`;
            card.style.opacity = '0';
            
            // Re-using the logic from the old dash, injecting into new cyber-UI
            card.innerHTML = `
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-3">
                        <div class="text-2xl ${isRunning ? (vm.type === 'qemu' ? 'text-cyan' : 'text-green-400') : 'text-[#555]'}">
                            <i class="${vm.type === 'qemu' ? 'ph ph-desktop' : 'ph ph-package'}"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-white font-mono text-sm truncate max-w-[150px]">${vm.name || 'VM_'+vm.vmid}</h4>
                            <div class="text-[10px] text-cyan-dim font-mono">ID: ${vm.vmid} // ${vm.type.toUpperCase()}</div>
                        </div>
                    </div>
                    <div class="status-dot ${isRunning ? 'online' : 'offline'}"></div>
                </div>
                
                ${isRunning ? `
                <div class="grid grid-cols-2 gap-2 text-[10px] font-mono mb-2">
                    <div class="bg-black/50 p-1 border border-cyan-dim/50"><span class="text-cyan-dim">CPU:</span> ${cpuPercent}%</div>
                    <div class="bg-black/50 p-1 border border-cyan-dim/50"><span class="text-cyan-dim">RAM:</span> ${formatMemory(vm.maxmem)}</div>
                    <div class="bg-black/50 p-1 border border-cyan-dim/50 col-span-2"><span class="text-cyan-dim">UPTIME:</span> ${formatUptime(vm.uptime)}</div>
                </div>
                <div class="cyber-bar-container h-1">
                    <div class="cyber-bar bar-cyan" style="width: ${(cpuPercent + memPercent)/2}%"></div>
                </div>
                ` : '<div class="text-xs text-magenta font-mono py-1 border border-magenta/30 bg-magenta/10 text-center mt-2">HALTED</div>'}
            `;
            
            vmsContainer.appendChild(card);
        });
        
    } catch (err) {
        vmsContainer.innerHTML = `<div class="col-span-full border border-magenta text-magenta bg-magenta/10 p-4 font-mono">${err.message}</div>`;
    } finally {
        showLoading(false);
    }
}

// Initial Boot CSS injection for animations missing in tailwind/static
const style = document.createElement('style');
style.innerHTML = `
@keyframes fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
    animation: fade-in 0.4s ease-out forwards;
}
`;
document.head.appendChild(style);

// Run init
updateNav();
