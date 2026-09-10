import { escapeHtml } from '../utils/ui-utils.js';
import { isPrivateTask } from './privacy-badge.js';

export const DEFAULT_TAGS = [
    'algorithms',
    'arithmetic',
    'booleans',
    'classes',
    'comprehensions',
    'conditionals',
    'debugging',
    'dictionaries',
    'exceptions',
    'files',
    'functions',
    'imports',
    'input',
    'lists',
    'loops',
    'other',
    'printing',
    'recursion',
    'searching',
    'sets',
    'sorting',
    'strings',
    'testing',
    'tuples',
    'typecasting',
    'variables',
];

export class TaskSearchFilter {
    constructor(containerId, options = {}) {
        this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        if (!this.container) throw new Error(`Container ${containerId} not found`);

        this.allTasks = [];
        this.onFilter = options.onFilter || (() => {});
        this.currentTeacherId = options.currentTeacherId || null;
        this.currentTeacherUsername = options.currentTeacherUsername || '';
        
        this.activeFilters = {
            query: '',
            activeScope: null,
            selectedTags: new Set()
        };

        this.allTags = new Set(options.allTags || DEFAULT_TAGS);
        this.tagsWithTasks = new Set();
        this.render();
        this.renderTags();
        this.setupListeners();
    }

    setTasks(tasks) {
        this.allTasks = tasks || [];
        this.extractTags();
        this.renderTags();
        this.applyFilters();
    }

    updateTeacher(teacherId, username) {
        this.currentTeacherId = teacherId;
        this.currentTeacherUsername = username;
        this.extractTags();
        this.renderTags();
        this.applyFilters();
    }

    extractTags() {
        this.allTags = new Set(DEFAULT_TAGS);
        this.tagsWithTasks = new Set();
        this.allTasks.forEach(task => {
            const creatorUsername = (task.creator_username || '').toLowerCase();
            const ownTask = this.isOwnTask(task, creatorUsername);

            if (isPrivateTask(task) && !ownTask) {
                return;
            }

            const tag = (task.task_type || 'normal').toLowerCase();
            if (tag) {
                this.allTags.add(tag);
                this.tagsWithTasks.add(tag);
            }
        });

        for (const tag of this.activeFilters.selectedTags) {
            if (!this.tagsWithTasks.has(tag)) {
                this.activeFilters.selectedTags.delete(tag);
            }
        }
    }

    render() {
        this.container.innerHTML = `
            <div class="task-filter-menu mb-4">
                <button
                    class="btn btn-outline-secondary task-filter-toggle"
                    id="task-filter-toggle"
                    type="button"
                    aria-expanded="false"
                >
                    <i class="fas fa-bars"></i> Search & Filter
                </button>

                <div class="task-filter-panel collapse mt-2" id="task-filter-panel">
                    <div class="filter-panel-content">
                        <div class="form-group mb-3">
                            <input type="text" class="form-control" id="task-search" placeholder="Search tasks...">
                            <small class="form-text text-muted mt-1">Search by title, type, or teacher</small>
                        </div>

                        <div class="d-flex flex-wrap" style="gap: 2rem;">
                            <div class="filter-scopes mb-3 flex-grow-1">
                                <label class="filter-scope-label font-weight-bold">Search only in:</label>
                                <div class="scope-checkboxes d-flex flex-wrap gap-3">
                                    <div class="custom-control custom-checkbox mr-3">
                                        <input type="checkbox" class="custom-control-input filter-scope" id="scope-title" value="title">
                                        <label class="custom-control-label" for="scope-title">Title</label>
                                    </div>
                                    <div class="custom-control custom-checkbox mr-3">
                                        <input type="checkbox" class="custom-control-input filter-scope" id="scope-teacher" value="teacher">
                                        <label class="custom-control-label" for="scope-teacher">Teacher</label>
                                    </div>
                                    <div class="custom-control custom-checkbox mr-3">
                                        <input type="checkbox" class="custom-control-input filter-scope" id="scope-my-exercises" value="my-exercises">
                                        <label class="custom-control-label" for="scope-my-exercises">My exercises</label>
                                    </div>
                                    <div class="custom-control custom-checkbox">
                                        <input type="checkbox" class="custom-control-input filter-scope" id="scope-favorites" value="favorites">
                                        <label class="custom-control-label" for="scope-favorites">Favorites</label>
                                    </div>
                                </div>
                            </div>

                            <div class="filter-tags-section mb-3" style="min-width: 200px; flex: 1;">
                                <label class="filter-scope-label font-weight-bold">Filter by tag:</label>
                                <div class="dropdown" id="tags-dropdown-container">
                                    <button class="btn btn-outline-secondary dropdown-toggle w-100 text-left d-flex justify-content-between align-items-center" type="button" id="tagsDropdown" aria-haspopup="true" aria-expanded="false">
                                        <span id="tags-dropdown-text">Select Tags...</span>
                                    </button>
                                    <div class="dropdown-menu p-3" aria-labelledby="tagsDropdown" style="width: 100%; max-height: 300px; overflow-y: auto;">
                                        <div id="tags-list" class="mb-3">
                                            <!-- Tags injected here -->
                                        </div>
                                        <button class="btn btn-primary btn-sm w-100" type="button" id="apply-tags-btn">Apply Tags</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.filterToggleBtn = this.container.querySelector('.task-filter-toggle');
        this.filterPanel = this.container.querySelector('.task-filter-panel');
        this.searchInput = this.container.querySelector('#task-search') || this.container.querySelector('#universal-task-search');
        this.scopeCheckboxes = this.container.querySelectorAll('.filter-scope');
        this.tagsList = this.container.querySelector('#tags-list');
        this.applyTagsBtn = this.container.querySelector('#apply-tags-btn');
        this.tagsDropdownText = this.container.querySelector('#tags-dropdown-text');
        
        const dropdownMenu = this.container.querySelector('.dropdown-menu');
        if (dropdownMenu) {
            dropdownMenu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    renderTags() {
        if (!this.tagsList) return;
        
        const tags = Array.from(this.allTags).sort();
        if (tags.length === 0) {
            this.tagsList.innerHTML = '<span class="text-muted">No tags available</span>';
            return;
        }

        let html = '';
        tags.forEach(tag => {
            const hasTasks = this.tagsWithTasks.has(tag);
            const isChecked = hasTasks && this.activeFilters.selectedTags.has(tag) ? 'checked' : '';
            const isDisabled = hasTasks ? '' : 'disabled';
            const textMuted = hasTasks ? '' : 'text-muted';
            const disabledStyle = hasTasks ? '' : 'style="opacity: 0.6; pointer-events: none;"';

            html += `
                <div class="custom-control custom-checkbox mb-2" ${disabledStyle}>
                    <input type="checkbox" class="custom-control-input tag-checkbox" id="tag-${escapeHtml(tag)}" value="${escapeHtml(tag)}" ${isChecked} ${isDisabled}>
                    <label class="custom-control-label ${textMuted}" for="tag-${escapeHtml(tag)}">${escapeHtml(tag)}</label>
                </div>
            `;
        });
        this.tagsList.innerHTML = html;
        this.updateTagsDropdownText();
    }

    updateTagsDropdownText() {
        if (this.activeFilters.selectedTags.size === 0) {
            this.tagsDropdownText.textContent = 'Select Tags...';
        } else {
            this.tagsDropdownText.textContent = `${this.activeFilters.selectedTags.size} tags selected`;
        }
    }

    setupListeners() {
        this.filterToggleBtn.addEventListener('click', () => {
            const isExpanded = this.filterPanel.classList.contains('show');
            this.filterPanel.classList.toggle('show', !isExpanded);
            this.filterToggleBtn.setAttribute('aria-expanded', String(!isExpanded));
        });

        const dropdownToggle = this.container.querySelector('#tagsDropdown');
        const dropdownMenu = this.container.querySelector('.dropdown-menu');
        const dropdownContainer = this.container.querySelector('#tags-dropdown-container');

        if (dropdownToggle && dropdownMenu) {
            dropdownToggle.addEventListener('click', () => {
                const isExpanded = dropdownToggle.getAttribute('aria-expanded') === 'true';
                dropdownToggle.setAttribute('aria-expanded', String(!isExpanded));
                dropdownMenu.classList.toggle('show');
                dropdownContainer.classList.toggle('show');
            });

            document.addEventListener('click', (e) => {
                if (dropdownContainer && !dropdownContainer.contains(e.target)) {
                    dropdownToggle.setAttribute('aria-expanded', 'false');
                    dropdownMenu.classList.remove('show');
                    dropdownContainer.classList.remove('show');
                }
            });
        }

        this.searchInput.addEventListener('input', (e) => {
            this.activeFilters.query = e.target.value.trim().toLowerCase();
            this.applyFilters();
        });

        this.scopeCheckboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.scopeCheckboxes.forEach(other => {
                        if (other !== e.target) {
                            other.checked = false;
                        }
                    });
                    this.activeFilters.activeScope = e.target.value;
                } else {
                    this.activeFilters.activeScope = null;
                }
                this.applyFilters();
            });
        });

        this.applyTagsBtn.addEventListener('click', () => {
            const tagCheckboxes = this.container.querySelectorAll('.tag-checkbox:not(:disabled)');
            this.activeFilters.selectedTags.clear();
            tagCheckboxes.forEach(cb => {
                if (cb.checked) {
                    this.activeFilters.selectedTags.add(cb.value);
                }
            });
            this.updateTagsDropdownText();
            this.applyFilters();
            
            const dropdownToggle = this.container.querySelector('#tagsDropdown');
            const dropdownMenu = this.container.querySelector('.dropdown-menu');
            const dropdownContainer = this.container.querySelector('#tags-dropdown-container');
            
            if (dropdownToggle && dropdownMenu && dropdownContainer) {
                dropdownToggle.setAttribute('aria-expanded', 'false');
                dropdownMenu.classList.remove('show');
                dropdownContainer.classList.remove('show');
            }
        });
    }

    isOwnTask(task, creatorUsername) {
        const byTeacherId = this.currentTeacherId !== null && Number(task.created_by_teacher_id) === this.currentTeacherId;
        const byTeacherName = !!this.currentTeacherUsername && creatorUsername === this.currentTeacherUsername.toLowerCase();
        return byTeacherId || byTeacherName;
    }

    applyFilters() {
        const { query, activeScope, selectedTags } = this.activeFilters;

        const filteredTasks = this.allTasks.filter(task => {
            const taskTitle = (task.title || '').toLowerCase();
            const taskType = (task.task_type || 'normal').toLowerCase();
            const creatorUsername = (task.creator_username || '').toLowerCase();
            const ownTask = this.isOwnTask(task, creatorUsername);

            if (isPrivateTask(task) && !ownTask) {
                return false;
            }
            
            if (selectedTags.size > 0 && !selectedTags.has(taskType)) {
                return false;
            }

            if (!query) {
                if (activeScope === 'my-exercises') return ownTask;
                if (activeScope === 'favorites') return Boolean(task.is_favorite);
                return true;
            }

            if (!activeScope) {
                return taskTitle.includes(query) || taskType.includes(query) || creatorUsername.includes(query);
            }

            if (activeScope === 'title') return taskTitle.includes(query);
            if (activeScope === 'type') return taskType.includes(query);
            if (activeScope === 'teacher') return creatorUsername.includes(query);
            if (activeScope === 'my-exercises') return ownTask && (taskTitle.includes(query) || taskType.includes(query));
            if (activeScope === 'favorites') return Boolean(task.is_favorite) && (taskTitle.includes(query) || taskType.includes(query) || creatorUsername.includes(query));

            return false;
        });

        filteredTasks.sort((a, b) => {
            const titleA = (a.title || '').toLowerCase();
            const titleB = (b.title || '').toLowerCase();
            return titleA.localeCompare(titleB);
        });

        this.onFilter(filteredTasks);
    }
}
