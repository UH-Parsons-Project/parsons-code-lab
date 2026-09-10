import { escapeHtml } from '../utils/ui-utils.js';
import { buildReprFromBlocks, renderParsonsBoard } from '../utils/parsons-editor-utils.js';

/**
 * Open interactive task preview in modal
 * @param {Object} taskListItem - Task object with id property
 */
export async function openTaskPreview(taskListItem) {
	try {
		const response = await fetch(`/api/tasks/${taskListItem.id}`, { credentials: 'include' });
		if (!response.ok) {
			throw new Error('Failed to load task details');
		}
		const task = await response.json();
		const modelAnswerResponse = await fetch(`/api/problems/${taskListItem.id}/model-answer`, { credentials: 'include' });
		if (modelAnswerResponse.ok) {
			const modelAnswerData = await modelAnswerResponse.json();
			task.model_answer = modelAnswerData.model_answer || '';
		}

		const modal = document.getElementById('student-preview-modal');
		const previewTaskTitle = document.getElementById('preview-task-title');
		const previewStartIntro = document.getElementById('preview-start-intro');
		const previewText = document.getElementById('preview-problem-text');
		const previewSource = document.getElementById('preview-source-sortable');
		const previewSolution = document.getElementById('preview-solution-sortable');
		const previewWrittenTests = document.getElementById('preview-written-tests');
		const previewModelAnswer = document.getElementById('preview-model-answer');

		if (!modal) {
			console.error('Preview modal not found.');
			return;
		}

		const startIntro = task.description || '';
		let problemStatement = '';
		try {
			const instr = JSON.parse(task.task_instructions || '{}');
			const baseText = instr.task_instructions || '';
			problemStatement = escapeHtml(baseText).replace(/\n/g, '<br>');
			if (instr.function_name) {
				problemStatement = `<strong>${escapeHtml(instr.function_name)}</strong><br>` + problemStatement;
			}
			if (instr.examples) {
				problemStatement += `<br><br><strong>Examples:</strong><pre style="margin-top: 0.5rem; background: #f1f5f9; padding: 0.75rem; border-radius: 6px;"><code>${escapeHtml(instr.examples)}</code></pre>`;
			}
		} catch (e) {
			problemStatement = escapeHtml(task.task_instructions || '').replace(/\n/g, '<br>');
		}

		const tests = task.correct_solution?.teacher_tests || '';
		const modelAnswerCode = task.model_answer || '';
		const isOrderOnly = task.correct_solution?.eval_type === 'order_only';

		previewTaskTitle.innerHTML = escapeHtml(task.title || '').replace(/\n/g, '<br>');
		previewStartIntro.innerHTML = escapeHtml(startIntro).replace(/\n/g, '<br>');
		previewText.innerHTML = problemStatement;
		const previewTaskType = document.getElementById('preview-task-type');
		if (previewTaskType) {
			previewTaskType.textContent = task.task_type ? `Task tag: ${task.task_type}` : 'Task tag not selected yet.';
		}

		const writtenTestsRow = previewWrittenTests?.closest('.row') || previewWrittenTests?.closest('.card');
		if (writtenTestsRow) {
			writtenTestsRow.style.display = isOrderOnly ? 'none' : '';
		}
		if (previewWrittenTests) {
			previewWrittenTests.textContent = tests.trim() || 'No tests written yet.';
		}
		if (previewModelAnswer) {
			previewModelAnswer.textContent = modelAnswerCode.trim() || 'No model answer set yet.';
		}

		const previewRepr = buildReprFromBlocks(task);
		renderParsonsBoard(previewRepr, {
			sourceSortable: previewSource,
			solutionSortable: previewSolution,
			ParsonsWidgetCtor: window.ParsonsWidget,
			can_indent: true,
			idPrefix: 'preview-sortable-codeline',
			useStudentGiven: true,
		});

		modal.classList.add('open');
		modal.setAttribute('aria-hidden', 'false');
		document.body.style.overflow = 'hidden';
	} catch (error) {
		console.error('Error previewing task:', error);
		alert('Could not load task preview.');
	}
}

/**
 * Setup modal close listeners for student preview modal
 */
export function setupPreviewModalClose() {
	const closeBtn = document.getElementById('close-student-preview');
	const modal = document.getElementById('student-preview-modal');

	function closeModal() {
		if (modal) {
			modal.classList.remove('open');
			modal.setAttribute('aria-hidden', 'true');
			document.body.style.overflow = '';
		}
	}

	if (closeBtn) {
		closeBtn.addEventListener('click', closeModal);
	}

	if (modal) {
		modal.addEventListener('click', (event) => {
			if (event.target === modal) {
				closeModal();
			}
		});
	}
}
