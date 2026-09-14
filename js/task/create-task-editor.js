/*
 * Create Task Problem Builder
 * Builds parsons-style code blocks from teacher-authored source code.
 */
import { FiniteWorker } from '../core/worker-manager.js';
import { processTestError } from '../core/doctest-grader.js';
import { initProtectedPage, initBurgerMenu, initSignedInAs } from "../core/auth-ui.js";
import { escapeHtml } from '../utils/ui-utils.js';
import { buildReprFromBlocks, buildCustomRepr, renderParsonsBoard } from '../utils/parsons-editor-utils.js';

initSignedInAs();
initProtectedPage('/');
initBurgerMenu();

(function initCreateTaskProblemBuilder() {
  const DRAFT_KEY = 'create_task_draft_payload';
  const BLOCKS_KEY = 'create_task_builder_blocks';
  const BLOCKS_SOURCE_KEY = 'create_task_builder_blocks_source';
  const BLANK_VALUES_KEY = 'create_task_builder_blank_values';
  const META_KEY = 'create_task_builder_meta';
  const META_SOURCE_KEY = 'create_task_builder_meta_source';
  const MODEL_ANSWER_KEY = 'create_task_builder_model_answer';
  const MODEL_ANSWER_REPR_KEY = 'create_task_builder_model_answer_repr';
  const MODEL_ANSWER_SOURCE_KEY = 'create_task_builder_model_answer_source';
  const MODEL_ANSWER_UPDATED_AT_KEY = 'create_task_builder_model_answer_updated_at';
  const TASK_TYPE_OPTIONS = [
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

  let draftPayload = null;
  let parsonsWidget = null;
  let previewParsonsWidget = null;
  let modelAnswerCode = '';
  let modelAnswerRepr = '';
  let modelAnswerUpdatedAt = '';
  let persistedModelAnswerSource = '';
  let hasOpenedStudentPreview = false;
  let testsPassed = false;

  function clearTaskDraftStorage() {
    [localStorage, sessionStorage].forEach((storage) => {
      Object.keys(storage)
        .filter((key) => key.startsWith('create_task_'))
        .forEach((key) => storage.removeItem(key));
    });
  }

  function updateAddToListState() {
    const addToListBtn = document.getElementById('add-to-problem-list');
    const evalTypeInput = document.getElementById('eval-type');
    const isOrderOnly = evalTypeInput?.value === 'order_only';
    if (addToListBtn) {
      addToListBtn.disabled = !((isOrderOnly || testsPassed) && hasOpenedStudentPreview);
    }

    updateChecklist();
  }

  function updateChecklist() {
    const checklist = document.getElementById('task-checklist');
    if (!checklist) {
      return;
    }

    const taskTitleInput = document.getElementById('task-title');
    const startDescriptionInput = document.getElementById('start-description');
    const descriptionInput = document.getElementById('problem-description');
    const testsInput = document.getElementById('tests-input');
    const customErrorMessagesInput = document.getElementById('custom-error-messages');
    const taskTypeInput = document.getElementById('task-type');
    const evalTypeInput = document.getElementById('eval-type');
    const solutionList = document.querySelector('#solution-sortable ul');
    const hasSolutionBlocks = Boolean(solutionList && solutionList.querySelectorAll('li').length > 0);
    const taskTypeValue = normalizeTaskTypeValue(taskTypeInput?.value);

    const items = [
      { key: 'title', done: Boolean(taskTitleInput && taskTitleInput.value.trim()) },
      { key: 'task-type', done: Boolean(taskTypeValue) },
      { key: 'start-description', done: Boolean(startDescriptionInput && startDescriptionInput.value.trim()) },
      { key: 'problem-description', done: Boolean(descriptionInput && descriptionInput.value.trim()) },
      { key: 'solution-blocks', done: hasSolutionBlocks },
      { key: 'model-answer', done: Boolean(modelAnswerCode) },
      { key: 'custom-errors', done: Boolean(customErrorMessagesInput && customErrorMessagesInput.value.trim()), optional: true },
      { key: 'tests-written', done: Boolean(evalTypeInput?.value !== 'unit_test' || (testsInput && testsInput.value.trim())) },
      { key: 'tests-passed', done: testsPassed },
      { key: 'previewed', done: hasOpenedStudentPreview },
    ];

    items.forEach(({ key, done, optional }) => {
      const item = checklist.querySelector(`[data-check="${key}"]`);
      if (!item) {
        return;
      }

      if (evalTypeInput?.value === 'order_only' && (key === 'tests-written' || key === 'tests-passed')) {
        item.style.display = 'none';
        return;
      }
      item.style.display = '';

      item.classList.toggle('is-done', done);

      const status = item.querySelector('.checklist-status');
      if (!status) {
        return;
      }

      if (done) {
        status.textContent = optional ? 'Added' : 'Done';
        status.className = 'checklist-status badge badge-success';
      } else {
        status.textContent = optional ? 'Optional' : 'Missing';
        status.className = `checklist-status badge ${optional ? 'badge-secondary' : 'badge-danger'}`;
      }
    });
  }


  function formatTaskTypeLabel(taskType) {
    return taskType
      ? taskType.charAt(0).toUpperCase() + taskType.slice(1)
      : '';
  }

  function normalizeTaskTypeValue(taskType) {
    const normalized = (taskType || '').trim();
    return TASK_TYPE_OPTIONS.includes(normalized) ? normalized : '';
  }

  function populateTaskTypeOptions() {
    const taskTypeInput = document.getElementById('task-type');
    if (!taskTypeInput) {
      return;
    }

    const currentValue = normalizeTaskTypeValue(taskTypeInput.value);
    taskTypeInput.innerHTML = [
      '<option value="" disabled>Select a task tag</option>',
      ...TASK_TYPE_OPTIONS.map((taskType) => `<option value="${taskType}">${formatTaskTypeLabel(taskType)}</option>`),
    ].join('');
    taskTypeInput.value = currentValue;
  }

  function openStudentPreview() {
    const modal = document.getElementById('student-preview-modal');
    const previewTaskTitle = document.getElementById('preview-task-title');
    const previewStartIntro = document.getElementById('preview-start-intro');
    const previewText = document.getElementById('preview-problem-text');
    const previewTaskType = document.getElementById('preview-task-type');
    const previewSource = document.getElementById('preview-source-sortable');
    const previewSolution = document.getElementById('preview-solution-sortable');
    const previewModelAnswer = document.getElementById('preview-model-answer');
    const taskTitleInput = document.getElementById('task-title');
    const descriptionInput = document.getElementById('problem-description');
    const examplesInput = document.getElementById('examples-input');
    const startDescriptionInput = document.getElementById('start-description');
    const testsInput = document.getElementById('tests-input');
    const ParsonsWidgetCtor = window.ParsonsWidget;

    if (!modal || !previewTaskTitle || !previewStartIntro || !previewText || !previewTaskType || !previewSource || !previewSolution || !previewModelAnswer || !parsonsWidget || !ParsonsWidgetCtor) {
      return;
    }

    const taskTitle = taskTitleInput?.value.trim() || 'No task name provided yet.';
    const startIntro = startDescriptionInput?.value.trim() || 'No start page intro provided yet.';
    const problemStatement = descriptionInput?.value.trim() || 'No problem statement provided yet.';
    const examplesText = examplesInput?.value.trim() || '';
    const taskType = getTaskTypeValue();
    previewTaskTitle.innerHTML = escapeHtml(taskTitle).replace(/\n/g, '<br>');
    previewStartIntro.innerHTML = escapeHtml(startIntro).replace(/\n/g, '<br>');

    let problemHtml = escapeHtml(problemStatement).replace(/\n/g, '<br>');
    if (examplesText) {
      problemHtml += `<br><br><strong>Examples:</strong><pre style="margin-top: 0.5rem; background: #f1f5f9; padding: 0.75rem; border-radius: 6px;"><code>${escapeHtml(examplesText)}</code></pre>`;
    }
    previewText.innerHTML = problemHtml;
    previewTaskType.textContent = taskType ? `Task tag: ${taskType}` : 'Task tag not selected yet.';

    const evalTypeInput = document.getElementById('eval-type');
    const evalType = evalTypeInput?.value || 'unit_test';
    const isOrderOnly = evalType === 'order_only';
    
    const previewEvalTitle = document.getElementById('preview-eval-title');
    const previewEvalBody = document.getElementById('preview-eval-body');
    const stdoutTestsInput = document.getElementById('stdout-tests-input');
    const expectedOutputInput = document.getElementById('expected-output-input');
    
    if (previewEvalTitle && previewEvalBody) {
      previewEvalBody.innerHTML = '';
      
      if (evalType === 'unit_test') {
        previewEvalTitle.innerHTML = 'Function Unit Tests';
        const pre = document.createElement('pre');
        pre.className = 'code-display';
        pre.style.cssText = 'border-radius: 0; border: none; margin: 0; padding: 1.25rem;';
        pre.textContent = testsInput?.value.trim() || 'No unit tests configured.';
        previewEvalBody.appendChild(pre);
        
      } else if (evalType === 'stdout') {
        previewEvalTitle.innerHTML = 'Console Output Evaluation';
        const paddingDiv = document.createElement('div');
        paddingDiv.className = 'p-3';
        
        const driverLabel = document.createElement('h6');
        driverLabel.className = 'font-weight-bold mb-2';
        driverLabel.textContent = 'Function Calls / Driver Code';
        paddingDiv.appendChild(driverLabel);
        
        const driverPre = document.createElement('pre');
        driverPre.className = 'code-display mb-3';
        driverPre.style.cssText = 'border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 1rem; padding: 1.25rem;';
        driverPre.textContent = stdoutTestsInput?.value.trim() || 'No driver code configured.';
        paddingDiv.appendChild(driverPre);
        
        const outputLabel = document.createElement('h6');
        outputLabel.className = 'font-weight-bold mb-2';
        outputLabel.textContent = 'Expected Output';
        paddingDiv.appendChild(outputLabel);
        
        const outputPre = document.createElement('pre');
        outputPre.className = 'code-display mb-0';
        outputPre.style.cssText = 'border-radius: 6px; border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a; margin-bottom: 0; padding: 1.25rem;';
        outputPre.textContent = expectedOutputInput?.value.trim() || 'No expected output configured.';
        paddingDiv.appendChild(outputPre);
        
        previewEvalBody.appendChild(paddingDiv);
        
      } else if (evalType === 'order_only') {
        previewEvalTitle.innerHTML = 'Order Only (Conceptual)';
        const paddingDiv = document.createElement('div');
        paddingDiv.className = 'p-3';
        
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-info mb-0';
        alertDiv.innerHTML = '<i class="fas fa-info-circle mr-2"></i> Conceptual task. No code execution or tests are required.';
        paddingDiv.appendChild(alertDiv);
        
        previewEvalBody.appendChild(paddingDiv);
      }
    }
    const previewModelAnswerText = sanitizeBlankInputMarkup(modelAnswerCode || '') || getSolutionCodeWithBlanks();
    previewModelAnswer.textContent = previewModelAnswerText || 'No model answer set yet.';

    previewSource.innerHTML = '';
    previewSolution.innerHTML = '';

    previewParsonsWidget = new ParsonsWidgetCtor({
      sortableId: previewSolution,
      trashId: previewSource,
      containment: previewSource.closest('.card-body'),
      trash_label: 'Drag from here',
      solution_label: 'Construct your solution here, including indents',
    });

    previewParsonsWidget.id_prefix = 'preview-sortable-codeline';

    const previewRepr = buildCustomRepr(parsonsWidget, normalizeSourceCode) || modelAnswerRepr;
    const cleanPreviewRepr = normalizeBlankMarkup(previewRepr);

    let fullPreviewRepr = cleanPreviewRepr;
    if (!isOrderOnly) {
      fullPreviewRepr = (fullPreviewRepr ? fullPreviewRepr.trimEnd() + '\n' : '') +
        "print('DEBUG:', !BLANK)\n" +
        "print('DEBUG:', !BLANK)\n" +
        "# !BLANK\n" +
        "# !BLANK";
    }

    previewParsonsWidget.init(fullPreviewRepr);

    const previewSolutionIds = previewParsonsWidget.studentGiven ? previewParsonsWidget.studentGiven.map((line) => line.id) : [];
    const previewSolutionSet = new Set(previewSolutionIds);
    const previewSourceIds = previewParsonsWidget.modified_lines
      .filter((line) => !previewSolutionSet.has(line.id))
      .map((line) => line.id);

    const isToolLine = (lineId) => {
      const line = previewParsonsWidget.getLineById(lineId);
      if (!line) return false;
      const code = line.code || line.orig || '';
      return (
        code.includes('DEBUG') ||
        code.startsWith('# <input') ||
        code.startsWith('# !BLANK') ||
        code.trim() === '#'
      );
    };

    const regularSourceIds = previewSourceIds.filter((id) => !isToolLine(id));
    const toolSourceIds = previewSourceIds.filter((id) => isToolLine(id));

    // Shuffle starter source blocks for student preview
    for (let index = regularSourceIds.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [regularSourceIds[index], regularSourceIds[randomIndex]] = [regularSourceIds[randomIndex], regularSourceIds[index]];
    }

    previewParsonsWidget.createHTMLFromLists(previewSolutionIds, [...regularSourceIds, ...toolSourceIds]);

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');

    hasOpenedStudentPreview = true;
    updateAddToListState();
  }

  function closeStudentPreview() {
    const modal = document.getElementById('student-preview-modal');
    if (!modal) {
      return;
    }

    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function setupPreviewModal() {
    const modal = document.getElementById('student-preview-modal');
    const closeBtn = document.getElementById('close-student-preview');

    if (!modal || !closeBtn) {
      return;
    }

    closeBtn.addEventListener('click', closeStudentPreview);

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeStudentPreview();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('open')) {
        closeStudentPreview();
      }
    });
  }

  function extractDefaultTitleFromCode(code) {
    const normalized = normalizeSourceCode(code || '');
    const lines = normalized.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const match = trimmed.match(/^(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (match) {
        return match[2].replace(/_/g, ' ');
      }
    }
    return 'custom_task';
  }

  function readDraftPayload() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (error) {
      console.error('Failed to parse task draft payload:', error);
      return null;
    }
  }

  function normalizeSourceCode(code) {
    return (code || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }

  function normalizeBlankMarkup(text) {
    let normalizedText = normalizeSourceCode(text || '').trimEnd();
    if (!normalizedText.includes('<input') && !normalizedText.includes('oninput=') && !normalizedText.includes('text-box')) {
      return normalizedText;
    }

    // Replace input tags with the plain placeholder, but preserve surrounding
    // whitespace and newlines so multiline representations remain intact.
    normalizedText = normalizedText
      .replace(/<input\b[^>]*>/gi, '!BLANK')
      .replace(/<\/input>/gi, '');

    return normalizedText;
  }

  function sanitizeBlankInputMarkup(text) {
    const normalizedText = normalizeBlankMarkup(text || '');
    if (!normalizedText.includes('<input') && !normalizedText.includes('#blank') && !normalizedText.includes('!BLANK')) {
      return normalizedText;
    }

    let sanitizedText = normalizedText;
    if (normalizedText.includes('<input')) {
      const container = document.createElement('div');
      container.innerHTML = normalizedText;
      container.querySelectorAll('input.text-box').forEach((input) => {
        input.replaceWith(input.value || '');
      });
      sanitizedText = container.textContent.replace(/\u00a0/g, ' ');
    }

    sanitizedText = sanitizedText.replace(/ ?#blank[^#]*#?/gi, (marker) => {
      // Remove optional leading space, the '#blank' prefix and any trailing '#'
      const inner = marker.replace(/^\s?#blank/i, '').replace(/#$/,'').trim();
      return inner || '';
    });

    return sanitizedText.trim();
  }

  function extractBlankValuesFromLine(blockCode, lineText) {
    const normalizedBlockCode = normalizeBlankMarkup(blockCode || '').trimEnd();
    const normalizedLineText = normalizeBlankMarkup(lineText || '').trimEnd();

    if ((!normalizedBlockCode.includes('___') && !normalizedBlockCode.includes('!BLANK')) || !normalizedLineText) {
      return [];
    }

    const blockCodeWithoutIndent = normalizedBlockCode.replace(/^\s+/, '');
    const lineTextWithoutIndent = normalizedLineText.replace(/^\s+/, '');

    if (!blockCodeWithoutIndent || !lineTextWithoutIndent) {
      return [];
    }

    const segments = blockCodeWithoutIndent.split(/!BLANK|___/);
    if (segments.length <= 1) {
      return [];
    }

    const escapedSegments = segments.map((segment) => segment.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const regex = new RegExp(`^${escapedSegments.join('(.*?)')}$`);
    const match = lineTextWithoutIndent.match(regex);
    return match ? match.slice(1) : [];
  }

  function getBlankValuesForBlockCode(blockCode, sourceLines = []) {
    const normalizedBlockCode = normalizeSourceCode(blockCode || '').trimEnd();
    if ((!normalizedBlockCode.includes('___') && !normalizedBlockCode.includes('!BLANK')) || !sourceLines.length) {
      return [];
    }

    for (const sourceLine of sourceLines) {
      const values = extractBlankValuesFromLine(normalizedBlockCode, sourceLine);
      if (values.length) {
        return values;
      }
    }

    return [];
  }

  function getLineInputValues(lineId) {
    const lineElement = document.getElementById(lineId);
    if (!lineElement) {
      return [];
    }

    return Array.from(lineElement.querySelectorAll('input')).map((input) => input.value || '');
  }



  function applyBlankValuesToWidgetLines(widget, blankValuesByLineId = {}) {
    if (!widget || !Array.isArray(widget.modified_lines)) {
      return;
    }

    widget.modified_lines.forEach((line) => {
      const values = blankValuesByLineId[line.id] || [];
      if (!values.length || !line || typeof line.code !== 'string') {
        return;
      }

      const normalizedCode = normalizeBlankMarkup(line.code || '').trimEnd();
      if (!normalizedCode.includes('!BLANK') && !normalizedCode.includes('___')) {
        return;
      }

      let appliedIndex = 0;
      let renderedCode = normalizedCode.replace(/___/g, '!BLANK');
      renderedCode = renderedCode.split(/!BLANK/).reduce((result, segment, index, segments) => {
        const nextCode = result + segment;
        if (index === segments.length - 1) {
          return nextCode;
        }

        const blankValue = values[appliedIndex] ?? '';
        appliedIndex += 1;
        // Append a trailing '#' so markers are unambiguous when multiple blanks exist
        return `${nextCode}!BLANK${blankValue === '' ? '' : `#blank${blankValue}#`}`;
      }, '');

      line.code = renderedCode.trimEnd();
    });
  }

  function hasWidgetHtmlArtifacts(text) {
    return /<input\b|oninput=|style\s*=\s*['"]width:\s*\d+px/i.test(text || '');
  }

  function getCachedParsonsRepr(sourceCode) {
    const cached = sessionStorage.getItem(BLOCKS_KEY);
    const cachedSource = sessionStorage.getItem(BLOCKS_SOURCE_KEY);
    const normalizedSource = normalizeSourceCode(sourceCode || '');

    if (typeof cached !== 'string' || typeof cachedSource !== 'string') {
      return '';
    }

    if (hasWidgetHtmlArtifacts(cached)) {
      sessionStorage.removeItem(BLOCKS_KEY);
      sessionStorage.removeItem(BLOCKS_SOURCE_KEY);
      return '';
    }

    return cachedSource === normalizedSource ? cached : '';
  }

  function getBlankValuesFromSession() {
    try {
      const rawValues = sessionStorage.getItem(BLANK_VALUES_KEY);
      if (!rawValues) {
        return [];
      }
      const parsedValues = JSON.parse(rawValues);
      return Array.isArray(parsedValues) ? parsedValues : [];
    } catch (error) {
      console.error('Failed to parse blank values:', error);
      return [];
    }
  }

  function saveBlankValuesToSession(blankValues) {
    sessionStorage.setItem(BLANK_VALUES_KEY, JSON.stringify(blankValues));
  }

  function captureBlankValuesFromDom() {
    const solutionList = document.querySelector('#solution-sortable ul');
    if (!solutionList) {
      return [];
    }

    return Array.from(solutionList.children).map((child) => {
      const values = Array.from(child.querySelectorAll('input.text-box')).map((input) => input.value || '');
      return values.length ? values : [];
    });
  }



  function restoreBlankValuesToDomByLineId(blankValuesByLineId = {}, targetList = null) {
    const solutionList = targetList || document.querySelector('#solution-sortable ul');
    if (!solutionList) {
      return;
    }

    Array.from(solutionList.children).forEach((child) => {
      const values = blankValuesByLineId[child.id] || [];
      const inputs = Array.from(child.querySelectorAll('input.text-box'));
      inputs.forEach((input, inputIndex) => {
        const value = values[inputIndex] ?? '';
        input.value = value;
        input.style.width = `${(value.length + 3) * 8}px`;
      });
    });
  }

  function getBlankValuesToRestore(preferredSourceCode = '', visibleLineIds = [], widget = null) {
    const comparedBlankValues = getBlankValuesByComparingModelAnswer(preferredSourceCode, visibleLineIds, widget);
    if (comparedBlankValues.some((values) => values.length)) {
      return comparedBlankValues;
    }

    const restoredBlankValues = getBlankValuesFromSession();
    const fallbackBlankValues = restoredBlankValues.length
      ? restoredBlankValues
      : getBlankValuesFromStoredSources(preferredSourceCode, visibleLineIds, widget);

    return fallbackBlankValues.some((values) => values.length)
      ? fallbackBlankValues
      : restoredBlankValues;
  }

  function persistBlankValues() {
    saveBlankValuesToSession(captureBlankValuesFromDom());
  }

  function persistParsonsRepr() {
    if (!parsonsWidget) {
      return;
    }
    sessionStorage.setItem(BLOCKS_KEY, buildCustomRepr(parsonsWidget, normalizeSourceCode, getLineInputValues));
    sessionStorage.setItem(BLOCKS_SOURCE_KEY, normalizeSourceCode(draftPayload?.taskCode || ''));
  }

  function loadMetaFromSession(sourceCode, expectedTaskId = null) {
    try {
      const raw = sessionStorage.getItem(META_KEY);

      if (!raw) {
        return { taskTitle: '', description: '', startDescription: '', tests: '', customErrorMessages: '', taskType: '', isPublic: true, isValid: false };
      }

      const parsed = JSON.parse(raw);
      const storedSource = sessionStorage.getItem(META_SOURCE_KEY);
      const normalizedSource = normalizeSourceCode(sourceCode || '');
      const storedTaskId = typeof parsed.taskId === 'number'
        ? parsed.taskId
        : (typeof parsed.taskId === 'string' && parsed.taskId.trim() ? parseInt(parsed.taskId, 10) : null);

      if (expectedTaskId !== null) {
        if (storedTaskId !== expectedTaskId) {
          return { taskTitle: '', description: '', startDescription: '', tests: '', customErrorMessages: '', taskType: null, isPublic: true, isValid: false };
        }
      } else if (storedSource && normalizedSource && storedSource !== normalizedSource) {
        return { taskTitle: '', description: '', startDescription: '', tests: '', customErrorMessages: '', taskType: null, isPublic: true, isValid: false };
      }

      return {
        taskTitle: typeof parsed.taskTitle === 'string' ? parsed.taskTitle : '',
        description: typeof parsed.description === 'string' ? parsed.description : '',
        startDescription: typeof parsed.startDescription === 'string' ? parsed.startDescription : '',
        examples: typeof parsed.examples === 'string' ? parsed.examples : '',
        tests: typeof parsed.tests === 'string' ? parsed.tests : '',
        customErrorMessages: typeof parsed.customErrorMessages === 'string' ? parsed.customErrorMessages : '',
        taskType: normalizeTaskTypeValue(parsed.taskType),
        isPublic: typeof parsed.isPublic === 'boolean' ? parsed.isPublic : true,
        isValid: true,
      };
    } catch (error) {
      console.error('Failed to parse builder metadata cache:', error);
      return { taskTitle: '', description: '', startDescription: '', tests: '', customErrorMessages: '', taskType: '', isPublic: true, isValid: false };
    }
  }

  function getTaskTypeValue() {
    const taskTypeInput = document.getElementById('task-type');
    return normalizeTaskTypeValue(taskTypeInput?.value);
  }

  function getVisibilityValue() {
    const visibilityInput = document.getElementById('task-visibility-public');
    return visibilityInput ? !visibilityInput.checked : true;
  }

  function updateVisibilityWarning() {
    const warningBox = document.getElementById('visibility-warning-box');
    const visibilityInput = document.getElementById('task-visibility-public');
    if (!warningBox || !visibilityInput) {
      return;
    }

    if (visibilityInput.checked) {
      warningBox.innerHTML = `
        <div class="alert alert-info mb-0" role="alert" style="font-size: 0.88rem; line-height: 1.5; border-left: 5px solid #0ea5e9; background-color: #f0f9ff; color: #0369a1;">
          <i class="fas fa-lock mr-2" style="color: #0ea5e9;"></i>
          <strong>Private Task:</strong> This task is private and visible only to you.
        </div>
      `;
    } else {
      warningBox.innerHTML = `
        <div class="alert alert-success mb-0" role="alert" style="font-size: 0.88rem; line-height: 1.5; border-left: 5px solid #10b981; background-color: #ecfdf5; color: #065f46;">
          <i class="fas fa-users mr-2" style="color: #10b981;"></i>
          <strong>Public Task (Recommended):</strong> Keeping tasks public is preferred as it helps enhance the experience of other teachers and students. Please note that since others can use this task, it will remain active in the system even if your account is later removed. Other instructors won't have any access to your student data despite using the same public task in their own task sets.
        </div>
      `;
    }
  }

  function saveMetaToSession(taskTitle, description, startDescription, tests, customErrorMessages, isPublic, taskType, examples = null) {
    const taskTypeInput = document.getElementById('task-type');
    const examplesInput = document.getElementById('examples-input');
    const examplesValue = typeof examples === 'string' ? examples : (examplesInput?.value || '');
    const allowIndentCheckbox = document.getElementById('allow-indent');
    const requireIndentation = allowIndentCheckbox ? allowIndentCheckbox.checked : true;
    sessionStorage.setItem(META_KEY, JSON.stringify({
      taskTitle,
      description,
      startDescription,
      examples: examplesValue,
      tests,
      customErrorMessages,
      taskType: normalizeTaskTypeValue(typeof taskType === 'string' ? taskType : taskTypeInput?.value),
      isPublic: typeof isPublic === 'boolean' ? isPublic : true,
      requireIndentation,
      taskId: draftPayload?.taskId ?? null,
    }));
    sessionStorage.setItem(META_SOURCE_KEY, normalizeSourceCode(draftPayload?.taskCode || ''));
  }

  function loadModelAnswerFromSession(sourceCode) {
    const rawModelAnswer = sessionStorage.getItem(MODEL_ANSWER_KEY);
    const rawSource = sessionStorage.getItem(MODEL_ANSWER_SOURCE_KEY);
    const rawUpdatedAt = sessionStorage.getItem(MODEL_ANSWER_UPDATED_AT_KEY);
    const normalizedSource = normalizeSourceCode(sourceCode || '');

    if (!rawModelAnswer || typeof rawSource !== 'string' || rawSource !== normalizedSource) {
      return { code: '', repr: '', updatedAt: '' };
    }

    return {
      code: sanitizeBlankInputMarkup(rawModelAnswer),
      repr: normalizeBlankMarkup(sessionStorage.getItem(MODEL_ANSWER_REPR_KEY) || ''),
      updatedAt: rawUpdatedAt || '',
    };
  }

  async function persistModelAnswerToServer(code) {
    const taskId = draftPayload?.taskId || null;
    if (!taskId) {
      return false;
    }

    try {
      const response = await fetch(`/api/problems/${taskId}/model-answer`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ modelAnswerCode: code }),
      });

      if (!response.ok) {
        console.error('Failed to persist model answer to server', response.status);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error persisting model answer to server:', error);
      return false;
    }
  }

  function setModelAnswerState(code, repr, updatedAt = '') {
    modelAnswerCode = sanitizeBlankInputMarkup(code || '');
    modelAnswerRepr = normalizeBlankMarkup(repr || '');
    modelAnswerUpdatedAt = updatedAt || '';
    sessionStorage.setItem(MODEL_ANSWER_KEY, modelAnswerCode);
    sessionStorage.setItem(MODEL_ANSWER_REPR_KEY, modelAnswerRepr);
    sessionStorage.setItem(MODEL_ANSWER_SOURCE_KEY, normalizeSourceCode(draftPayload?.taskCode || ''));

    if (modelAnswerUpdatedAt) {
      sessionStorage.setItem(MODEL_ANSWER_UPDATED_AT_KEY, modelAnswerUpdatedAt);
    } else {
      sessionStorage.removeItem(MODEL_ANSWER_UPDATED_AT_KEY);
    }

    updateModelAnswerStatus();
  }

  function saveModelAnswerToSession(code, repr) {
    setModelAnswerState(code, repr, new Date().toISOString());
  }

  function formatUpdatedAtLabel(isoString) {
    if (!isoString) {
      return '';
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function updateModelAnswerStatus() {
    const status = document.getElementById('model-answer-status');
    const setModelAnswerBtn = document.getElementById('set-model-answer');

    if (setModelAnswerBtn) {
      setModelAnswerBtn.textContent = modelAnswerCode ? 'Update Model Answer' : 'Set as Model Answer';
      setModelAnswerBtn.classList.toggle('saved', Boolean(modelAnswerCode));
    }

    if (!status) {
      return;
    }

    status.classList.toggle('saved', Boolean(modelAnswerCode));
    status.classList.toggle('missing', !modelAnswerCode);
    if (!modelAnswerCode) {
      status.textContent = 'No model answer saved yet.';
      return;
    }

    const updatedAtLabel = formatUpdatedAtLabel(modelAnswerUpdatedAt);
    status.textContent = updatedAtLabel
      ? `Model answer saved at ${updatedAtLabel}.`
      : 'Model answer saved at unknown time.';
  }

  function updateCounters() {
    const sourceCount = document.getElementById('source-line-count');
    const blockCount = document.getElementById('block-count');
    const sourceList = document.querySelector('#source-sortable ul');
    const solutionList = document.querySelector('#solution-sortable ul');

    const sourceItems = sourceList ? sourceList.children.length : 0;
    const solutionItems = solutionList ? solutionList.children.length : 0;

    if (sourceCount) {
      sourceCount.textContent = `${sourceItems} blocks`;
    }
    if (blockCount) {
      blockCount.textContent = `${solutionItems} blocks`;
    }
  }

  function getBlankValuesFromSourceCode(sourceCode, visibleLineIds = [], widget = null) {
    const w = widget || parsonsWidget;
    if (!w || !sourceCode) {
      return [];
    }

    const solutionLines = normalizeSourceCode(sourceCode).split('\n').map((line) => line.trimEnd());
    const visibleLines = Array.isArray(visibleLineIds) && visibleLineIds.length
      ? visibleLineIds
        .map((lineId) => w.modified_lines.find((line) => line.id === lineId))
        .filter(Boolean)
      : (Array.isArray(w.given) ? w.given : (Array.isArray(w.modified_lines) ? w.modified_lines : []));

    return visibleLines.map((line) => {
      const lineCode = normalizeSourceCode(line.code || '').trimEnd();
      if (!lineCode.includes('___') && !lineCode.includes('!BLANK')) {
        return [];
      }
      return getBlankValuesForBlockCode(lineCode, solutionLines);
    });
  }

  function getBlankValuesByComparingModelAnswer(preferredSourceCode = '', visibleLineIds = [], widget = null) {
    const w = widget || parsonsWidget;
    if (!w) {
      return [];
    }

    const candidateSourceCode = normalizeSourceCode(preferredSourceCode || modelAnswerCode || draftPayload?.taskCode || '').trim();
    if (!candidateSourceCode) {
      return [];
    }

    const sourceLines = candidateSourceCode.split('\n').map((line) => normalizeSourceCode(line).trimEnd());
    const visibleLines = Array.isArray(visibleLineIds) && visibleLineIds.length
      ? visibleLineIds
        .map((lineId) => w.modified_lines.find((line) => line.id === lineId))
        .filter(Boolean)
      : (Array.isArray(w.given) ? w.given : (Array.isArray(w.modified_lines) ? w.modified_lines : []));

    return visibleLines.map((line) => {
      const lineCode = normalizeSourceCode(line.code || '').trimEnd();
      if (!lineCode.includes('___') && !lineCode.includes('!BLANK')) {
        return [];
      }

      for (const sourceLine of sourceLines) {
        const values = extractBlankValuesFromLine(lineCode, sourceLine);
        if (values.length) {
          return values;
        }
      }

      return [];
    });
  }

  function getBlankValuesFromStoredSources(preferredSourceCode = '', visibleLineIds = [], widget = null) {
    const candidateSources = [
      preferredSourceCode,
      modelAnswerCode,
      draftPayload?.taskCode || '',
      sessionStorage.getItem('create_task_draft_code') || '',
      sessionStorage.getItem(MODEL_ANSWER_KEY) || '',
    ].filter(Boolean);

    for (const source of candidateSources) {
      const values = getBlankValuesFromSourceCode(source, visibleLineIds, widget);
      if (values.some((entry) => entry.length)) {
        return values;
      }
    }

    return [];
  }
  function renderParsonsBoardLocal(initialText, preferredSourceCode = '') {
    const allowIndentCheckbox = document.getElementById('allow-indent');
    const canIndent = allowIndentCheckbox ? allowIndentCheckbox.checked : true;

    const newWidget = renderParsonsBoard(initialText, {
      sourceSortable: document.getElementById('source-sortable'),
      solutionSortable: document.getElementById('solution-sortable'),
      ParsonsWidgetCtor: window.ParsonsWidget,
      can_indent: canIndent,
      onSortableUpdate: () => {
        refreshGivenToggles();
        updateCounters();
        persistParsonsRepr();
        hasOpenedStudentPreview = false;
        invalidateTestStatus('Blocks were moved. Please run tests again.');
      },
      injectDeleteButtons,
      injectGivenToggles,
      updateCounters
    });
    if (newWidget) {
      parsonsWidget = newWidget;
    }
    if (!parsonsWidget) {
      return;
    }

    const sourceSortable = document.getElementById('source-sortable');
    const solutionSortable = document.getElementById('solution-sortable');
    const solutionIds = parsonsWidget.given.map((line) => line.id);
    const solutionSet = new Set(solutionIds);
    const sourceIds = parsonsWidget.modified_lines
      .filter((line) => !solutionSet.has(line.id))
      .map((line) => line.id);

    const valuesToRestore = getBlankValuesToRestore(preferredSourceCode, solutionIds);
    const blankValuesByLineId = solutionIds.reduce((acc, id, index) => {
      acc[id] = valuesToRestore[index] || [];
      return acc;
    }, {});
    applyBlankValuesToWidgetLines(parsonsWidget, blankValuesByLineId);
    parsonsWidget.createHTMLFromLists(solutionIds, sourceIds);
    parsonsWidget.setLineNumbers();

    if (valuesToRestore.some((values) => values.length)) {
      saveBlankValuesToSession(valuesToRestore);
      restoreBlankValuesToDomByLineId(blankValuesByLineId, solutionSortable?.querySelector('ul'));
    }

    if (sourceSortable) {
      injectDeleteButtons(sourceSortable);
    }
    if (solutionSortable) {
      injectDeleteButtons(solutionSortable);
      injectGivenToggles(solutionSortable);
    }
    updateCounters();
  }

  function getSolutionCodeWithBlanks() {
    if (!parsonsWidget) {
      return '';
    }

    const currentSolutionCode = parsonsWidget.solutionCode().trim();
    return sanitizeBlankInputMarkup(currentSolutionCode);
  }

  function injectDeleteButtons(container) {
    container.querySelectorAll('li').forEach((li) => {
      if (!li.querySelector('.block-delete-btn')) {
        const btn = document.createElement('button');
        btn.className = 'block-delete-btn';
        btn.setAttribute('aria-label', 'Delete block');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteBlock(li.id);
        });
        li.appendChild(btn);
      }
    });
  }

  function injectGivenToggles(container) {
    if (!parsonsWidget) {
      return;
    }
    container.querySelectorAll('li').forEach((li) => {
      const lineObj = parsonsWidget.modified_lines.find((l) => l.id === li.id);
      const isGiven = lineObj?.studentGiven || false;
      li.classList.toggle('student-given', isGiven);

      if (!li.querySelector('.given-toggle-btn')) {
        const btn = document.createElement('button');
        btn.className = 'given-toggle-btn';
        btn.setAttribute('aria-label', 'Double-click block to toggle pre-placing for students');
        btn.title = 'Double-click block to toggle pre-placed for students';
        btn.setAttribute('aria-pressed', isGiven ? 'true' : 'false');
        btn.setAttribute('tabindex', '-1');
        li.appendChild(btn);
      }

      if (!li.dataset.givenDblclick) {
        li.dataset.givenDblclick = 'true';
        li.addEventListener('dblclick', (e) => {
          if (li.querySelector('.given-toggle-btn')) {
            e.stopPropagation();
            toggleStudentGiven(li.id);
          }
        });
      }
    });
  }

  function refreshGivenToggles() {
    if (!parsonsWidget) {
      return;
    }
    const sourceSortable = document.getElementById('source-sortable');
    const solutionSortable = document.getElementById('solution-sortable');
    sourceSortable?.querySelectorAll('li').forEach((li) => {
      const btn = li.querySelector('.given-toggle-btn');
      if (btn) {
        btn.remove();
        li.classList.remove('student-given');
        const lineObj = parsonsWidget.modified_lines.find((l) => l.id === li.id);
        if (lineObj) {
          lineObj.studentGiven = false;
        }
      }
    });
    if (solutionSortable) {
      injectGivenToggles(solutionSortable);
    }
  }

  function toggleStudentGiven(blockId) {
    if (!parsonsWidget) {
      return;
    }
    const lineObj = parsonsWidget.modified_lines.find((l) => l.id === blockId);
    if (!lineObj) {
      return;
    }
    lineObj.studentGiven = !lineObj.studentGiven;
    const el = document.getElementById(blockId);
    el?.classList.toggle('student-given', lineObj.studentGiven);
    const btn = el?.querySelector('.given-toggle-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', lineObj.studentGiven ? 'true' : 'false');
    }
    persistParsonsRepr();
    hasOpenedStudentPreview = false;
    invalidateTestStatus('Block settings were modified. Please run tests again.');
  }

  function deleteBlock(blockId) {
    if (!parsonsWidget) {
      return;
    }
    parsonsWidget.modified_lines = parsonsWidget.modified_lines.filter(
      (line) => line.id !== blockId
    );
    const el = document.getElementById(blockId);
    if (el) {
      el.remove();
    }
    if (window.$) {
      window.$('#source-sortable ul').sortable('refresh');
      window.$('#solution-sortable ul').sortable('refresh');
    }
    updateCounters();
    persistParsonsRepr();
    hasOpenedStudentPreview = false;
    invalidateTestStatus('A block was deleted. Please run tests again.');
  }

  function addCustomBlockToSource(blockCode) {
    if (!parsonsWidget) {
      return;
    }

    const code = blockCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
    if (!code.trim()) {
      return;
    }

    const nextIndex = parsonsWidget.nextCustomIndex !== undefined
      ? parsonsWidget.nextCustomIndex
      : parsonsWidget.modified_lines.length;

    if (parsonsWidget.nextCustomIndex !== undefined) {
      parsonsWidget.nextCustomIndex++;
    } else {
      parsonsWidget.nextCustomIndex = nextIndex + 1;
    }

    const lineObject = {
      widget: parsonsWidget,
      code,
      indent: 0,
      distractor: false,
      orig: nextIndex,
      id: `${parsonsWidget.id_prefix}${nextIndex}`,
    };

    parsonsWidget.modified_lines.push(lineObject);

    const sourceList = document.querySelector('#source-sortable ul');
    if (!sourceList) {
      return;
    }

    sourceList.insertAdjacentHTML('beforeend', parsonsWidget.codeLineToHTML({...lineObject}));

    const newLi = document.getElementById(lineObject.id);
    if (newLi) {
      injectDeleteButtons(newLi.parentElement);
    }

    if (window.$) {
      window.$('#source-sortable ul').sortable('refresh');
      window.$('#solution-sortable ul').sortable('refresh');
    }

    updateCounters();
    persistParsonsRepr();
    hasOpenedStudentPreview = false;
    invalidateTestStatus('A custom block was added. Please run tests again.');
  }

  function setupGuideToggle() {
    const toggle = document.getElementById('problem-guide-toggle');
    const content = document.getElementById('problem-guide-content');

    if (!toggle || !content) {
      return;
    }

    toggle.addEventListener('click', () => {
      const isExpanded = toggle.classList.toggle('expanded');
      content.classList.toggle('expanded', isExpanded);
      toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    });
  }

  function setupChecklistNavigation() {
    const checklist = document.getElementById('task-checklist');
    if (!checklist) {
      return;
    }

    checklist.addEventListener('click', (event) => {
      const btn = event.target.closest('.checklist-item-btn');
      if (!btn) {
        return;
      }

      const targetId = btn.dataset.target;
      const target = targetId && document.getElementById(targetId);
      if (!target) {
        return;
      }

      target.scrollIntoView({ behavior: 'smooth', block: 'center' });

      target.classList.add('checklist-highlight');
      setTimeout(() => target.classList.remove('checklist-highlight'), 1200);

      if (typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    });
  }

  function renderTestResult(status, message) {
    const el = document.getElementById('test-results');
    if (!el) {
      return;
    }

    el.classList.remove('pass', 'fail');
    if (status === 'pass') {
      el.classList.add('pass');
    }
    if (status === 'fail') {
      el.classList.add('fail');
    }
    el.textContent = message;
  }

  function invalidateTestStatus(message = 'Workspace or test settings were modified. Please run tests again.') {
    testsPassed = false;
    renderTestResult('', message);
    updateAddToListState();
  }

  function formatApiErrorDetail(detail) {
    if (!detail) {
      return '';
    }

    if (typeof detail === 'string') {
      return detail;
    }

    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (item && typeof item === 'object') {
            const loc = Array.isArray(item.loc) ? item.loc.join('.') : '';
            const msg = item.msg || JSON.stringify(item);
            return loc ? `${loc}: ${msg}` : msg;
          }
          return String(item);
        })
        .join('; ');
    }

    if (typeof detail === 'object') {
      return detail.message || detail.msg || JSON.stringify(detail);
    }

    return String(detail);
  }

  function validateSourceCodeShape(sourceCode) {
    const lines = sourceCode.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const isBlockHeader = /^(def|class|if|for|while|try|with|match|elif|else|except|finally)\b.*:\s*$/.test(trimmed);
      if (!isBlockHeader) {
        continue;
      }

      const currentIndent = line.match(/^\s*/)?.[0].length ?? 0;
      let foundBodyLine = false;

      for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
        const nextLine = lines[nextIndex];
        const nextTrimmed = nextLine.trim();

        if (!nextTrimmed || nextTrimmed.startsWith('#')) {
          continue;
        }

        const nextIndent = nextLine.match(/^\s*/)?.[0].length ?? 0;
        if (nextIndent <= currentIndent) {
          return {
            ok: false,
            message: `Indentation error near line ${index + 1}: "${trimmed}" has no indented body. Add an indented line below it, for example "    pass".`,
          };
        }

        foundBodyLine = true;
        break;
      }

      if (!foundBodyLine) {
        return {
          ok: false,
          message: `Indentation error near line ${index + 1}: "${trimmed}" has no body. Add at least one indented line below it.`,
        };
      }
    }

    return { ok: true };
  }

  async function runTeacherTests() {
    const evalTypeInput = document.getElementById('eval-type');
    const testsInput = document.getElementById('tests-input');
    const stdoutTestsInput = document.getElementById('stdout-tests-input');
    const expectedOutputInput = document.getElementById('expected-output-input');
    const runStatus = document.getElementById('run-status');
    const runBtn = document.getElementById('run-tests');
    const addToListBtn = document.getElementById('add-to-problem-list');

    if (!runStatus || !runBtn || !addToListBtn) {
      return;
    }

    testsPassed = false;
    updateAddToListState();

    const evalType = evalTypeInput ? evalTypeInput.value : 'unit_test';

    if (evalType === 'order_only') {
      renderTestResult('pass', 'Order-only tasks do not require test execution. You can proceed!');
      testsPassed = true;
      updateAddToListState();
      return;
    }

    const solutionList = document.querySelector('#solution-sortable ul');
    const hasSolutionBlocks = Boolean(solutionList && solutionList.children.length > 0);
    const sourceCode = hasSolutionBlocks && parsonsWidget
      ? parsonsWidget.solutionCode()
      : (draftPayload?.taskCode || '');
    const testsCode = (evalType === 'stdout' && stdoutTestsInput ? stdoutTestsInput.value : (testsInput ? testsInput.value : '')).trim();

    if (!sourceCode.trim()) {
      renderTestResult('fail', 'No source code found to test. Drag blocks to the right column or add code in the first step.');
      return;
    }

    if (evalType === 'unit_test' && !testsCode) {
      renderTestResult('fail', 'Please add tests before running.');
      return;
    }

    const expectedOutput = expectedOutputInput ? expectedOutputInput.value.trim() : '';
    if (evalType === 'stdout' && !expectedOutput) {
      renderTestResult('fail', 'Please provide the expected output before running.');
      return;
    }

    const sourceValidation = validateSourceCodeShape(sourceCode);
    if (!sourceValidation.ok) {
      renderTestResult('fail', sourceValidation.message);
      return;
    }

    runBtn.disabled = true;
    runStatus.textContent = 'Running tests...';

    let python = '';
    if (evalType === 'unit_test') {
      python = [
        sourceCode,
        '',
        testsCode,
        '',
        'print("ALL_TEACHER_TESTS_PASSED")',
      ].join('\n');
    } else if (evalType === 'stdout') {
      python = testsCode ? `${sourceCode}\n\n${testsCode}` : sourceCode;
    } else {
      python = sourceCode;
    }

    try {
      const { results, error } = await new FiniteWorker(python);
      if (error) {
        const parsedError = processTestError(error, 0, []);
        const renderedError = [parsedError.header, parsedError.details].filter(Boolean).join('\n\n');
        renderTestResult('fail', renderedError || 'An unknown error occurred during test execution.');
        testsPassed = false;
        updateAddToListState();
      } else {
        const output = (results || '').toString().replace(/\r\n/g, '\n').trim();
        if (evalType === 'unit_test') {
          if (output.includes('ALL_TEACHER_TESTS_PASSED')) {
            renderTestResult('pass', 'All tests passed!');
            testsPassed = true;
          } else {
            const errorMessage = output || 'Test execution failed with no output.';
            renderTestResult('fail', errorMessage);
            testsPassed = false;
          }
        } else if (evalType === 'stdout') {
          const expectedNorm = expectedOutput.replace(/\r\n/g, '\n').trim();
          const driverCalls = (stdoutTestsInput ? stdoutTestsInput.value : '').replace(/\r\n/g, '\n').trim();
          const inputBlock = driverCalls ? `\n\nTest input:\n${driverCalls}` : '';
          if (output === expectedNorm) {
            renderTestResult('pass', `Output matched perfectly!${inputBlock}\n\nOutput:\n${output}`);
            testsPassed = true;
          } else {
            renderTestResult('fail', `Output did not match.${inputBlock}\n\nExpected:\n${expectedNorm}\n\nGot:\n${output}`);
            testsPassed = false;
          }
        }
        updateAddToListState();
      }
    } catch (err) {
      renderTestResult('fail', `Execution error: ${err.message || err}`);
      testsPassed = false;
      updateAddToListState();
    } finally {
      runBtn.disabled = false;
      runStatus.textContent = '';
    }
  }

  function addToProblemList() {
    const taskTitleInput = document.getElementById('task-title');
    const descriptionInput = document.getElementById('problem-description');
    const examplesInput = document.getElementById('examples-input');
    const startDescriptionInput = document.getElementById('start-description');
    const customErrorMessagesInput = document.getElementById('custom-error-messages');
    const testsInput = document.getElementById('tests-input');
    const stdoutTestsInput = document.getElementById('stdout-tests-input');
    const visibilityInput = document.getElementById('task-visibility-public');
    const taskTypeInput = document.getElementById('task-type');
    const solutionList = document.querySelector('#solution-sortable ul');

    if (!taskTitleInput || !descriptionInput || !startDescriptionInput || !solutionList || !parsonsWidget) {
      alert('Missing required fields to add the problem.');
      return;
    }

    const evalTypeInput = document.getElementById('eval-type');
    const expectedOutputInput = document.getElementById('expected-output-input');
    const evalType = evalTypeInput ? evalTypeInput.value : 'unit_test';
    const expectedOutput = expectedOutputInput ? expectedOutputInput.value.trim() : '';

    const taskTitle = taskTitleInput.value.trim();
    const description = descriptionInput.value.trim();
    const examples = examplesInput?.value.trim() || '';
    const startDescription = startDescriptionInput.value.trim();
    const customErrorMessages = customErrorMessagesInput.value.trim() || '';
    const tests = (evalType === 'stdout' && stdoutTestsInput ? stdoutTestsInput.value : (testsInput ? testsInput.value : '')).trim();
    const solutionCode = sanitizeBlankInputMarkup(modelAnswerCode);
    const isPublic = visibilityInput ? !visibilityInput.checked : true;
    const taskType = normalizeTaskTypeValue(taskTypeInput?.value);

    if (!taskType) {
      alert('Please select a task tag before saving the task.');
      taskTypeInput?.focus();
      return;
    }

    saveMetaToSession(taskTitle, description, startDescription, tests, customErrorMessages, isPublic, taskType, examples);

    if (!taskTitle || !description || !startDescription || !solutionCode) {
      alert('Please ensure all required fields are filled out and set a model answer before adding the problem.');
      return;
    }

    if (evalType === 'unit_test' && !tests) {
      alert('Please ensure you write unit tests for this task.');
      return;
    }

    if (!hasOpenedStudentPreview) {
      alert('Please open "Preview" before adding the problem to the list.');
      return;
    }

    const isOrderOnly = evalTypeInput?.value === 'order_only';

    if (!isOrderOnly && !testsPassed) {
      alert('Please run tests successfully before adding the problem to the list.');
      return;
    }

    const currentSolutionCode = getSolutionCodeWithBlanks();
    const finalModelAnswerCode = sanitizeBlankInputMarkup(modelAnswerCode) || currentSolutionCode;
    const solutionCodeWithBlanks = finalModelAnswerCode || currentSolutionCode;
    const parsonsRepr = modelAnswerRepr || buildCustomRepr(parsonsWidget, normalizeSourceCode, getLineInputValues);
    const problemData = {
      taskTitle,
      description,
      startDescription,
      examples,
      customErrorMessages,
      tests,
      solutionCode: solutionCodeWithBlanks,
      parsonsRepr,
      faded: parsonsRepr.includes('!BLANK'),
      task_type: taskType,
      is_public: isPublic,
      eval_type: evalType,
      expected_output: expectedOutput,
      require_indentation: document.getElementById('allow-indent') ? document.getElementById('allow-indent').checked : true,
    };

    const editTaskId = draftPayload?.taskId || null;
    const fetchUrl = editTaskId ? `/api/problems/${editTaskId}` : '/api/problems';
    const fetchMethod = editTaskId ? 'PUT' : 'POST';

    fetch(fetchUrl, {
      method: fetchMethod,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(problemData),
    })
      .then(async (response) => {
        if (response.ok) {
          if (editTaskId && finalModelAnswerCode) {
            await persistModelAnswerToServer(finalModelAnswerCode);
          }
          clearTaskDraftStorage();
          alert(editTaskId ? 'Task updated successfully!' : 'Task successfully created!');
          window.location.href = '/teacher-dashboard';
        } else {
          let detail = '';
          let parsedDetail = '';
          try {
            const payload = await response.json();
            parsedDetail = formatApiErrorDetail(payload?.detail);
            detail = parsedDetail ? `\nReason: ${parsedDetail}` : '';
          } catch (parseError) {
            detail = '';
          }

          saveMetaToSession(
            taskTitleInput.value,
            descriptionInput.value,
            startDescriptionInput.value,
            testsInput.value,
            customErrorMessagesInput.value,
            getVisibilityValue(),
            getTaskTypeValue()
          );
          taskTitleInput.focus();

          alert(`Failed to add the problem.${detail}`);
        }
      })
      .catch((error) => {
        console.error('Error adding problem:', error);
        alert('An error occurred while adding the problem.');
      });
  }

  function saveCodeToSession() {
    const testsInput = document.getElementById('tests-input');
    const stdoutTestsInput = document.getElementById('stdout-tests-input');
    const expectedOutputInput = document.getElementById('expected-output-input');
    const evalTypeInput = document.getElementById('eval-type');
    const evalType = evalTypeInput ? evalTypeInput.value : (draftPayload?.evalType || 'unit_test');
    const solutionList = document.querySelector('#solution-sortable ul');
    const hasSolutionBlocks = Boolean(solutionList && solutionList.children.length > 0);
    const currentCode = hasSolutionBlocks && parsonsWidget
      ? parsonsWidget.solutionCode()
      : (draftPayload?.taskCode || '');
    const currentTaskType = getTaskTypeValue();

    sessionStorage.setItem('create_task_draft_code', currentCode);

    let currentTests = '';
    let currentExpectedOutput = '';

    if (evalType === 'stdout') {
      currentExpectedOutput = expectedOutputInput ? expectedOutputInput.value : (draftPayload?.expectedOutput || '');
      const currentStdoutCalls = stdoutTestsInput ? stdoutTestsInput.value : (draftPayload?.taskTests || '');
      currentTests = currentStdoutCalls;
      sessionStorage.setItem('create_task_draft_tests', currentExpectedOutput);
      sessionStorage.setItem('create_task_draft_stdout_calls', currentStdoutCalls);
    } else if (evalType === 'order_only') {
      currentTests = '';
      sessionStorage.setItem('create_task_draft_tests', '');
      sessionStorage.removeItem('create_task_draft_stdout_calls');
    } else {
      currentTests = testsInput ? testsInput.value : (draftPayload?.taskTests || '');
      sessionStorage.setItem('create_task_draft_tests', currentTests);
      sessionStorage.removeItem('create_task_draft_stdout_calls');
    }

    if (draftPayload) {
      const updatedDraft = {
        ...draftPayload,
        taskCode: currentCode,
        taskTests: currentTests,
        expectedOutput: currentExpectedOutput,
        evalType: evalType,
        taskType: currentTaskType,
        savedAt: new Date().toISOString(),
      };

      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(updatedDraft));
    }
  }

  function setupBlankInputPersistence() {
    if (document.body.dataset.blankInputBound === 'true') {
      return;
    }

    document.addEventListener('input', (event) => {
      if (event.target instanceof HTMLInputElement && event.target.classList.contains('text-box')) {
        const isMainEditor = event.target.closest('#solution-sortable, #source-sortable');
        if (!isMainEditor) {
          return;
        }
        persistBlankValues();
        hasOpenedStudentPreview = false;
        invalidateTestStatus('Block blank values were modified. Please run tests again.');
      }
    });

    document.body.dataset.blankInputBound = 'true';
  }

  function setupEvalTypeToggle() {
    const evalTypeInput = document.getElementById('eval-type');
    const unitTestContainer = document.getElementById('unit-test-container');
    const stdoutContainer = document.getElementById('stdout-container');
    const orderOnlyContainer = document.getElementById('order-only-container');
    const runBtn = document.getElementById('run-tests');

    if (!evalTypeInput || !unitTestContainer || !stdoutContainer || !orderOnlyContainer) return;

    function updateUI(event) {
      const isInit = !event || !event.type;
      const val = evalTypeInput.value;
      unitTestContainer.style.display = val === 'unit_test' ? 'block' : 'none';
      stdoutContainer.style.display = val === 'stdout' ? 'block' : 'none';
      orderOnlyContainer.style.display = val === 'order_only' ? 'block' : 'none';

      const customBlockInput = document.getElementById('custom-block-input');
      const startDescriptionInput = document.getElementById('start-description');
      const problemDescriptionInput = document.getElementById('problem-description');
      const testsInput = document.getElementById('tests-input');
      const expectedOutputInput = document.getElementById('expected-output-input');

      if (val === 'order_only') {
         if (runBtn) runBtn.textContent = 'Check Order';
         if (customBlockInput) customBlockInput.placeholder = 'Buy all ingredients\nBake a pie\nEat the pie';
         if (startDescriptionInput) startDescriptionInput.placeholder = 'In this exercise you will practice ordering steps.';
         if (problemDescriptionInput) problemDescriptionInput.placeholder = 'Arrange the steps to bake a pie in the correct order.';
      } else if (val === 'stdout') {
         if (runBtn) runBtn.textContent = 'Check Output';
         if (customBlockInput) customBlockInput.placeholder = 'print("Hello")';
         if (startDescriptionInput) startDescriptionInput.placeholder = 'In this exercise you will practice printing output.';
         if (problemDescriptionInput) problemDescriptionInput.placeholder = 'Write a program that prints Hello World on separate lines.';
         if (expectedOutputInput) expectedOutputInput.placeholder = 'Hello\nWorld';
      } else {
         if (runBtn) runBtn.textContent = 'Run Tests';
         if (customBlockInput) customBlockInput.placeholder = 'Write custom block code here...';
         if (startDescriptionInput) startDescriptionInput.placeholder = 'In this exercise you will practice adding values.';
         if (problemDescriptionInput) problemDescriptionInput.placeholder = 'sum returns the total of a and b. It should take a and b as inputs and return a + b.';
         if (testsInput) testsInput.placeholder = 'assert sum(1, 5) == 6\nassert sum(5, 5) == 10';
      }

      if (!isInit) {
        const allowIndentCheckbox = document.getElementById('allow-indent');
        if (allowIndentCheckbox) {
          allowIndentCheckbox.checked = val !== 'order_only';
          allowIndentCheckbox.dispatchEvent(new Event('change'));
        }
        invalidateTestStatus('Evaluation mode changed. Please run tests again.');
      }
      updateAddToListState();
    }

    evalTypeInput.addEventListener('change', updateUI);
    updateUI();
  }

  function setupButtons() {
    const backBtn = document.getElementById('back-to-code');
    const clearBtn = document.getElementById('clear-blocks');
    const addCustomBtn = document.getElementById('add-custom-block');
    const addToListBtn = document.getElementById('add-to-problem-list');
    const addCustomErrorBtn = document.getElementById('add-custom-error-messages');
    const customBlockInput = document.getElementById('custom-block-input');
    const customErrorMessagesInput = document.getElementById('custom-error-messages');
    const taskTitleInput = document.getElementById('task-title');
    const descriptionInput = document.getElementById('problem-description');
    const startDescriptionInput = document.getElementById('start-description');
    const testsInput = document.getElementById('tests-input');
    const stdoutTestsInput = document.getElementById('stdout-tests-input');
    const expectedOutputInput = document.getElementById('expected-output-input');
    const evalTypeInput = document.getElementById('eval-type');
    const visibilityInput = document.getElementById('task-visibility-public');
    const taskTypeInput = document.getElementById('task-type');
    const runBtn = document.getElementById('run-tests');
    const setModelAnswerBtn = document.getElementById('set-model-answer');
    const allowIndentCheckbox = document.getElementById('allow-indent');

    function getActiveTestsForSession() {
      const currentEvalType = evalTypeInput ? evalTypeInput.value : 'unit_test';
      if (currentEvalType === 'stdout') {
        return stdoutTestsInput ? stdoutTestsInput.value : '';
      }
      return testsInput ? testsInput.value : '';
    }

    function saveCurrentMetadata() {
      saveMetaToSession(
        taskTitleInput?.value || '',
        descriptionInput?.value || '',
        startDescriptionInput?.value || '',
        getActiveTestsForSession(),
        customErrorMessagesInput?.value || '',
        getVisibilityValue(),
        getTaskTypeValue()
      );
    }

    if (allowIndentCheckbox) {
      allowIndentCheckbox.addEventListener('change', (e) => {
        if (!parsonsWidget) return;

        const canIndent = e.target.checked;
        parsonsWidget.options.can_indent = canIndent;

        if (!canIndent) {
          parsonsWidget.modified_lines.forEach(line => {
             line.indent = 0;
             parsonsWidget.updateHTMLIndent(line.id);
          });
        }

        if (window.$) {
          const grid = canIndent ? [parsonsWidget.options.x_indent, 1] : false;
          const solutionUl = document.querySelector('#solution-sortable ul');
          const sourceUl = document.querySelector('#source-sortable ul');
          if (solutionUl) window.$(solutionUl).sortable('option', 'grid', grid);
          if (sourceUl) window.$(sourceUl).sortable('option', 'grid', grid);
        }
        hasOpenedStudentPreview = false;
        invalidateTestStatus('Indentation setting changed. Please run tests again.');
      });
    }
    const previewStudentBtn = document.getElementById('preview-student-view');
    const cancelBtn = document.getElementById('cancel-task-editor');

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        saveCodeToSession();
        const backTaskId = Number.parseInt(String(draftPayload?.taskId ?? ''), 10);
        window.location.href = Number.isInteger(backTaskId) && backTaskId > 0
          ? `/create-task?task_id=${backTaskId}`
          : '/create-task';
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        const confirmed = window.confirm(
          'Are you sure you want to cancel? All changes will be lost.'
        );
        if (!confirmed) {
          return;
        }
        clearTaskDraftStorage();
        window.location.href = '/teacher-dashboard';
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!confirm('Are you sure you want to clear all blocks? This cannot be undone.')) {
          return;
        }
        clearTaskDraftStorage();
        modelAnswerCode = '';
        modelAnswerRepr = '';
        modelAnswerUpdatedAt = '';
        hasOpenedStudentPreview = false;
        invalidateTestStatus('Workspace cleared. Please run tests again.');
        renderParsonsBoardLocal(normalizeSourceCode(draftPayload?.taskCode || ''));
        updateModelAnswerStatus();
        updateAddToListState();

        const descriptionInput = document.getElementById('problem-description');
        const startDescriptionInput = document.getElementById('start-description');
        const testsInput = document.getElementById('tests-input');
        const stdoutTestsInput = document.getElementById('stdout-tests-input');
        const expectedOutputInput = document.getElementById('expected-output-input');
        const customErrorMessagesInput = document.getElementById('custom-error-messages');
        const taskTitleInput = document.getElementById('task-title');
        const evalTypeInput = document.getElementById('eval-type');
        const currentEvalType = evalTypeInput ? evalTypeInput.value : (draftPayload?.evalType || 'unit_test');

        if (taskTitleInput) {
          taskTitleInput.value = extractDefaultTitleFromCode(draftPayload?.taskCode || '');
        }
        if (descriptionInput) {
          descriptionInput.value = '';
        }
        if (startDescriptionInput) {
          startDescriptionInput.value = '';
        }
        if (currentEvalType === 'stdout') {
          if (testsInput) testsInput.value = '';
          if (stdoutTestsInput) stdoutTestsInput.value = draftPayload?.taskTests || '';
          if (expectedOutputInput) expectedOutputInput.value = draftPayload?.expectedOutput || '';
        } else {
          if (testsInput) testsInput.value = draftPayload?.taskTests || '';
          if (stdoutTestsInput) stdoutTestsInput.value = '';
          if (expectedOutputInput) expectedOutputInput.value = '';
        }
        if (customErrorMessagesInput) {
          customErrorMessagesInput.value = '';
        }
      });
    }

    if (setModelAnswerBtn) {
      setModelAnswerBtn.addEventListener('click', async () => {
        if (!parsonsWidget) {
          return;
        }

        const currentSolutionCode = sanitizeBlankInputMarkup(parsonsWidget.solutionCode().trim());
        if (!currentSolutionCode) {
          alert('Move at least one block to the right column before setting the model answer.');
          return;
        }

        saveModelAnswerToSession(currentSolutionCode, buildCustomRepr(parsonsWidget, normalizeSourceCode, getLineInputValues));
        const persistedToServer = await persistModelAnswerToServer(currentSolutionCode);
        if (persistedToServer) {
          const status = document.getElementById('model-answer-status');
          if (status) {
            const updatedAtLabel = formatUpdatedAtLabel(modelAnswerUpdatedAt) || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            status.textContent = `Model answer saved at ${updatedAtLabel}.`;
          }
        }
        hasOpenedStudentPreview = false;
        updateAddToListState();
      });
    }

    if (previewStudentBtn) {
      previewStudentBtn.addEventListener('click', () => {
        openStudentPreview();
      });
    }

    if (addCustomBtn && customBlockInput) {
      addCustomBtn.addEventListener('click', () => {
        const customCode = customBlockInput.value.trimEnd();
        if (!customCode.trim()) {
          customBlockInput.focus();
          return;
        }

        addCustomBlockToSource(customCode);
        customBlockInput.value = '';
        customBlockInput.focus();
      });

      customBlockInput.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          addCustomBtn.click();
        }
      });
    }

    if (taskTitleInput && descriptionInput && startDescriptionInput) {
      taskTitleInput.addEventListener('input', () => {
        hasOpenedStudentPreview = false;
        saveCurrentMetadata();
        updateAddToListState();
      });

      descriptionInput.addEventListener('input', () => {
        hasOpenedStudentPreview = false;
        saveCurrentMetadata();
        updateAddToListState();
      });

      startDescriptionInput.addEventListener('input', () => {
        hasOpenedStudentPreview = false;
        saveCurrentMetadata();
        updateAddToListState();
      });
    }

    if (testsInput) {
      testsInput.addEventListener('input', () => {
        hasOpenedStudentPreview = false;
        invalidateTestStatus('Tests were modified. Please run tests again.');
        saveCurrentMetadata();
        if (draftPayload) {
          draftPayload.taskTests = testsInput.value;
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draftPayload));
        }
        updateAddToListState();
      });
    }

    if (stdoutTestsInput) {
      stdoutTestsInput.addEventListener('input', () => {
        hasOpenedStudentPreview = false;
        invalidateTestStatus('Function calls were modified. Please run tests again.');
        saveCurrentMetadata();
        if (draftPayload) {
          draftPayload.taskTests = stdoutTestsInput.value;
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draftPayload));
        }
        updateAddToListState();
      });
    }

    if (expectedOutputInput) {
      expectedOutputInput.addEventListener('input', () => {
        hasOpenedStudentPreview = false;
        invalidateTestStatus('Expected output was modified. Please run tests again.');
        saveCurrentMetadata();
        if (draftPayload) {
          draftPayload.expectedOutput = expectedOutputInput.value;
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draftPayload));
        }
        updateAddToListState();
      });
    }

    if (taskTypeInput) {
      taskTypeInput.addEventListener('change', () => {
        hasOpenedStudentPreview = false;
        saveCurrentMetadata();
        if (draftPayload) {
          draftPayload.taskType = getTaskTypeValue();
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draftPayload));
        }
        updateAddToListState();
      });
    }

    if (visibilityInput) {
      visibilityInput.addEventListener('change', () => {
        hasOpenedStudentPreview = false;
        saveCurrentMetadata();
        updateVisibilityWarning();
        updateAddToListState();
      });
    }

    if (runBtn) {
      runBtn.addEventListener('click', () => {
        runTeacherTests();
      });
    }

    if (addToListBtn) {
      addToListBtn.addEventListener('click', () => {
        addToProblemList();
      });
    }

    if (addCustomErrorBtn && customErrorMessagesInput) {
      addCustomErrorBtn.addEventListener('click', () => {
        // customErrorMessagesInput.focus();
        hasOpenedStudentPreview = false;
        invalidateTestStatus('Custom error messages were updated. Please run tests again.');
        saveMetaToSession(
          taskTitleInput.value,
          descriptionInput.value,
          startDescriptionInput.value,
          testsInput.value,
          customErrorMessagesInput.value,
          getVisibilityValue(),
          getTaskTypeValue()
        );
        updateAddToListState();
      });
    }
  }

  async function initializeBuilder() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlTaskId = urlParams.get('task_id') ? parseInt(urlParams.get('task_id'), 10) : null;

    const taskTitleInput = document.getElementById('task-title');
    const descriptionInput = document.getElementById('problem-description');
    const startDescriptionInput = document.getElementById('start-description');
    const testsInput = document.getElementById('tests-input');
    const customErrorMessagesInput = document.getElementById('custom-error-messages');
    const visibilityInput = document.getElementById('task-visibility-public');
    const taskTypeInput = document.getElementById('task-type');

    populateTaskTypeOptions();

    if (urlTaskId) {
      // Direct edit mode: load task from API, model answer on right, leftover blocks on left
      let taskData;
      let fetchedModelAnswer = '';
      try {
        const [editableResp, taskResp, modelAnswerResp] = await Promise.all([
          fetch(`/api/problems/${urlTaskId}/editable`, { credentials: 'same-origin' }),
          fetch(`/api/tasks/${urlTaskId}`, { credentials: 'same-origin' }),
          fetch(`/api/problems/${urlTaskId}/model-answer`, { credentials: 'same-origin' }),
        ]);

        if (!taskResp.ok) {
          alert('Task not found. Redirecting to dashboard.');
          window.location.href = '/teacher-dashboard';
          return;
        }
        taskData = await taskResp.json();

        if (modelAnswerResp.ok) {
          const modelAnswerPayload = await modelAnswerResp.json();
          fetchedModelAnswer = modelAnswerPayload?.model_answer || '';
        }

        if (editableResp.ok) {
          const { editable } = await editableResp.json();
          if (!editable) {
            alert('This task cannot be edited because it is used in a task set with enrolled students, or another teacher has added it to their task set.');
            window.location.href = '/teacher-dashboard';
            return;
          }
        }
      } catch (e) {
        alert('Failed to load task. Redirecting to dashboard.');
        window.location.href = '/teacher-dashboard';
        return;
      }

      const solutionCode = taskData.correct_solution?.solution_code || '';
      const teacherTests = taskData.correct_solution?.teacher_tests || '';

      draftPayload = {
        taskCode: solutionCode,
        taskTests: teacherTests,
        taskType: normalizeTaskTypeValue(taskData.task_type),
        savedAt: new Date().toISOString(),
        taskId: urlTaskId,
      };

      const cachedRepr = getCachedParsonsRepr(solutionCode);
      const meta = loadMetaFromSession(solutionCode, urlTaskId);
      const defaultTitle = extractDefaultTitleFromCode(solutionCode);
      const initialText = cachedRepr || buildReprFromBlocks(taskData);

      let instructions = {};
      try { instructions = JSON.parse(taskData.task_instructions || '{}'); } catch (e) { instructions = {}; }
      if (taskTitleInput) taskTitleInput.value = (meta.taskTitle || '').trim() || taskData.title || defaultTitle;
      if (descriptionInput) descriptionInput.value = meta.description || instructions.task_instructions || '';
      const examplesInput = document.getElementById('examples-input');
      if (examplesInput) examplesInput.value = meta.examples !== undefined && meta.examples !== '' ? meta.examples : (instructions.examples || '');
      if (startDescriptionInput) startDescriptionInput.value = meta.startDescription || taskData.description || '';
      const stdoutTestsInput = document.getElementById('stdout-tests-input');
      const taskEvalType = taskData.correct_solution?.eval_type || 'unit_test';
      if (taskEvalType === 'stdout') {
        if (stdoutTestsInput) stdoutTestsInput.value = meta.tests || teacherTests || '';
        if (testsInput) testsInput.value = '';
      } else {
        if (testsInput) testsInput.value = meta.tests || teacherTests || '';
        if (stdoutTestsInput) stdoutTestsInput.value = '';
      }
      if (customErrorMessagesInput) customErrorMessagesInput.value = meta.customErrorMessages || taskData.correct_solution?.custom_error_messages || '';
      if (taskTypeInput) taskTypeInput.value = normalizeTaskTypeValue(taskData.task_type);
      if (visibilityInput) {
        visibilityInput.checked = (meta.taskTitle ? meta.isPublic : taskData.is_public) === false;
      }

      const evalTypeInput = document.getElementById('eval-type');
      if (evalTypeInput) {
        evalTypeInput.value = taskData.correct_solution?.eval_type || 'unit_test';
      }
      
      const expectedOutputInput = document.getElementById('expected-output-input');
      if (expectedOutputInput) {
        expectedOutputInput.value = taskData.correct_solution?.expected_output || '';
      }

      const savedModelAnswer = loadModelAnswerFromSession(solutionCode);
      persistedModelAnswerSource = fetchedModelAnswer || taskData.model_answer || taskData.correct_solution?.solution_code || '';
      if (persistedModelAnswerSource) {
        setModelAnswerState(persistedModelAnswerSource, initialText, '');
      } else if (savedModelAnswer.code) {
        modelAnswerCode = savedModelAnswer.code;
        modelAnswerRepr = savedModelAnswer.repr;
        modelAnswerUpdatedAt = savedModelAnswer.updatedAt;
      }

      if (visibilityInput) {
        const hasSessionMeta = sessionStorage.getItem(META_KEY) !== null;
        const isPublic = hasSessionMeta ? meta.isPublic : (typeof taskData.is_public === 'boolean' ? taskData.is_public : true);
        visibilityInput.checked = !isPublic;
        updateVisibilityWarning();
      }

      const addToListBtn = document.getElementById('add-to-problem-list');
      if (addToListBtn) addToListBtn.textContent = 'Update Task';

      const backBtn = document.getElementById('back-to-code');
      if (backBtn) backBtn.style.display = 'none';

      const allowIndentCheckbox = document.getElementById('allow-indent');
      if (allowIndentCheckbox) {
        const currentEvalType = taskData.correct_solution?.eval_type || 'unit_test';
        const defaultIndent = currentEvalType !== 'order_only';
        allowIndentCheckbox.checked = meta.requireIndentation !== undefined ? meta.requireIndentation : (taskData.correct_solution?.require_indentation !== undefined ? taskData.correct_solution.require_indentation : defaultIndent);
      }

      renderParsonsBoardLocal(initialText, persistedModelAnswerSource);
      setupBlankInputPersistence();
      setupGuideToggle();
      setupPreviewModal();
      setupChecklistNavigation();
      setupEvalTypeToggle();
      setupButtons();
      updateModelAnswerStatus();
      updateAddToListState();
      return;
    }

    // Normal create/edit-via-step-1 mode
    const draft = readDraftPayload();
    if (!draft) {
      alert('No draft task found. Redirecting to task editor.');
      window.location.href = '/create-task';
      return;
    }

    draftPayload = draft;
    const editTaskId = draft.taskId || null;
    const cachedRepr = getCachedParsonsRepr(draft.taskCode);
    const meta = loadMetaFromSession(draft.taskCode, editTaskId);

    const defaultTitle = extractDefaultTitleFromCode(draft.taskCode);
    let initialText = cachedRepr || normalizeSourceCode(draft.taskCode);
    let fetchedFromApi = false;
    let apiTaskData = null;
    persistedModelAnswerSource = '';

    if (editTaskId) {
      try {
        const response = await fetch(`/api/tasks/${editTaskId}`);
        if (response.ok) {
          apiTaskData = await response.json();
          fetchedFromApi = true;
          persistedModelAnswerSource = apiTaskData?.model_answer || apiTaskData?.correct_solution?.solution_code || '';
          if (!cachedRepr) {
            initialText = buildReprFromBlocks(apiTaskData);
          }
        }
      } catch (e) {
        console.error('Failed to fetch task for editing:', e);
      }
    }
    const stdoutTestsInput = document.getElementById('stdout-tests-input');
    if (fetchedFromApi && !meta.taskTitle) {
      let instructions = {};
      try { instructions = JSON.parse(apiTaskData.task_instructions || '{}'); } catch (e) { instructions = {}; }
      if (taskTitleInput) taskTitleInput.value = apiTaskData.title || defaultTitle;
      if (descriptionInput) descriptionInput.value = instructions.task_instructions || '';
      const examplesInput = document.getElementById('examples-input');
      if (examplesInput) examplesInput.value = instructions.examples || '';
      if (startDescriptionInput) startDescriptionInput.value = apiTaskData.description || '';
      const fetchedEvalType = draft.evalType || apiTaskData?.correct_solution?.eval_type || 'unit_test';
      if (fetchedEvalType === 'stdout') {
        if (stdoutTestsInput) stdoutTestsInput.value = apiTaskData.correct_solution?.teacher_tests || draft.taskTests || '';
        if (testsInput) testsInput.value = '';
      } else {
        if (testsInput) testsInput.value = apiTaskData.correct_solution?.teacher_tests || draft.taskTests || '';
        if (stdoutTestsInput) stdoutTestsInput.value = '';
      }
      if (customErrorMessagesInput) customErrorMessagesInput.value = apiTaskData.correct_solution?.custom_error_messages || '';
      if (taskTypeInput) taskTypeInput.value = normalizeTaskTypeValue(apiTaskData.task_type || draft.taskType);
      const savedAnswer = apiTaskData.model_answer || apiTaskData.correct_solution?.solution_code || '';
      if (savedAnswer) {
        setModelAnswerState(savedAnswer, initialText, '');
      }
    } else {
      if (taskTitleInput) taskTitleInput.value = (meta.taskTitle || '').trim() || defaultTitle;
      if (descriptionInput) descriptionInput.value = meta.description || '';
      const examplesInput = document.getElementById('examples-input');
      if (examplesInput) examplesInput.value = meta.examples || '';
      if (startDescriptionInput) startDescriptionInput.value = meta.startDescription || '';
      const normalEvalType = draft.evalType || apiTaskData?.correct_solution?.eval_type || 'unit_test';
      if (normalEvalType === 'stdout') {
        if (stdoutTestsInput) stdoutTestsInput.value = draft.taskTests || meta.tests || '';
        if (testsInput) testsInput.value = '';
      } else {
        if (testsInput) testsInput.value = draft.taskTests || meta.tests || '';
        if (stdoutTestsInput) stdoutTestsInput.value = '';
      }

      if (customErrorMessagesInput) customErrorMessagesInput.value = meta.customErrorMessages || '';
      if (taskTypeInput) taskTypeInput.value = normalizeTaskTypeValue(apiTaskData?.task_type || draft.taskType);

      const savedModelAnswer = loadModelAnswerFromSession(draft.taskCode);
      persistedModelAnswerSource = apiTaskData?.model_answer || apiTaskData?.correct_solution?.solution_code || '';
      if (persistedModelAnswerSource) {
        setModelAnswerState(persistedModelAnswerSource, initialText, '');
      } else if (savedModelAnswer.code) {
        modelAnswerCode = savedModelAnswer.code;
        modelAnswerRepr = savedModelAnswer.repr;
        modelAnswerUpdatedAt = savedModelAnswer.updatedAt;
      } else {
        modelAnswerCode = savedModelAnswer.code;
        modelAnswerRepr = savedModelAnswer.repr;
        modelAnswerUpdatedAt = savedModelAnswer.updatedAt;
      }
    }

    const evalTypeInput = document.getElementById('eval-type');
    if (evalTypeInput) {
      // draft.evalType takes priority: the user may have changed it on step 1
      evalTypeInput.value = draft.evalType || apiTaskData?.correct_solution?.eval_type || 'unit_test';
    }
    const expectedOutputInput = document.getElementById('expected-output-input');
    if (expectedOutputInput) expectedOutputInput.value = draft.expectedOutput || apiTaskData?.correct_solution?.expected_output || '';
    const allowIndentCheckbox = document.getElementById('allow-indent');
    if (allowIndentCheckbox) {
      const currentEvalType = apiTaskData?.correct_solution?.eval_type || draft.evalType || 'unit_test';
      const defaultIndent = currentEvalType !== 'order_only';
      allowIndentCheckbox.checked = meta.requireIndentation !== undefined ? meta.requireIndentation : (apiTaskData?.correct_solution?.require_indentation !== undefined ? apiTaskData.correct_solution.require_indentation : defaultIndent);
    }

    if (visibilityInput) {
      const hasSessionMeta = sessionStorage.getItem(META_KEY) !== null;
      const isPublic = hasSessionMeta ? meta.isPublic : (fetchedFromApi && apiTaskData ? apiTaskData.is_public : true);
      visibilityInput.checked = !isPublic;
      updateVisibilityWarning();
    }

    if (editTaskId) {
      const addToListBtn = document.getElementById('add-to-problem-list');
      if (addToListBtn) addToListBtn.textContent = 'Update Task';
    }
    renderParsonsBoardLocal(initialText, persistedModelAnswerSource);
    setupBlankInputPersistence();
    setupGuideToggle();
    setupPreviewModal();
    setupChecklistNavigation();
    setupEvalTypeToggle();
    setupButtons();
    updateModelAnswerStatus();
    updateAddToListState();
  }

  document.addEventListener('DOMContentLoaded', initializeBuilder);
})();
