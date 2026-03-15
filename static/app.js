// static/app.js
const API_BASE = '/api';

// State
let sessionToken = localStorage.getItem('pve_token') || null;
let currentVMsFetchRef = null;

// UI Elements
const themeToggleBtn = document.getElementById('theme-toggle');
const loginBtn = document.getElementById('login-submit');
const logoutBtn = document.getElementById('logout-btn');
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const nodesContainer = document.getElementById('nodes-container');
const vmsContainer = document.getElementById('vms-container');
const vmsHeader = document.getElementById('vms-header');
const activeNodeName = document.getElementById('active-node-name');
const vmCount = document.getElementById('vm-count');
const loadingOverlay = document.getElementById('loading-overlay');
const loginError = document.getElementById('login-error');

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
function escapeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showLoading(show) {
    if (show) {
        loadingOverlay.classList.remove('hidden');
    } else {
        setTimeout(() => loadingOverlay.classList.add('hidden'), 200); // slight delay for smooth transition
    }
}

function updateView() {
    if (sessionToken) {
        loginView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');
        loadNodes();
    } else {
        loginView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
        logoutBtn.classList.add('hidden');
    }
}

async function fetchWithAuth(url, options = {}) {
    if (!sessionToken) throw new Error("Not logged in");
    
    const headers = {
        'Authorization': `Bearer ${sessionToken}`,
        ...options.headers
    };
    
    const response = await fetch(`${API_BASE}${url}`, { ...options, headers });
    
    if (response.status === 401) {
        sessionToken = null;
        localStorage.removeItem('pve_token');
        updateView();
        throw new Error("Session expired. Please log in again.");
    }
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "API Request Failed");
    }
    
    return response.json();
}

// Authentication
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    
    const host = document.getElementById('host').value;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const verify_ssl = document.getElementById('verify-ssl').checked;
    
    // UI state
    const originalText = loginBtn.innerHTML;
    loginBtn.innerHTML = '<i class="ph ph-circle-notch animate-spin text-xl"></i><span>Connecting...</span>';
    loginBtn.disabled = true;
    
    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, username, password, verify_ssl })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.detail || 'Login failed');
        }
        
        sessionToken = data.session_id;
        localStorage.setItem('pve_token', sessionToken);
        updateView();
        
    } catch (err) {
        loginError.textContent = err.message;
        loginError.classList.remove('hidden');
        // Shake animation
        loginForm.classList.add('animate-pulse');
        setTimeout(() => loginForm.classList.remove('animate-pulse'), 500);
    } finally {
        loginBtn.innerHTML = originalText;
        loginBtn.disabled = false;
    }
});

logoutBtn.addEventListener('click', async () => {
    if (sessionToken) {
        try {
            await fetch(`${API_BASE}/logout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${sessionToken}` }
            });
        } catch (e) {
            console.error("Logout error", e);
        }
    }
    sessionToken = null;
    localStorage.removeItem('pve_token');
    updateView();
});

// Data Fetching & Rendering
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
    const s = Math.floor(seconds % 60);
    
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
}

async function loadNodes() {
    nodesContainer.innerHTML = '<div class="text-center py-4 text-slate-500 text-sm"><i class="ph ph-circle-notch animate-spin text-2xl mb-2"></i><br>Finding nodes...</div>';
    
    try {
        const nodes = await fetchWithAuth('/nodes');
        
        nodesContainer.innerHTML = '';
        
        if (nodes.length === 0) {
            nodesContainer.innerHTML = '<div class="text-center py-8 text-slate-500 text-sm glass-card border glass-border rounded-xl col-span-full">No nodes available.</div>';
            return;
        }

        nodes.forEach(node => {
            // Memory percentage
            const memPercent = node.maxmem ? Math.round((node.mem / node.maxmem) * 100) : 0;
            const cpuPercent = Math.round((node.cpu || 0) * 100);
            const isOnline = node.status === 'online';
            
            const card = document.createElement('div');
            card.className = `glass-card p-4 rounded-2xl border glass-border cursor-pointer interactive-card transition relative overflow-hidden group ${isOnline ? 'hover:border-blue-500/50' : 'opacity-70'}`;
            
            card.innerHTML = `
                <div class="flex justify-between items-start mb-3">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center relative">
                            <i class="ph-fill ph-hard-drives text-xl ${isOnline ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400'}"></i>
                            <span class="absolute -bottom-1 -right-1 w-3.5 h-3.5 border-2 border-white dark:border-slate-800 rounded-full ${isOnline ? 'bg-status-running' : 'bg-status-stopped'}"></span>
                        </div>
                        <div>
                            <h3 class="font-semibold text-lg leading-tight group-hover:text-blue-500 transition-colors">${escapeHTML(node.node)}</h3>
                            <p class="text-xs text-slate-500 dark:text-slate-400 capitalize">${escapeHTML(node.status)}</p>
                        </div>
                    </div>
                </div>
                
                ${isOnline ? `
                <div class="grid grid-cols-2 gap-3 mt-4">
                    <div class="bg-white/40 dark:bg-slate-800/40 p-2.5 rounded-xl">
                        <div class="flex justify-between text-xs mb-1 text-slate-500 dark:text-slate-400">
                            <span>CPU</span>
                            <span class="font-medium text-slate-700 dark:text-slate-300">${cpuPercent}%</span>
                        </div>
                        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                            <div class="bg-blue-500 h-1.5 rounded-full" style="width: ${cpuPercent}%"></div>
                        </div>
                    </div>
                    <div class="bg-white/40 dark:bg-slate-800/40 p-2.5 rounded-xl">
                        <div class="flex justify-between text-xs mb-1 text-slate-500 dark:text-slate-400">
                            <span>RAM</span>
                            <span class="font-medium text-slate-700 dark:text-slate-300">${memPercent}%</span>
                        </div>
                        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                            <div class="bg-purple-500 h-1.5 rounded-full" style="width: ${memPercent}%"></div>
                        </div>
                    </div>
                </div>
                ` : ''}
            `;
            
            card.addEventListener('click', () => {
                if (isOnline) loadVMs(node.node);
            });
            
            nodesContainer.appendChild(card);
        });
        
    } catch (err) {
        nodesContainer.innerHTML = `<div class="bg-red-500/10 text-red-500 p-4 rounded-xl text-sm text-center border border-red-500/20">${err.message}</div>`;
    }
}

async function loadVMs(nodeName) {
    showLoading(true);
    activeNodeName.textContent = nodeName;
    vmsHeader.classList.remove('hidden');
    vmsContainer.classList.remove('hidden');
    vmsContainer.innerHTML = '';
    
    // Scroll down to VMs section smoothly
    setTimeout(() => {
        vmsHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
    
    // Prevent race conditions from rapid clicking
    const fetchRef = Symbol('fetchVMs');
    currentVMsFetchRef = fetchRef;
    
    try {
        const vms = await fetchWithAuth(`/nodes/${nodeName}/vms`);
        
        // If another node was clicked before this request finished, ignore these results
        if (currentVMsFetchRef !== fetchRef) return;
        
        vmCount.textContent = vms.length;
        
        if (vms.length === 0) {
            vmsContainer.innerHTML = '<div class="text-center py-8 text-slate-500 text-sm glass-card border glass-border rounded-xl">No Virtual Machines found on this node.</div>';
            return;
        }
        
        vms.forEach((vm, i) => {
            const isRunning = vm.status === 'running';
            const memPercent = (vm.mem && vm.maxmem) ? Math.round((vm.mem / vm.maxmem) * 100) : 0;
            const cpuPercent = Math.round((vm.cpu || 0) * 100);
            
            const card = document.createElement('div');
            // Adding a staggered fade-in animation
            card.className = `glass-card p-3.5 rounded-2xl border glass-border hover:shadow-md transition relative animate-fade-in`;
            card.style.animationDelay = `${i * 50}ms`;
            
            card.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3 w-full">
                        <div class="relative shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${vm.type === 'qemu' ? 'bg-indigo-500/10 text-indigo-500' : 'bg-orange-500/10 text-orange-500'}">
                            <i class="ph-fill ${vm.type === 'qemu' ? 'ph-desktop' : 'ph-package'} text-xl"></i>
                            <span class="absolute bottom-0 right-0 w-3 h-3 border-2 border-white dark:border-slate-800 rounded-full ${isRunning ? 'bg-status-running' : 'bg-status-stopped'}"></span>
                        </div>
                        
                        <div class="flex-1 min-w-0 pr-2">
                            <div class="flex items-center gap-2">
                                <h4 class="font-medium text-[15px] truncate">${escapeHTML(vm.name || 'VM '+vm.vmid)}</h4>
                                <span class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400">ID: ${vm.vmid}</span>
                            </div>
                            
                            <div class="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                                ${isRunning ? `
                                    <div class="flex items-center gap-1"><i class="ph-fill ph-cpu"></i> ${cpuPercent}%</div>
                                    <div class="flex items-center gap-1"><i class="ph-fill ph-memory"></i> ${formatMemory(vm.maxmem)}</div>
                                    <div class="flex items-center gap-1 ml-auto"><i class="ph-fill ph-clock"></i> ${formatUptime(vm.uptime)}</div>
                                ` : `
                                    <span>Stopped</span>
                                `}
                            </div>
                        </div>
                    </div>
                </div>
                
                ${isRunning ? `
                <div class="w-full h-1 bg-slate-200 dark:bg-slate-700 absolute bottom-0 left-0">
                    <div class="h-1 bg-gradient-to-r from-blue-500 to-indigo-500" style="width: ${(cpuPercent + memPercent)/2}%"></div>
                </div>
                ` : ''}
            `;
            
            vmsContainer.appendChild(card);
        });
        
    } catch (err) {
        vmsContainer.innerHTML = `<div class="bg-red-500/10 text-red-500 p-4 rounded-xl text-sm text-center border border-red-500/20">${err.message}</div>`;
    } finally {
        showLoading(false);
    }
}

// Initial Boot
updateView();
