/**
 * PogokLink Application Entry Point
 */

const App = {
    // Core State
    state: {
        user: null, // Auth User Object
        role: null, // 'admin' | 'teacher'
        status: null, // 'active' | 'pending'
        currentYear: new Date().getFullYear(),
        viewMode: 'calendar', // 'calendar', 'list'
    },

    // Initialization
    init: async function () {
        console.log("🚀 PogokLink Initializing...");

        try {
            // 1. Initialize Supabase
            if (window.SupabaseClient) {
                await window.SupabaseClient.init();
            } else {
                throw new Error("Supabase Client not loaded.");
            }

            // 2. Check Auth State
            await this.checkAuth();

            // 3. Load Initial View
            const savedView = localStorage.getItem('pogok_last_view') || 'calendar';

            if (window.location.hash) {
                const hashView = window.location.hash.substring(1);
                if (['calendar', 'login', 'admin'].includes(hashView)) {
                    this.navigate(hashView);
                } else {
                    this.navigate(savedView);
                }
                history.replaceState(null, null, window.location.pathname);
            } else {
                this.navigate(savedView);
            }

            console.log("✅ PogokLink Ready.");
        } catch (error) {
            console.error("❌ Initialization Failed:", error);
            alert("시스템 초기화 중 오류가 발생했습니다: " + error.message);
        } finally {
            // 4. Remove Loader (Always run)
            document.getElementById('loading-spinner').classList.add('hidden');
            document.getElementById('view-container').classList.remove('hidden');
        }
    },

    navigate: function (viewName) {
        this.state.viewMode = viewName;
        localStorage.setItem('pogok_last_view', viewName);
        this.loadView(viewName);
    },

    checkAuth: async function () {
        try {
            const { data, error } = await window.SupabaseClient.supabase.auth.getSession();
            if (error) throw error;

            await this.syncUser(data.session?.user);
            this.updateAuthUI(data.session);
        } catch (e) {
            console.error("checkAuth: Error getting session", e);
        }

        // Listen for auth changes
        window.SupabaseClient.supabase.auth.onAuthStateChange(async (_event, session) => {
            await this.syncUser(session?.user);
            this.updateAuthUI(session);
            // Redirect to calendar if logged in from login page
            if (session && this.state.viewMode === 'login') {
                this.navigate('calendar');
            }
        });
    },

    // Sync User with DB (Upsert & Fetch Role)
    syncUser: async function (authUser) {
        if (!authUser) {
            this.state.user = null;
            this.state.role = null;
            this.state.status = null;
            return;
        }

        try {
            // 1. Sync User Info (Upsert)
            // We lazily create the user_role entry on login if it doesn't exist
            const { error: upsertError } = await window.SupabaseClient.supabase
                .from('user_roles')
                .upsert({
                    user_id: authUser.id,
                    email: authUser.email,
                    last_login: new Date().toISOString()
                }, { onConflict: 'user_id' });

            if (upsertError) {
                console.warn("User Synced failed (Table might not exist yet?):", upsertError);
            }

            // 2. Fetch Role Info
            const { data, error: fetchError } = await window.SupabaseClient.supabase
                .from('user_roles')
                .select('role, status')
                .eq('user_id', authUser.id)
                .single();

            this.state.user = authUser;

            if (data) {
                this.state.role = data.role;
                this.state.status = data.status;
            } else {
                // Default fallback if fetch failed or just inserted
                this.state.role = 'teacher';
                this.state.status = 'pending';
            }

            console.log(`User: ${authUser.email}, Role: ${this.state.role}, Status: ${this.state.status}`);

        } catch (e) {
            console.error("Sync Logic Error:", e);
            // Fallback
            this.state.user = authUser;
            this.state.role = 'teacher';
        }
    },

    updateAuthUI: function (session) {
        // State is already updated by syncUser, but we ensure consistency
        if (!this.state.user && session?.user) this.state.user = session.user;

        const authContainer = document.getElementById('auth-status');

        if (!authContainer) {
            console.error("updateAuthUI: 'auth-status' element not found!");
            return;
        }

        if (this.state.user) {
            const userEmail = this.state.user.email.split('@')[0];
            const adminBtn = this.state.role === 'admin'
                ? `<button id="btn-admin" class="text-sm px-3 py-1 border border-purple-200 text-purple-700 rounded bg-purple-50 hover:bg-purple-100 ml-2">관리자</button>`
                : '';

            authContainer.innerHTML = `
                <span class="text-sm text-gray-700 hidden sm:inline">안녕하세요, <strong>${userEmail}</strong>님</span>
                ${adminBtn}
                <button id="btn-logout" class="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-100 ml-2">로그아웃</button>
            `;

            document.getElementById('btn-logout').addEventListener('click', async () => {
                await window.SupabaseClient.supabase.auth.signOut();
                this.navigate('calendar');
                window.location.reload(); // Clean state
            });

            if (this.state.role === 'admin') {
                document.getElementById('btn-admin').addEventListener('click', () => {
                    this.navigate('admin');
                });
            }
        } else {
            authContainer.innerHTML = `
                <button id="btn-login" class="text-sm font-medium text-gray-600 hover:text-gray-900">로그인</button>
            `;
            document.getElementById('btn-login').addEventListener('click', () => {
                this.navigate('login');
            });
        }

        // Update other UI elements based on role
        this.updateAccessControls();
    },

    updateAccessControls: function () {
        // "Add Schedule" Button Visibility
        // Visible for: Admin, Head Teacher
        // Hidden for: Teacher, Guest
        const btnAddSchedule = document.getElementById('btn-add-schedule');

        if (btnAddSchedule) {
            const canAdd = this.state.role === 'admin' || this.state.role === 'head_teacher';

            if (canAdd) {
                btnAddSchedule.classList.remove('hidden');
            } else {
                btnAddSchedule.classList.add('hidden');
            }
        }
    },

    loadView: async function (viewName) {
        const container = document.getElementById('view-container');

        // Cleanup content
        container.innerHTML = '';

        if (viewName === 'calendar') {
            try {
                const response = await fetch('pages/calendar.html');
                const html = await response.text();
                container.innerHTML = html;
                this.initCalendar();
            } catch (e) {
                console.error("Failed to load calendar", e);
                container.innerHTML = `<p class="text-red-500">캘린더 로딩 실패</p>`;
            }
        } else if (viewName === 'login') {
            try {
                const response = await fetch('pages/login.html');
                const html = await response.text();
                container.innerHTML = html;
                this.initLoginView();
            } catch (e) {
                console.error("Failed to load login page", e);
                container.innerHTML = `<p class="text-red-500">페이지를 불러올 수 없습니다.</p>`;
            }
        } else if (viewName === 'admin') {
            // Check Admin Auth (Simple client-side check, real security via RLS)
            if (!this.state.user || this.state.role !== 'admin') {
                alert("접근 권한이 없습니다.");
                this.navigate('calendar'); // Redirect to calendar instead of login if already logged in but not admin
                return;
            }

            try {
                const response = await fetch('pages/admin.html');
                const html = await response.text();
                container.innerHTML = html;
                this.initAdminView();
            } catch (e) {
                console.error("Failed to load admin page", e);
                container.innerHTML = `<p class="text-red-500">페이지를 불러올 수 없습니다.</p>`;
            }
        }

        // Re-run Auth UI update to bind header buttons if they exist
        // This is crucial because header buttons might be part of the layout, 
        // but if we have view-specific buttons (like in login page), they need specific init.
        // Actually, header is static. But `btn-login` might be in header.

        // Safety check: ensure header auth UI is consistent
        this.updateAuthUI(this.state.user ? { user: this.state.user } : null);
    },

    initLoginView: function () {
        const form = document.getElementById('login-form');
        const errorMsg = document.getElementById('login-error');
        const DOMAIN = 'pogok.hs.kr'; // Default domain for short IDs

        form.onsubmit = async (e) => {
            e.preventDefault();
            let email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const btn = document.getElementById('btn-login-submit');

            // Auto-append domain if not present
            if (!email.includes('@')) {
                email = `${email}@${DOMAIN}`;
            }

            btn.disabled = true;
            btn.innerHTML = '로그인 중...';
            errorMsg.classList.add('hidden');

            try {
                const { data, error } = await window.SupabaseClient.supabase.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;
                // Auth State Change listener will handle redirect
            } catch (err) {
                errorMsg.textContent = "로그인 실패: 이메일 또는 비밀번호를 확인하세요.";
                errorMsg.classList.remove('hidden');
                btn.disabled = false;
                btn.innerHTML = '로그인';
            }
        };

        document.getElementById('btn-signup').onclick = () => {
            alert('초기 가입은 관리자가 생성해준 계정을 사용하거나, 별도 가입 페이지를 이용해야 합니다. (구현 예정)');
        };
    },

    initAdminView: async function () {
        // 1. Department Management
        const deptList = document.getElementById('admin-dept-list');
        const departments = await this.fetchDepartments();

        deptList.innerHTML = departments.map(d => `
            <div class="flex items-center gap-2 mb-2">
                <input type="text" value="${d.dept_name}" data-id="${d.id}" class="dept-name-input border rounded px-2 py-1 text-sm w-32" placeholder="부서명">
                <input type="color" value="${d.dept_color}" data-id="${d.id}" class="dept-color-input border rounded h-8 w-8 cursor-pointer">
            </div>
        `).join('');

        // Save Depts Button
        document.getElementById('btn-save-depts').onclick = async () => {
            const btn = document.getElementById('btn-save-depts');
            btn.disabled = true;
            btn.textContent = '저장 중...';

            const updates = [];
            document.querySelectorAll('.dept-name-input').forEach(input => {
                const id = input.dataset.id;
                const name = input.value;
                const color = document.querySelector(`.dept-color-input[data-id="${id}"]`).value;

                updates.push({ id: id, dept_name: name, dept_color: color });
            });

            const { error } = await window.SupabaseClient.supabase
                .from('departments')
                .upsert(updates);

            if (error) {
                alert("저장 실패: " + error.message);
            } else {
                alert("저장되었습니다.");
                this.logAction('UPDATE_DEPTS', 'departments', null, { count: updates.length });
                this.fetchDepartments();
            }

            btn.disabled = false;
            btn.textContent = '변경사항 저장';
        };

        // 2. User Management
        await this.loadAdminUsers();

        // 3. Audit Logs
        this.loadAuditLogs();

        // 4. Excel Import Link
        const btnExcel = document.getElementById('btn-open-excel');
        if (btnExcel) {
            btnExcel.onclick = () => this.openExcelModal();
        }
    },

    loadAdminUsers: async function () {
        const listContainer = document.getElementById('admin-user-list');
        if (!listContainer) return;

        try {
            const { data: users, error } = await window.SupabaseClient.supabase
                .from('user_roles')
                .select('*')
                .order('last_login', { ascending: false });

            if (error) throw error;

            if (users && users.length > 0) {
                listContainer.innerHTML = users.map(u => `
                    <div class="flex items-center justify-between p-2 border rounded hover:bg-gray-50">
                        <div>
                            <div class="font-bold text-sm text-gray-800">${u.email}</div>
                            <div class="text-xs text-gray-500">최근 접속: ${new Date(u.last_login).toLocaleDateString()}</div>
                        </div>
                        <div class="flex items-center gap-2">
                            <select onchange="window.App.updateUserRole('${u.user_id}', this.value)" class="text-xs border rounded p-1 ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-white'}">
                                <option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>일반 (Teacher)</option>
                                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>관리자 (Admin)</option>
                            </select>
                            <select onchange="window.App.updateUserStatus('${u.user_id}', this.value)" class="text-xs border rounded p-1 ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100'}">
                                <option value="pending" ${u.status === 'pending' ? 'selected' : ''}>대기</option>
                                <option value="active" ${u.status === 'active' ? 'selected' : ''}>승인</option>
                                <option value="rejected" ${u.status === 'rejected' ? 'selected' : ''}>거부</option>
                            </select>
                        </div>
                    </div>
                `).join('');
            } else {
                listContainer.innerHTML = '<p class="text-gray-400 text-center py-4">사용자가 없습니다.</p>';
            }
        } catch (e) {
            console.error("Load Users Failed:", e);
            listContainer.innerHTML = '<p class="text-red-500 text-center py-4">데이터 로딩 실패</p>';
        }
    },

    updateUserRole: async function (userId, newRole) {
        if (!confirm('권한을 변경하시겠습니까?')) {
            this.loadAdminUsers(); // Revert UI
            return;
        }

        const { error } = await window.SupabaseClient.supabase
            .from('user_roles')
            .update({ role: newRole })
            .eq('user_id', userId);

        if (error) {
            alert("업데이트 실패: " + error.message);
        } else {
            this.loadAdminUsers(); // Refresh
            this.logAction('UPDATE_ROLE', 'user_roles', userId, { newRole });
        }
    },

    updateUserStatus: async function (userId, newStatus) {
        const { error } = await window.SupabaseClient.supabase
            .from('user_roles')
            .update({ status: newStatus })
            .eq('user_id', userId);

        this.logAction('UPDATE_STATUS', 'user_roles', userId, { newStatus });
    },

    loadAuditLogs: async function () {
        const auditList = document.getElementById('admin-audit-list');
        if (auditList) {
            try {
                const { data: logs, error } = await window.SupabaseClient.supabase
                    .from('audit_logs')
                    .select('*')
                    .order('timestamp', { ascending: false })
                    .limit(20);

                if (error) throw error;

                if (logs && logs.length > 0) {
                    auditList.innerHTML = logs.map(log => `
                        <div class="border-b last:border-0 pb-2 mb-2">
                            <div class="flex justify-between items-center mb-1">
                                <span class="font-bold text-gray-800 text-xs px-2 py-0.5 rounded bg-gray-100">${log.action_type}</span>
                                <span class="text-xs text-gray-400">${new Date(log.timestamp).toLocaleString()}</span>
                            </div>
                            <div class="text-gray-600 truncate">${log.details ? JSON.stringify(JSON.parse(log.details)) : '-'}</div>
                        </div>
                    `).join('');
                } else {
                    auditList.innerHTML = `<p class="text-gray-400 text-center py-4">기록된 로그가 없습니다.</p>`;
                }
            } catch (e) {
                console.error("Failed to fetch audit logs:", e);
                auditList.innerHTML = `<p class="text-red-400 text-center py-4">로그 로딩 실패</p>`;
            }
        }
    },

    initCalendar: async function () {
        const calendarEl = document.getElementById('calendar');
        if (!calendarEl) return;

        // 1. Fetch Metadata (Settings, Departments)
        const [settings, departments] = await Promise.all([
            this.fetchSettings(),
            this.fetchDepartments()
        ]);

        this.state.departments = departments;
        this.renderDeptFilters(departments);

        // 2. Fetch Events (Schedules)
        const schedules = await this.fetchSchedules();
        this.state.schedules = schedules; // Cache for search

        // 3. Prepare Events for FullCalendar
        const calendarEvents = this.transformEvents(schedules, settings, departments);

        // ... (FullCalendar Init) ...

        // 4. Bind Search
        const searchInput = document.getElementById('search-schedule');
        const searchResults = document.getElementById('search-results');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase().trim();
                if (query.length < 2) {
                    searchResults.classList.add('hidden');
                    return;
                }

                const matches = this.state.schedules.filter(s =>
                    s.title.toLowerCase().includes(query) ||
                    (s.description && s.description.toLowerCase().includes(query))
                );

                searchResults.classList.remove('hidden');
                if (matches.length === 0) {
                    searchResults.innerHTML = `<div class="text-gray-400 p-2">검색 결과가 없습니다.</div>`;
                } else {
                    searchResults.innerHTML = matches.map(s => `
                        <div class="cursor-pointer hover:bg-purple-50 p-2 rounded truncate border-b last:border-0" data-date="${s.start_date}" data-id="${s.id}">
                            <div class="font-bold text-gray-700">${s.title}</div>
                            <div class="text-xs text-gray-500">${s.start_date}</div>
                        </div>
                    `).join('');

                    // Bind clicks
                    searchResults.querySelectorAll('div[data-date]').forEach(el => {
                        el.onclick = () => {
                            this.state.calendar.gotoDate(el.dataset.date);
                            // Highlight event?
                            // Optional: Open modal
                            // this.openScheduleModal(el.dataset.id);
                        };
                    });
                }
            });
        }

        // 4. Initialize FullCalendar
        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth',
            locale: 'ko',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,listWeek'
            },
            buttonText: {
                today: '오늘',
                month: '월',
                week: '주',
                list: '목록'
            },
            height: 'auto',
            dayMaxEvents: true,
            events: calendarEvents,
            eventDidMount: (info) => {
                // Client-side filtering
                const extendedProps = info.event.extendedProps;
                if (extendedProps.deptId) {
                    const isChecked = document.querySelector(`.dept-checkbox[value="${extendedProps.deptId}"]`)?.checked;
                    if (isChecked === false) {
                        info.el.style.display = 'none';
                    }
                }
            },
            windowResize: (view) => {
                if (window.innerWidth < 768) {
                    calendar.changeView('listWeek');
                } else {
                    calendar.changeView('dayGridMonth');
                }
            },
            dateClick: (info) => {
                this.openScheduleModal(null, info.dateStr);
            },
            eventClick: (info) => {
                if (info.event.display !== 'background') {
                    this.openScheduleModal(info.event.id);
                }
            }
        });

        this.state.calendar = calendar; // Save instance
        calendar.render();

        // Bind Events
        document.getElementById('btn-refresh')?.addEventListener('click', () => this.initCalendar());

        // Add Schedule Button (Sidebar)
        document.getElementById('btn-add-schedule')?.addEventListener('click', () => {
            this.openScheduleModal(null, new Date().toISOString().split('T')[0]);
        });

        document.getElementById('btn-print-modal')?.addEventListener('click', () => {
            this.openPrintModal();
        });

        // Mobile Sidebar Toggle
        const btnToggle = document.getElementById('btn-toggle-filters');
        const sidebarContent = document.getElementById('sidebar-content');
        const iconToggle = document.getElementById('icon-filter-toggle');

        if (btnToggle && sidebarContent) {
            btnToggle.onclick = () => {
                const isHidden = sidebarContent.classList.contains('hidden');
                if (isHidden) {
                    sidebarContent.classList.remove('hidden');
                    iconToggle.style.transform = 'rotate(180deg)';
                } else {
                    sidebarContent.classList.add('hidden');
                    iconToggle.style.transform = 'rotate(0deg)';
                }
            };
        }
    },

    // --- Data Fetching ---

    fetchSettings: async function () {
        // Fetch active academic year settings
        // For simplicity, we get the first row or specific year
        const { data, error } = await window.SupabaseClient.supabase
            .from('settings')
            .select('*')
            .order('academic_year', { ascending: false })
            .limit(1)
            .single();

        if (error) console.error('Error fetching settings:', error);
        return data || {};
    },

    fetchDepartments: async function () {
        if (!this.state.currentYear) this.state.currentYear = new Date().getFullYear() + (new Date().getMonth() > 1 ? 0 : -1);
        // Simple logic: if Jan/Feb, consider it part of previous academic year until March.

        const { data, error } = await window.SupabaseClient.supabase
            .from('departments')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

        if (error) console.error('Error fetching departments:', error);
        return data || [];
    },

    fetchSchedules: async function () {
        // Fetch all public schedules + visible internal ones
        const { data, error } = await window.SupabaseClient.supabase
            .from('schedules')
            .select('*');

        if (error) console.error('Error fetching schedules:', error);
        return data || [];
    },

    // --- Data Transformation ---

    transformEvents: function (schedules, settings, departments) {
        const events = [];

        // A. Add Holidays (Background Events)
        if (settings) {
            // Fixed Holidays
            const fixed = settings.fixed_holidays || {};
            // Simplistic repeating for current year context
            const yearStr = settings.academic_year || new Date().getFullYear();

            Object.entries(fixed).forEach(([mmdd, name]) => {
                // e.g. "0301" -> "2026-03-01"
                events.push({
                    start: `${yearStr}-${mmdd.substring(0, 2)}-${mmdd.substring(2, 4)}`,
                    display: 'background',
                    title: name,
                    className: 'holiday-bg-event',
                    allDay: true
                });
            });

            // Variable Holidays
            const variable = settings.variable_holidays || {};
            Object.entries(variable).forEach(([dateStr, name]) => {
                events.push({
                    start: dateStr,
                    display: 'background',
                    title: name,
                    className: 'holiday-bg-event',
                    allDay: true
                });
            });
        }

        // B. Add Schedules
        const deptMap = {};
        departments.forEach(d => deptMap[d.id] = d);

        schedules.forEach(s => {
            const dept = deptMap[s.dept_id] || {};
            events.push({
                id: s.id,
                title: s.title,
                start: s.start_date,
                end: s.end_date, // Note: FullCalendar exclusive end date? need check if same day
                backgroundColor: dept.dept_color || '#3788d8',
                borderColor: dept.dept_color || '#3788d8',
                extendedProps: {
                    deptId: s.dept_id,
                    description: s.description,
                    visibility: s.visibility,
                    isPrintable: s.is_printable
                }
            });
        });

        return events;
    },

    renderDeptFilters: function (departments) {
        const container = document.getElementById('dept-filter-list');
        if (!container) return;

        container.innerHTML = departments.map(d => `
            <div class="flex items-center gap-2">
                <input type="checkbox" id="dept-${d.id}" value="${d.id}" class="dept-checkbox rounded text-purple-600 focus:ring-purple-500" checked>
                <label for="dept-${d.id}" class="flex items-center gap-2 cursor-pointer w-full">
                    <span class="w-3 h-3 rounded-full" style="background-color: ${d.dept_color}"></span>
                    <span>${d.dept_name}</span>
                </label>
            </div>
        `).join('');

        // Add Event Listeners
        container.querySelectorAll('.dept-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                // Re-render events to trigger eventDidMount filtering
                // Or use internal filter API if available. 
                // For simplicity: refetch is expensive, so we just rerender existing events? 
                // FullCalendar doesn't have simple show/hide API for events without removing them.
                // Best simple appoach: 
                this.state.calendar.refetchEvents(); // This triggers eventDidMount again
            });
        });
    },

    // --- Modal & CRUD Logic ---

    openScheduleModal: async function (eventId = null, defaultDate = null) {
        // 1. Check Auth & Permissions
        if (!this.state.user) {
            alert("로그인이 필요한 기능입니다.");
            this.navigate('login');
            return;
        }

        const canEdit = this.state.role === 'admin' || this.state.role === 'head_teacher';
        if (!canEdit) {
            alert("일정을 등록/수정할 권한이 없습니다.");
            return;
        }

        // 2. Load Modal Template
        const modalContainer = document.getElementById('modal-container');
        try {
            const response = await fetch('pages/modal-schedule.html');
            modalContainer.innerHTML = await response.text();
            modalContainer.classList.remove('invisible');
        } catch (e) {
            console.error("Failed to load modal", e);
            alert("오류가 발생했습니다.");
            return;
        }

        // 3. Setup Elements
        const form = document.getElementById('schedule-form');
        const titleInput = document.getElementById('sched-title');
        const startInput = document.getElementById('sched-start');
        const endInput = document.getElementById('sched-end');
        const deptSelect = document.getElementById('sched-dept');
        const visSelect = document.getElementById('sched-visibility');
        const descInput = document.getElementById('sched-desc');
        const printCheck = document.getElementById('sched-printable');
        const btnDelete = document.getElementById('btn-delete');
        const visHint = document.getElementById('visibility-hint');

        // Recurrence Elements
        const repeatCheck = document.getElementById('sched-repeat');
        const recurSection = document.getElementById('recurrence-section'); // Wrapper
        const recurOptions = document.getElementById('recurrence-options');
        const rFreq = document.getElementById('sched-freq');
        const rUntil = document.getElementById('sched-until');

        // 4. Populate Departments
        deptSelect.innerHTML = this.state.departments.map(d =>
            `<option value="${d.id}">${d.dept_name}</option>`
        ).join('');

        // 5. Load Data (Edit Mode) or Defaults
        if (eventId) {
            document.getElementById('modal-title').textContent = "일정 수정";
            btnDelete.classList.remove('hidden');
            recurSection.classList.add('hidden'); // Hide recurrence on edit for simplicity in V1

            const event = this.state.calendar.getEventById(eventId);
            if (event) {
                document.getElementById('schedule-id').value = eventId;
                titleInput.value = event.title;
                startInput.value = event.startStr;
                endInput.value = event.endStr || event.startStr;

                if (event.allDay && event.end) {
                    const d = new Date(event.end);
                    d.setDate(d.getDate() - 1);
                    endInput.value = d.toISOString().split('T')[0];
                }

                deptSelect.value = event.extendedProps.deptId;
                visSelect.value = event.extendedProps.visibility;
                descInput.value = event.extendedProps.description || '';
                printCheck.checked = event.extendedProps.isPrintable !== false;
            }
        } else {
            recurSection.classList.remove('hidden');
            if (defaultDate) {
                startInput.value = defaultDate;
                endInput.value = defaultDate;
            } else {
                startInput.value = new Date().toISOString().split('T')[0];
                endInput.value = startInput.value;
            }
            // Init Repeat Options
            repeatCheck.checked = false;
            recurOptions.classList.add('hidden');
        }

        // 6. Event Listeners
        document.getElementById('btn-modal-close').onclick = () => this.closeModal();
        document.getElementById('btn-cancel').onclick = () => this.closeModal();

        repeatCheck.onchange = () => {
            if (repeatCheck.checked) {
                recurOptions.classList.remove('hidden');
                if (!rUntil.value) {
                    // Default until: 1 month later
                    const d = new Date(startInput.value);
                    d.setMonth(d.getMonth() + 1);
                    rUntil.value = d.toISOString().split('T')[0];
                }
            } else {
                recurOptions.classList.add('hidden');
            }
        };

        visSelect.onchange = () => {
            const hints = {
                'public': '모두에게 공개됩니다.',
                'internal': '⚠️ 관리자와 교직원에게만 노출됩니다.',
                'dept': '🔒 부서원만 볼 수 있습니다.'
            };
            visHint.textContent = hints[visSelect.value] || '';
        };
        visSelect.onchange();

        btnDelete.onclick = async () => {
            if (confirm("정말로 이 일정을 삭제하시겠습니까?")) {
                const { error } = await window.SupabaseClient.supabase
                    .from('schedules')
                    .delete()
                    .eq('id', document.getElementById('schedule-id').value);

                if (error) {
                    alert("삭제 실패: " + error.message);
                } else {
                    this.logAction('DELETE', 'schedules', document.getElementById('schedule-id').value, { title: titleInput.value });
                    this.closeModal();
                    this.initCalendar();
                }
            }
        };

        form.onsubmit = async (e) => {
            e.preventDefault();

            const scheduleId = document.getElementById('schedule-id').value;
            const baseData = {
                title: titleInput.value,
                dept_id: deptSelect.value,
                visibility: visSelect.value,
                description: descInput.value,
                is_printable: printCheck.checked,
                author_id: this.state.user.id
            };

            const startDateStr = startInput.value;
            const endDateStr = endInput.value;

            // Recurrence Generation
            const isRecurring = !scheduleId && repeatCheck.checked;

            const btnSave = document.getElementById('btn-save');
            btnSave.disabled = true;
            btnSave.textContent = isRecurring ? '반복 일정 생성 중...' : '저장 중...';

            let batchData = [];

            if (isRecurring) {
                const untilStr = rUntil.value;
                const freq = rFreq.value;

                if (untilStr <= startDateStr) {
                    alert('반복 종료일은 시작일 이후여야 합니다.');
                    btnSave.disabled = false;
                    return;
                }

                // Calculate Duration
                const d1 = new Date(startDateStr);
                const d2 = new Date(endDateStr);
                const durationMs = d2 - d1;

                let curr = new Date(startDateStr);
                const until = new Date(untilStr);
                let limit = 0;

                while (curr <= until && limit < 52) { // Safety limit 52 (1 year weekly)
                    const loopStart = curr.toISOString().split('T')[0];
                    const loopEnd = new Date(curr.getTime() + durationMs).toISOString().split('T')[0];

                    batchData.push({
                        ...baseData,
                        start_date: loopStart,
                        end_date: loopEnd
                    });

                    // Next Step
                    if (freq === 'weekly') curr.setDate(curr.getDate() + 7);
                    else if (freq === 'biweekly') curr.setDate(curr.getDate() + 14);
                    else if (freq === 'monthly') curr.setMonth(curr.getMonth() + 1);

                    limit++;
                }

                if (batchData.length === 0) batchData.push({ ...baseData, start_date: startDateStr, end_date: endDateStr });

            } else {
                batchData.push({
                    ...baseData,
                    start_date: startDateStr,
                    end_date: endDateStr
                });
            }

            let result;
            if (scheduleId) {
                // UPDATE (Single)
                result = await window.SupabaseClient.supabase
                    .from('schedules')
                    .update(batchData[0])
                    .eq('id', scheduleId)
                    .select();
            } else {
                // INSERT (Maybe Batch)
                result = await window.SupabaseClient.supabase
                    .from('schedules')
                    .insert(batchData)
                    .select();
            }

            if (result.error) {
                console.error(result.error);
                alert("저장 실패: " + result.error.message);
                btnSave.disabled = false;
                btnSave.textContent = '저장';
            } else {
                const action = scheduleId ? 'UPDATE' : 'INSERT';
                // Log only first ID or special bulk log
                if (batchData.length > 1) {
                    this.logAction('RECUR_INSERT', 'schedules', null, { count: batchData.length, title: baseData.title });
                } else {
                    const id = scheduleId || result.data[0].id;
                    this.logAction(action, 'schedules', id, { title: baseData.title, dept: baseData.dept_id });
                }

                this.closeModal();
                this.initCalendar();
            }
        };
    },

    closeModal: function () {
        const modalContainer = document.getElementById('modal-container');
        modalContainer.classList.add('invisible');
        modalContainer.innerHTML = '';
    },

    // --- Print Logic ---

    openPrintModal: async function () {
        const modalContainer = document.getElementById('modal-container');
        try {
            const response = await fetch('pages/modal-print.html');
            modalContainer.innerHTML = await response.text();
            modalContainer.classList.remove('invisible');
        } catch (e) {
            console.error("Failed to load print modal", e);
            return;
        }

        // Bind Events
        document.getElementById('btn-print-close').onclick = () => this.closeModal();
        document.getElementById('btn-print-cancel').onclick = () => this.closeModal();

        document.getElementById('btn-do-print').onclick = () => {
            const size = document.getElementById('print-size').value;
            const orient = document.getElementById('print-orient').value;
            const isScale = document.getElementById('print-scale').checked;
            const viewType = document.querySelector('input[name="print-view"]:checked').value;

            this.executePrint(size, orient, isScale, viewType);
        };
    },

    executePrint: function (size, orient, isScale, viewType) {
        this.closeModal();

        // 1. Prepare View
        if (this.state.calendar) {
            // Switch view if needed (e.g. to List view)
            if (viewType === 'list') {
                this.state.calendar.changeView('listMonth');
            } else {
                this.state.calendar.changeView('dayGridMonth');
            }
        }

        // 2. Apply Classes to Body
        const body = document.body;
        const previousClasses = body.className;

        body.classList.add('printing-mode');
        body.classList.add(`print-${orient}`);
        body.classList.add(`print-${size.toLowerCase()}`);
        if (isScale) body.classList.add('print-scale');

        // 3. Print
        setTimeout(() => {
            window.print();
        }, 500);

        const cleanup = () => {
            body.className = previousClasses; // Restore
            // Restore calendar view if needed
            if (this.state.calendar && viewType === 'list') {
                this.state.calendar.changeView(window.innerWidth < 768 ? 'listWeek' : 'dayGridMonth');
            }
            window.removeEventListener('afterprint', cleanup);
        };

        window.addEventListener('afterprint', cleanup);
    },

    // --- Excel Upload Logic ---

    openExcelModal: async function () {
        const modalContainer = document.getElementById('modal-container');
        try {
            const response = await fetch('pages/modal-excel.html');
            modalContainer.innerHTML = await response.text();
            modalContainer.classList.remove('invisible');
        } catch (e) {
            console.error("Failed to load excel modal", e);
            return;
        }

        // Bind Elements
        const fileInput = document.getElementById('excel-file-input');
        const fileNameDisplay = document.getElementById('excel-file-name');
        const btnUpload = document.getElementById('btn-upload-submit');
        const statusArea = document.getElementById('upload-status-area');
        const previewCount = document.getElementById('preview-count');

        let parsedData = [];

        // Close handlers
        const close = () => {
            modalContainer.classList.add('invisible');
            modalContainer.innerHTML = '';
        };
        document.getElementById('btn-excel-close').onclick = close;
        document.getElementById('btn-excel-cancel').onclick = close;

        // Template Download
        document.getElementById('btn-download-template').onclick = () => {
            const wb = XLSX.utils.book_new();
            const ws_data = [
                ["일정명", "시작일(YYYY-MM-DD)", "종료일(YYYY-MM-DD)", "내용", "부서명(정확히)", "공개범위(전체/교직원/부서)"]
            ];
            const ws = XLSX.utils.aoa_to_sheet(ws_data);
            XLSX.utils.book_append_sheet(wb, ws, "일정양식");
            XLSX.writeFile(wb, "PogoLink_Schedule_Template.xlsx");
        };

        // File Select & Parse
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            fileNameDisplay.textContent = file.name;

            const reader = new FileReader();
            reader.onload = (evt) => {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert to JSON
                const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                // Remove header row
                rawRows.shift();

                // Validate and Map
                const depts = this.state.departments; // Need to match by name
                parsedData = [];
                let validCount = 0;

                rawRows.forEach(row => {
                    if (row.length < 2) return; // Skip empty rows
                    const [title, start, end, desc, deptName, visibilityRaw] = row;

                    if (!title || !start) return;

                    // Match Dept
                    const dept = depts.find(d => d.dept_name === deptName) || depts[0]; // fallback to first dept if no match? or error?

                    // Map Visibility
                    let visibility = 'internal';
                    if (visibilityRaw === '전체') visibility = 'public';
                    else if (visibilityRaw === '부서') visibility = 'dept';

                    parsedData.push({
                        title,
                        start_date: start, // Assuming YYYY-MM-DD string from Excel or handled text
                        end_date: end || start,
                        description: desc || '',
                        dept_id: dept.id,
                        visibility,
                        author_id: this.state.user.id,
                        is_printable: true
                    });
                    validCount++;
                });

                previewCount.textContent = validCount;
                statusArea.classList.remove('hidden');

                if (validCount > 0) {
                    btnUpload.disabled = false;
                }
            };
            reader.readAsArrayBuffer(file);
        };

        // Upload Action
        btnUpload.onclick = async () => {
            if (parsedData.length === 0) return;

            btnUpload.disabled = true;
            btnUpload.textContent = '업로드 중...';

            const { error } = await window.SupabaseClient.supabase
                .from('schedules')
                .insert(parsedData);

            if (error) {
                alert("업로드 실패: " + error.message);
                btnUpload.disabled = false;
                btnUpload.textContent = '업로드';
            } else {
                this.logAction('BULK_INSERT', 'schedules', null, { count: parsedData.length });
                alert(`${parsedData.length}건의 일정이 등록되었습니다.`);
                close();
                // If we are on calendar view, refresh it?
                // But usually we are on Admin page coming here. 
                // But to be safe, if calendar is open in background:
                if (this.state.calendar) this.initCalendar();
            }
        };
    },

    // --- Admin Helpers ---

    loadAdminUsers: async function () {
        const listContainer = document.getElementById('admin-user-list');
        if (!listContainer) return;

        try {
            const { data: users, error } = await window.SupabaseClient.supabase
                .from('user_roles')
                .select('*')
                .order('last_login', { ascending: false });

            if (error) throw error;

            if (users && users.length > 0) {
                listContainer.innerHTML = users.map(u => `
                    <div class="flex items-center justify-between p-2 border rounded hover:bg-gray-50">
                        <div>
                            <div class="font-bold text-sm text-gray-800">${u.email}</div>
                            <div class="text-xs text-gray-500">최근 접속: ${new Date(u.last_login).toLocaleDateString()}</div>
                        </div>
                        <div class="flex items-center gap-2">
                             <select onchange="window.App.updateUserRole('${u.user_id}', this.value)" class="text-xs border rounded p-1 ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : (u.role === 'head' ? 'bg-blue-100 text-blue-700' : 'bg-white')}">
                                 <option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>일반 (Teacher)</option>
                                 <option value="head" ${u.role === 'head' ? 'selected' : ''}>부장 (Head)</option>
                                 <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>관리자 (Admin)</option>
                             </select>
                             <select onchange="window.App.updateUserStatus('${u.user_id}', this.value)" class="text-xs border rounded p-1 ${u.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100'}">
                                 <option value="pending" ${u.status === 'pending' ? 'selected' : ''}>대기</option>
                                 <option value="active" ${u.status === 'active' ? 'selected' : ''}>승인</option>
                                 <option value="rejected" ${u.status === 'rejected' ? 'selected' : ''}>거부</option>
                             </select>
                        </div>
                    </div>
                `).join('');
            } else {
                listContainer.innerHTML = '<p class="text-gray-400 text-center py-4">사용자가 없습니다.</p>';
            }
        } catch (e) {
            console.error("Load Users Failed:", e);
            listContainer.innerHTML = '<p class="text-red-500 text-center py-4">데이터 로딩 실패 (권한 부족?)</p>';
        }
    },

    updateUserRole: async function (userId, newRole) {
        if (!confirm('권한을 변경하시겠습니까?')) {
            this.loadAdminUsers();
            return;
        }

        const { error } = await window.SupabaseClient.supabase
            .from('user_roles')
            .update({ role: newRole })
            .eq('user_id', userId);

        if (error) {
            alert("업데이트 실패: " + error.message);
        } else {
            this.loadAdminUsers();
            this.logAction('UPDATE_ROLE', 'user_roles', userId, { newRole });
        }
    },

    updateUserStatus: async function (userId, newStatus) {
        const { error } = await window.SupabaseClient.supabase
            .from('user_roles')
            .update({ status: newStatus })
            .eq('user_id', userId);

        if (error) {
            alert("상태 변경 실패: " + error.message);
        } else {
            this.loadAdminUsers();
            this.logAction('UPDATE_STATUS', 'user_roles', userId, { newStatus });
        }
    },

    loadAuditLogs: async function () {
        const auditList = document.getElementById('admin-audit-list');
        if (auditList) {
            try {
                const { data: logs, error } = await window.SupabaseClient.supabase
                    .from('audit_logs')
                    .select('*')
                    .order('timestamp', { ascending: false })
                    .limit(20);

                if (error) throw error;

                if (logs && logs.length > 0) {
                    auditList.innerHTML = logs.map(log => `
                         <div class="border-b last:border-0 pb-2 mb-2">
                             <div class="flex justify-between items-center mb-1">
                                <span class="font-bold text-gray-800 text-xs px-2 py-0.5 rounded bg-gray-100">${log.action_type}</span>
                                <span class="text-xs text-gray-400">${new Date(log.timestamp).toLocaleString()}</span>
                             </div>
                             <div class="text-gray-600 truncate">${log.details ? JSON.stringify(JSON.parse(log.details)) : '-'}</div>
                         </div>
                    `).join('');
                } else {
                    auditList.innerHTML = `<p class="text-gray-400 text-center py-4">기록된 로그가 없습니다.</p>`;
                }
            } catch (e) {
                console.error("Failed to fetch audit logs:", e);
                auditList.innerHTML = `<p class="text-red-400 text-center py-4">로그 로딩 실패</p>`;
            }
        }
    },

    // --- Logging System ---

    logAction: async function (action, table, targetId, details) {
        if (!this.state.user) return;

        // Fire and forget
        window.SupabaseClient.supabase.from('audit_logs').insert([{
            user_id: this.state.user.id,
            action_type: action,
            target_table: table,
            target_id: targetId,
            changes: JSON.stringify(details)
        }]).then(({ error }) => {
            if (error) console.error("Audit Log Error:", error);
        });
    },

    logError: async function (msg, url, line, col, errorObj) {
        const errDetails = {
            msg: msg,
            url: url,
            line: line,
            col: col,
            stack: errorObj?.stack
        };
        console.error("Capturing Client Error:", errDetails);

        window.SupabaseClient.supabase.from('error_logs').insert([{
            error_message: msg,
            stack_trace: JSON.stringify(errDetails),
            user_id: this.state.user?.id || null // Log user if known
        }]).then(({ error }) => {
            if (error) console.error("Failed to log error to DB:", error);
        });
    }
};

// Global Error Handler
window.onerror = function (msg, url, line, col, error) {
    if (window.App && window.App.logError) {
        window.App.logError(msg, url, line, col, error);
    }
    return false; // Let default handler run too
};

// Start Application
document.addEventListener('DOMContentLoaded', () => {
    window.App = App; // Expose for inline handlers
    App.init();
});
