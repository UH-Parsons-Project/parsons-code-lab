import { escapeHtml } from '../utils/ui-utils.js';
import { fetchJsonWithError } from '../utils/api-utils.js';

export function buildDescriptionFieldMarkup(taskSet, fieldName, label, isOwner) {
  const value = String(taskSet[fieldName] ?? '').trim();
  const hasValue = value.length > 0;
  const placeholder = fieldName === 'teacher_description'
    ? 'No teacher notes yet.'
    : 'No student instructions yet.';
  const actionLabel = hasValue ? 'Edit' : 'Add';
  const editButton = isOwner
    ? `<button type="button" class="btn btn-sm btn-link p-0 description-edit-btn" data-description-field="${fieldName}" title="${hasValue ? `Edit ${label}` : `Add ${label}`}" style="font-size:.8rem;"><i class="fas fa-pencil-alt"></i> ${actionLabel}</button>`
    : '';
  const content = hasValue
    ? `<div class="task-set-description-display" style="white-space:pre-wrap; line-height:1.5;">${escapeHtml(value)}</div>`
    : `<div class="task-set-description-empty text-muted" style="font-style:italic;">${placeholder}</div>`;
  const boxClass = fieldName === 'teacher_description'
    ? 'teacher-notes-box'
    : 'student-instructions-box';

  return `
    <div id="${fieldName}-description-box" class="${boxClass}">
      <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
        <strong>${label}:</strong>
        ${editButton}
      </div>
      ${content}
    </div>
  `;
}

export function setupDescriptionEdit(taskSet, isOwner) {
  if (!isOwner) return;

  const fields = [
    { key: 'teacher_description', label: 'Teacher Notes' },
    { key: 'student_description', label: 'Student Instructions' },
  ];

  fields.forEach(({ key, label }) => {
    const box = document.getElementById(`${key}-description-box`);
    const editButton = box?.querySelector('[data-description-field]');
    if (!box || !editButton) return;

    editButton.addEventListener('click', () => {
      const currentValue = String(taskSet[key] ?? '');
      box.innerHTML = `
        <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
          <strong>${label}:</strong>
        </div>
        <textarea id="${key}-input" class="form-control form-control-sm" rows="5" style="resize:vertical;">${escapeHtml(currentValue)}</textarea>
        <div class="mt-2 d-flex gap-2">
          <button type="button" class="btn btn-sm btn-primary" data-description-save="${key}">Save</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-description-cancel="${key}">Cancel</button>
        </div>
      `;

      const textarea = box.querySelector('textarea');
      const saveButton = box.querySelector(`[data-description-save="${key}"]`);
      const cancelButton = box.querySelector(`[data-description-cancel="${key}"]`);
      textarea?.focus();
      textarea?.select();

      cancelButton?.addEventListener('click', () => {
        box.outerHTML = buildDescriptionFieldMarkup(taskSet, key, label, true);
        setupDescriptionEdit(taskSet, true);
      });

      saveButton?.addEventListener('click', async () => {
        if (!saveButton || !textarea) return;
        saveButton.disabled = true;
        if (cancelButton) cancelButton.disabled = true;

        try {
          const updatedTaskSet = await fetchJsonWithError(
            `/api/my_sets/${encodeURIComponent(taskSet.id)}/descriptions`,
            'Failed to update task set description',
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ [key]: textarea.value.trim() || null }),
            }
          );
          taskSet[key] = updatedTaskSet[key] ?? null;
          box.outerHTML = buildDescriptionFieldMarkup(taskSet, key, label, true);
          setupDescriptionEdit(taskSet, true);
        } catch (error) {
          alert(error.message || 'Failed to update task set description.');
          box.outerHTML = buildDescriptionFieldMarkup(taskSet, key, label, true);
          setupDescriptionEdit(taskSet, true);
        }
      });
    });
  });
}