import { initProtectedPage, initSignedInAs, initBurgerMenu } from '../core/auth-ui.js';
import { isPrivateTask } from '../components/privacy-badge.js';
import { escapeHtml } from '../utils/ui-utils.js';
import { parseCustomErrorRules } from '../utils/parsons-editor-utils.js';

// Initialize Page Protection & Navigation Components
initProtectedPage('/');
initSignedInAs();
initBurgerMenu();

// Format multi-line text for display
function formatMultilineText(text) {
  if (!text) return '<em class="text-muted">None</em>';
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// Convert doctest examples into assert statements for visual display
function convertDoctestsToAsserts(header) {
  if (!header) return '';
  
  // Find docstring contents
  let docstring = '';
  const firstQuote = header.indexOf('"""');
  const lastQuote = header.lastIndexOf('"""');
  if (firstQuote !== -1 && lastQuote !== -1 && firstQuote !== lastQuote) {
    docstring = header.substring(firstQuote + 3, lastQuote);
  } else {
    const firstSingle = header.indexOf("'''");
    const lastSingle = header.lastIndexOf("'''");
    if (firstSingle !== -1 && lastSingle !== -1 && firstSingle !== lastSingle) {
      docstring = header.substring(firstSingle + 3, lastSingle);
    }
  }
  
  if (!docstring) return '';
  
  const lines = docstring.split('\n').map(l => l.trim());
  const asserts = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('>>>')) {
      const expr = line.substring(3).trim();
      // Check the next line for the expected return value
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        // Ensure it's not another doctest command or line continuation
        if (nextLine && !nextLine.startsWith('>>>') && !nextLine.startsWith('...')) {
          asserts.push(`assert ${expr} == ${nextLine}`);
          i++; // Skip expected output line
        }
      }
    }
  }
  
  return asserts.join('\n');
}

// Main page logic
async function loadTaskDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const taskId = urlParams.get('id');

  if (!taskId) {
    showErrorPage('No Task ID provided in URL.');
    return;
  }

  try {
    // 1. Fetch task details
    const response = await fetch(`/api/tasks/${taskId}`);
    if (!response.ok) {
      if (response.status === 404) {
        showErrorPage('Task not found.');
      } else {
        showErrorPage(`Error loading task: ${response.statusText}`);
      }
      return;
    }
    const task = await response.json();

    // 2. Render Header Information
    const titleEl = document.getElementById('details-task-title');
    const subtitleEl = document.getElementById('details-task-subtitle');
    const badgeContainer = document.getElementById('task-badge-container');

    titleEl.textContent = task.title;
    subtitleEl.textContent = `Task ID: ${task.id} • Created ${new Date(task.created_at).toLocaleDateString()}`;

    // Clear and populate badges
    badgeContainer.innerHTML = '';

    const visibilityBadge = document.createElement('span');
    const privateTask = isPrivateTask(task);
    visibilityBadge.className = `task-details-badge preview-badge ${privateTask ? 'priv' : 'pub'}`;
    visibilityBadge.innerHTML = privateTask
      ? '<i class="fas fa-lock"></i> Private'
      : '<i class="fas fa-globe"></i> Public';
    badgeContainer.appendChild(visibilityBadge);

    // Task Type Badge
    const typeBadge = document.createElement('span');
    const typeClass = task.task_type === 'Faded' ? 'type-faded' : 'type-normal';
    typeBadge.className = `task-details-badge preview-badge ${typeClass}`;
    typeBadge.innerHTML = `<i class="fas fa-tag"></i> ${task.task_type || 'normal'}`;
    badgeContainer.appendChild(typeBadge);

    // Faded Badge
    if (task.faded) {
      const fadedBadge = document.createElement('span');
      fadedBadge.className = 'task-details-badge preview-badge type-faded';
      fadedBadge.innerHTML = '<i class="fas fa-keyboard"></i> Faded';
      badgeContainer.appendChild(fadedBadge);
    }

    // 3. Setup Navigation buttons
    document.getElementById('action-run-task').href = `/task?id=${task.id}`;
    document.getElementById('action-stats-task').href = `/task-statistics?id=${task.id}`;

    // Check if task is editable and configure button
    try {
      const editableResp = await fetch(`/api/problems/${task.id}/editable`);
      if (editableResp.ok) {
        const editableData = await editableResp.json();
        if (editableData.editable) {
          const editBtn = document.getElementById('action-edit-task');
          editBtn.href = `/create-task-editor?task_id=${task.id}`;
          editBtn.style.display = 'inline-flex';
        }
      }
    } catch (err) {
      console.warn('Failed to check edit status:', err);
    }

    // 4. Start Page Intro & Problem Statement
    document.getElementById('details-start-intro').innerHTML = formatMultilineText(task.description);

    let problemText = '';
    try {
      const instructionsObj = typeof task.task_instructions === 'string' 
        ? JSON.parse(task.task_instructions) 
        : task.task_instructions;
      
      if (instructionsObj.function_name) {
        problemText += `<strong>${escapeHtml(instructionsObj.function_name)}</strong><br>`;
      }
      problemText += formatMultilineText(instructionsObj.task_instructions || task.task_instructions);
      if (instructionsObj.examples) {
        problemText += `<br><br><strong>Examples:</strong><pre style="margin-top: 0.5rem; background: #f1f5f9; padding: 0.75rem; border-radius: 6px;"><code>${escapeHtml(instructionsObj.examples)}</code></pre>`;
      }
    } catch (e) {
      problemText = formatMultilineText(task.task_instructions);
    }
    document.getElementById('details-problem-statement').innerHTML = problemText;

    const blocks = task.code_blocks?.blocks || [];
    const correctOrder = task.correct_solution?.correct_order || [];

    // 5. Model Answer (Display as raw text block with .model-code class, exactly like statistics)
    const modelCodeEl = document.getElementById('details-model-code');
    const modelCode = task.model_answer || task.correct_solution?.solution_code || '';
    modelCodeEl.textContent = modelCode.trim() || 'No model answer configured.';

    // 6. Evaluation Details (Tests, Console Output, or Conceptual)
    const evalTitleEl = document.getElementById('details-eval-title');
    const evalBodyEl = document.getElementById('details-eval-body');
    
    const evalType = task.correct_solution?.eval_type || 'unit_test';
    let teacherTests = task.correct_solution?.teacher_tests || '';
    const expectedOutput = task.correct_solution?.expected_output || '';

    if (!teacherTests.trim() && task.code_blocks?.function_header) {
      teacherTests = convertDoctestsToAsserts(task.code_blocks.function_header);
    }
    
    evalBodyEl.innerHTML = '';
    
    if (evalType === 'unit_test') {
      evalTitleEl.innerHTML = '<i class="fas fa-vial text-info"></i> Function Unit Tests';
      const pre = document.createElement('pre');
      pre.className = 'code-display';
      pre.style.cssText = 'border-radius: 0; border: none; margin: 0;';
      pre.textContent = teacherTests.trim() || 'No unit tests configured.';
      evalBodyEl.appendChild(pre);
      
    } else if (evalType === 'stdout') {
      evalTitleEl.innerHTML = '<i class="fas fa-terminal text-info"></i> Console Output Evaluation';
      
      const paddingDiv = document.createElement('div');
      paddingDiv.className = 'p-3';
      
      const driverLabel = document.createElement('h6');
      driverLabel.className = 'font-weight-bold mb-2';
      driverLabel.textContent = 'Function Calls / Driver Code';
      paddingDiv.appendChild(driverLabel);
      
      const driverPre = document.createElement('pre');
      driverPre.className = 'code-display mb-3';
      driverPre.style.cssText = 'border-radius: 6px; border: 1px solid #e2e8f0; margin-bottom: 1rem;';
      driverPre.textContent = teacherTests.trim() || 'No driver code configured.';
      paddingDiv.appendChild(driverPre);
      
      const outputLabel = document.createElement('h6');
      outputLabel.className = 'font-weight-bold mb-2';
      outputLabel.textContent = 'Expected Output';
      paddingDiv.appendChild(outputLabel);
      
      const outputPre = document.createElement('pre');
      outputPre.className = 'code-display mb-0';
      outputPre.style.cssText = 'border-radius: 6px; border: 1px solid #e2e8f0; background: #f8fafc; color: #0f172a; margin-bottom: 0;';
      outputPre.textContent = expectedOutput.trim() || 'No expected output configured.';
      paddingDiv.appendChild(outputPre);
      
      evalBodyEl.appendChild(paddingDiv);
      
    } else if (evalType === 'order_only') {
      evalTitleEl.innerHTML = '<i class="fas fa-list-ol text-info"></i> Order Only (Conceptual)';
      
      const paddingDiv = document.createElement('div');
      paddingDiv.className = 'p-3';
      
      const alertDiv = document.createElement('div');
      alertDiv.className = 'alert alert-info mb-0';
      alertDiv.innerHTML = '<i class="fas fa-info-circle mr-2"></i> Conceptual task. No code execution or tests are required.';
      paddingDiv.appendChild(alertDiv);
      
      evalBodyEl.appendChild(paddingDiv);
    }

    // 7. Custom Error Messages
    const errContainer = document.getElementById('details-err-container');
    const errCountBadge = document.getElementById('details-err-count');
    const rawErrorMessages = task.correct_solution?.custom_error_messages;
    const errorRules = parseCustomErrorRules(rawErrorMessages);

    errCountBadge.textContent = `${errorRules.length} ${errorRules.length === 1 ? 'rule' : 'rules'}`;

    if (errorRules.length > 0) {
      errContainer.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'err-rules-grid';
      
      errorRules.forEach(rule => {
        const card = document.createElement('div');
        card.className = 'err-rule-card';
        
        card.innerHTML = `
          <div class="err-rule-header">
            <i class="fas fa-search"></i> If output/error contains
          </div>
          <div class="err-rule-pattern">${escapeHtml(rule.pattern)}</div>
          <div class="err-rule-header" style="margin-top: 0.25rem;">
            <i class="fas fa-arrow-right"></i> Student sees custom message
          </div>
          <div class="err-rule-message">${escapeHtml(rule.message)}</div>
        `;
        grid.appendChild(card);
      });
      errContainer.appendChild(grid);
    }

    // 8. Configured Code Blocks (Full list including distractors)
    const blocksContainer = document.getElementById('details-blocks-container');
    const blocksSummary = document.getElementById('details-blocks-summary');
    const correctOrderSet = new Set(correctOrder);

    blocksSummary.textContent = `${blocks.length} configured block${blocks.length === 1 ? '' : 's'}`;

    if (blocks.length > 0) {
      blocksContainer.innerHTML = '';
      
      blocks.forEach((block) => {
        const isSolution = correctOrderSet.has(block.id);
        const isPinned = block.given === true;
        
        const blockEl = document.createElement('div');
        blockEl.className = 'block-item';
        
        if (isPinned) {
          blockEl.classList.add('pinned-block');
        } else if (isSolution) {
          blockEl.classList.add('solution-block');
        } else {
          blockEl.classList.add('distractor-block');
        }

        // Apply indentation padding
        blockEl.style.paddingLeft = '1.25rem';

        // Format !BLANK/___ into visual badges
        const cleanCode = String(block.code || '')
          .replace(/<input\b[^>]*>(?:<\/input>)?/gi, '!BLANK')
          .replace(/<input\b[^>]*\/>/gi, '!BLANK')
          .replace(/<[^>]+>/g, '');
        const formattedCode = escapeHtml(cleanCode)
          .replace(/(!BLANK|___)/g, '<span class="faded-blank">___</span>');

        // Build Badge HTML
        let badgeHtml = '';
        if (isPinned) {
          badgeHtml = '<span class="block-badge badge-pin"><i class="fas fa-thumbtack"></i> Pinned / Given</span>';
        } else if (isSolution) {
          badgeHtml = '';
        } else {
          badgeHtml = '';
        }

        blockEl.innerHTML = `
          <div class="d-flex align-items-center gap-2">
            ${isPinned ? '<span class="text-primary mr-1" title="Pinned block">📌</span>' : ''}
            <code style="color: inherit; font-size: inherit;">${formattedCode}</code>
          </div>
          <div>${badgeHtml}</div>
        `;
        
        blocksContainer.appendChild(blockEl);
      });
    } else {
      blocksContainer.innerHTML = '<div class="empty-display"><i class="fas fa-cubes"></i> No blocks configured.</div>';
    }

  } catch (err) {
    console.error('Failed to load task details:', err);
    showErrorPage(`An unexpected error occurred: ${err.message}`);
  }
}

function showErrorPage(message) {
  const container = document.querySelector('.dashboard-main');
  if (container) {
    container.innerHTML = `
      <div class="card p-5 text-center shadow-sm" style="border-radius: 12px;">
        <i class="fas fa-exclamation-triangle text-danger" style="font-size: 3rem; margin-bottom: 1rem;"></i>
        <h4 class="font-weight-bold">Error Loading Details</h4>
        <p class="text-muted">${escapeHtml(message)}</p>
        <a href="/teacher-dashboard" class="btn btn-primary mt-3" style="width: fit-content; margin: 0 auto;">
          <i class="fas fa-arrow-left"></i> Back to Dashboard
        </a>
      </div>
    `;
  }
}

// Run loader on load
window.addEventListener('DOMContentLoaded', loadTaskDetails);
