import { initSignedInAs, initProtectedPage, initBurgerMenu } from '../core/auth-ui.js';
import { createPrivateBadge, isPrivateTask } from '../components/privacy-badge.js';
import { escapeHtml, showError } from '../utils/ui-utils.js';
import { openTaskPreview, setupPreviewModalClose } from './task-preview.js';
import { createAvailableTaskElement } from './task-helpers.js';
import { TaskSearchFilter } from '../components/task-search-filter.js';
    initSignedInAs();
    initProtectedPage('/');
    initBurgerMenu();

/**
 * Task Set Creation Form Module
 * Handles form interactions, task selection, and task set creation
 */

let allTasks = [];
let selectedTaskIds = [];  // Array to preserve order
let draggedElement = null;

let currentTeacherUsername = '';
let searchFilter = null;

/**
 * Initialize the page when DOM is ready
 */
function initializePage() {
  searchFilter = new TaskSearchFilter('universal-task-search', {
    onFilter: renderTasks
  });
  loadUsername();
  setupViewerSharing();
  setupFormSubmission();
  setupCancelButton();
  setupPreviewModalClose();
  loadTasks();
}

/**
 * Confirm before discarding the in-progress task set and returning to the dashboard.
 */
function setupCancelButton() {
  const cancelLink = document.getElementById('cancel-task-set');
  if (!cancelLink) return;

  cancelLink.addEventListener('click', (e) => {
    e.preventDefault();
    const confirmed = window.confirm(
      'Are you sure you want to cancel? Any unsaved changes will be lost.'
    );
    if (!confirmed) {
      return;
    }
    window.location.href = cancelLink.href;
  });
}

/**
 * Load and display the current user's username
 */
function loadUsername() {
  const userNameEl = document.getElementById('user-name');
  const storedUsername = localStorage.getItem('username');




  if (storedUsername) {
    userNameEl.textContent = storedUsername;
    currentTeacherUsername = storedUsername;
  }

  fetch('/api/me', { credentials: 'include' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => {
      if (data?.username) {
        userNameEl.textContent = data.username;
        currentTeacherUsername = data.username;
        localStorage.setItem('username', data.username);
      }

      if (typeof data?.id === 'number') {
        // previously updated currentTeacherId here, now unneeded
      }

      if (searchFilter) {
        searchFilter.updateTeacher(data.id, data.username);
      }
    })
    .catch(() => {
      if (!storedUsername) {
        userNameEl.textContent = '';
      }
    });
}


// Filter UI logic moved to TaskSearchFilter component

// Each entry: { teacher_id, username, email }
let validatedViewers = [];

function setupViewerSharing() {
  const input = document.getElementById('viewer-identifiers');
  const addBtn = document.getElementById('add-viewer-btn');
  if (!input || !addBtn) return;

  const addHandler = async () => {
    const identifier = input.value.trim();
    if (!identifier) return;
    addBtn.disabled = true;
    input.disabled = true;
    const added = await addViewerByIdentifier(identifier);
    if (added) input.value = '';
    input.disabled = false;
    addBtn.disabled = false;
    input.focus();
  };

  addBtn.addEventListener('click', addHandler);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addHandler(); }
  });

  renderViewerList();
}

function showViewerError(message) {
  const container = document.getElementById('viewer-errors');
  if (!container) return;
  container.innerHTML = `<div class="text-danger small">${escapeHtml(message)}</div>`;
  setTimeout(() => { container.innerHTML = ''; }, 4000);
}

async function addViewerByIdentifier(identifier) {
  try {
    const response = await fetch(
      `/api/teachers/lookup?identifier=${encodeURIComponent(identifier)}`,
      { credentials: 'include' }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      throw new Error(err?.detail || 'Teacher not found');
    }
    const teacher = await response.json();

    if (teacher.username.toLowerCase() === currentTeacherUsername.toLowerCase()) {
      showViewerError('You cannot add yourself as a viewer.');
      return false;
    }

    const already = validatedViewers.some(v => v.teacher_id === teacher.teacher_id);
    if (already) {
      showViewerError(`${teacher.username} is already added.`);
      return false;
    }

    validatedViewers.push(teacher);
    renderViewerList();
    return true;
  } catch (error) {
    showViewerError(error.message || 'Teacher not found');
    return false;
  }
}

function removeViewerById(teacherId) {
  validatedViewers = validatedViewers.filter(v => v.teacher_id !== teacherId);
  renderViewerList();
}




function renderViewerList() {
  const container = document.getElementById('viewer-list');
  if (!container) return;

  container.innerHTML = '';
  validatedViewers.forEach(viewer => {
    const item = document.createElement('div');
    item.className = 'd-flex align-items-center justify-content-between border rounded px-2 py-1 mb-2';

    const info = document.createElement('div');
    info.innerHTML = `<strong>${escapeHtml(viewer.username)}</strong> <span class="text-muted">(${escapeHtml(viewer.email)})</span>`;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-sm btn-outline-danger';
    removeBtn.title = 'Remove viewer';
    removeBtn.innerHTML = '<i class="fas fa-trash"></i>';
    removeBtn.addEventListener('click', () => removeViewerById(viewer.teacher_id));

    item.appendChild(info);
    item.appendChild(removeBtn);
    container.appendChild(item);
  });
}

/**
 * Load tasks from the backend API
 */
async function loadTasks() {
  const loadingEl = document.getElementById('tasks-loading');
  loadingEl.style.display = 'flex';

  try {
    const response = await fetch('/api/tasks', { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to load tasks');
    allTasks = await response.json();
    if (searchFilter) {
      searchFilter.setTasks(allTasks);
    }
  } catch (error) {
    console.error('Error loading tasks:', error);
    showError('Failed to load tasks. Please try again.');
  } finally {
    loadingEl.style.display = 'none';
  }
}

/**
 * Render available tasks in the task selector
 */
function renderTasks(tasks) {
  const selector = document.getElementById('task-selector');
  selector.innerHTML = '';

  if (tasks.length === 0) {
    selector.innerHTML = '<p class="text-muted">No tasks available</p>';
    return;
  }

  tasks.forEach(task => {
    const taskEl = createAvailableTaskElement(task, {
      isSelected: selectedTaskIds.includes(task.id),
      onSelectionChange: handleTaskSelection,
      onFavoriteToggle: () => {
        if (searchFilter) searchFilter.applyFilters();
      }
    });
    selector.appendChild(taskEl);
  });
}

/**
 * Handle task selection/deselection
 */
function handleTaskSelection(taskId, isSelected) {
  if (isSelected) {
    if (!selectedTaskIds.includes(taskId)) {
      selectedTaskIds.push(taskId);
    }
  } else {
    selectedTaskIds = selectedTaskIds.filter(id => id !== taskId);
  }
  updateSelectedTasksPreview();
  if (searchFilter) {
    searchFilter.applyFilters(); // Re-render to update checked state while preserving active filters
  }
}

/**
 * Update the selected tasks preview list
 */
function updateSelectedTasksPreview() {
  const listEl = document.getElementById('selected-tasks-list');
  const countEl = document.getElementById('selected-count');

  countEl.textContent = selectedTaskIds.length;

  if (selectedTaskIds.length === 0) {
    listEl.innerHTML = '<div class="empty-selected">No tasks selected yet</div>';
    return;
  }

  listEl.innerHTML = '';
  selectedTaskIds.forEach((taskId, index) => {
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;

    const itemEl = document.createElement('div');
    itemEl.className = 'selected-task-item';
    itemEl.draggable = true;
    itemEl.dataset.taskId = taskId;

    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.innerHTML = '<i class="fas fa-bars"></i>';

    const contentEl = document.createElement('div');
    contentEl.className = 'selected-task-item-content';

    const positionEl = document.createElement('div');
    positionEl.style.fontSize = '0.75rem';
    positionEl.style.color = '#6c757d';
    positionEl.style.marginBottom = '0.25rem';
    positionEl.textContent = `#${index + 1}`;

    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.gap = '.45rem';
    titleRow.style.minWidth = '0';

    const titleEl = document.createElement('div');
    titleEl.className = 'selected-task-item-title';
    titleEl.textContent = task.title;
    titleRow.appendChild(titleEl);
    if (isPrivateTask(task)) {
      titleRow.appendChild(createPrivateBadge());
    }

    const typeEl = document.createElement('div');
    typeEl.className = 'selected-task-item-type';
    typeEl.textContent = task.task_type;

    contentEl.appendChild(positionEl);
    contentEl.appendChild(titleRow);
    contentEl.appendChild(typeEl);

    const controlsEl = document.createElement('div');
    controlsEl.className = 'selected-task-item-controls';

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'preview-btn';
    previewBtn.innerHTML = '<i class="fas fa-eye"></i>';
    previewBtn.title = 'Preview task';
    previewBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openTaskPreview(task);
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-task-btn';
    removeBtn.type = 'button';
    removeBtn.innerHTML = '<i class="fas fa-trash"></i>';
    removeBtn.title = 'Remove task';
    removeBtn.addEventListener('click', () => {
      handleTaskSelection(taskId, false);
    });

    controlsEl.appendChild(previewBtn);
    controlsEl.appendChild(removeBtn);

    itemEl.appendChild(dragHandle);
    itemEl.appendChild(contentEl);
    itemEl.appendChild(controlsEl);

    // Drag event handlers
    itemEl.addEventListener('dragstart', () => {
      draggedElement = itemEl;
      itemEl.classList.add('dragging');
    });

    itemEl.addEventListener('dragend', () => {
      itemEl.classList.remove('dragging');
      draggedElement = null;
    });

    itemEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedElement && draggedElement !== itemEl) {
        itemEl.classList.add('drag-over');
      }
    });

    itemEl.addEventListener('dragleave', () => {
      itemEl.classList.remove('drag-over');
    });

    itemEl.addEventListener('drop', (e) => {
      e.preventDefault();
      itemEl.classList.remove('drag-over');

      if (draggedElement && draggedElement !== itemEl) {
        const draggedIndex = selectedTaskIds.findIndex(
          id => id === parseInt(draggedElement.dataset.taskId)
        );
        const targetTaskId = parseInt(itemEl.dataset.taskId);

        if (draggedIndex !== -1) {
          // Remove the dragged item from its current position
          const draggedTaskId = selectedTaskIds[draggedIndex];
          selectedTaskIds.splice(draggedIndex, 1);

          // Find the target item's new index after removal
          const newTargetIndex = selectedTaskIds.findIndex(id => id === targetTaskId);

          // Insert the dragged item before the target item
          if (newTargetIndex !== -1) {
            selectedTaskIds.splice(newTargetIndex, 0, draggedTaskId);
          } else {
            // If target not found, append to end
            selectedTaskIds.push(draggedTaskId);
          }

          updateSelectedTasksPreview();
        }
      }
    });

    listEl.appendChild(itemEl);
  });
}





/**
 * Show duplicate title error modal
 */
function showDuplicateTitleModal(title) {
  const messageP = document.getElementById('duplicate-error-message');
  messageP.innerHTML = `A task set with the title "<strong style="color: #dc3545;">${escapeHtml(title)}</strong>" already exists. Please choose a different name.`;

  // Scroll to top to show the modal
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Show the Bootstrap modal after a brief delay to ensure scroll completes
  setTimeout(() => {
    toggleDuplicateTitleModal(true);
  }, 300);

  // Focus back to the title input for easy editing after a brief delay
  setTimeout(() => {
    document.getElementById('task-set-title').focus();
    document.getElementById('task-set-title').select();
  }, 500);
}

function toggleDuplicateTitleModal(show) {
  const modalEl = document.getElementById('duplicate-title-modal');
  if (!modalEl) return;

  // Bootstrap 4 modal API via jQuery when available.
  if (window.jQuery) {
    window.jQuery(modalEl).modal(show ? 'show' : 'hide');
    return;
  }

  // Graceful fallback if jQuery is unavailable.
  modalEl.style.display = show ? 'block' : 'none';
  modalEl.classList.toggle('show', show);
  modalEl.setAttribute('aria-hidden', show ? 'false' : 'true');
}

/**
 * Close duplicate title modal
 */
function closeDuplicateTitleModal() {
  toggleDuplicateTitleModal(false);
  document.getElementById('task-set-title').focus();
}

window.closeDuplicateTitleModal = closeDuplicateTitleModal;

/**
 * Show success message
 */
function showSuccess(message) {
  const container = document.getElementById('error-container');
  container.innerHTML = `<div class="success-message"><i class="fas fa-check-circle"></i> ${message}</div>`;
  // Scroll to success message
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => {
    container.innerHTML = '';
  }, 3000);
}



/**
 * Setup form submission
 */
function setupFormSubmission() {
  document.getElementById('create-task-set-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = document.getElementById('task-set-title').value.trim();
    const studentDescription = document.getElementById('student-description').value.trim();
    const teacherDescription = document.getElementById('teacher-description').value.trim();
    const openingDate = document.getElementById('opening-date')?.value || null;
    const expirationDate = document.getElementById('expiration-date').value || null;

    const viewersToShare = [...validatedViewers];

    if (!title || title.length < 4) {
      showError('Task set title must be at least 4 characters long');
      return;
    }

    if (selectedTaskIds.length === 0) {
      window.alert('Please select at least one task before creating the task set.');
      return;
    }

    if (openingDate && expirationDate && new Date(openingDate) > new Date(expirationDate)) {
      window.alert('Opening Date is set later than Expiration Date. Please set new times.');
      return;
    }

    const submitBtn = document.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

    try {
      // Create task set
      const createResponse = await fetch('/api/create_task_set', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          student_description: studentDescription || null,
          teacher_description: teacherDescription || null,
          opens_at: openingDate ? new Date(openingDate).toISOString() : null,
          expires_at: expirationDate ? new Date(expirationDate).toISOString() : null,
          task_ids: selectedTaskIds
        })
      });

      if (!createResponse.ok) {
        const error = await createResponse.json().catch(() => null);
        const errorDetail = error?.detail || 'Failed to create task set';

        // Check if this is a duplicate title error
        if (errorDetail.includes('already exists') || errorDetail.includes('title')) {
          showDuplicateTitleModal(title);
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-save"></i> Create Task Set';
          return;
        }

        throw new Error(errorDetail);
      }

      const createdList = await createResponse.json();

      const viewerErrors = [];
      for (const viewer of viewersToShare) {
        try {
          const viewerResponse = await fetch(`/api/my_sets/${createdList.id}/viewers`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: viewer.username })
          });

          if (!viewerResponse.ok) {
            const viewerError = await viewerResponse.json().catch(() => null);
            const detail = viewerError?.detail || `HTTP ${viewerResponse.status}`;
            viewerErrors.push(`${viewer.username} (${detail})`);
          }
        } catch (error) {
          viewerErrors.push(`${viewer.username} (network error)`);
        }
      }

      let successMessage = 'Task list created successfully!';
      if (viewerErrors.length > 0) {
        successMessage += ` Viewers not added: ${viewerErrors.join(', ')}.`;
      }
      showSuccess(successMessage);

      setTimeout(() => {
        window.location.href = `/teacher-dashboard`;
      }, 1500);
    } catch (error) {
      console.error('Error creating task set:', error);
      showError(error.message || 'Failed to create task set');
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Create Task Set';
    }
  });
}

document.addEventListener('DOMContentLoaded', initializePage);

