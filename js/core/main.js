// Import custom modules
import {get, set} from '../core/user-storage.js'; // Local storage for user data persistence
import {
	prepareCode, // Prepares code for testing
	processTestResults, // Processes test results
	processTestError, // Handles test errors
} from '../core/doctest-grader.js';
import '../components/problem-element.js'; // Problem UI web component
import {FiniteWorker} from '../core/worker-manager.js'; // Worker process for Python code execution
import { getUsername } from '../core/auth-utils.js';
import { parseCustomErrorRules } from '../utils/parsons-editor-utils.js';
import { escapeHtml } from '../utils/ui-utils.js';

// Local storage key suffixes for saving user state
const LS_REPR = '-repr';
const LS_MOVES = '-moves';
const LS_EDITS = '-edits';

// Returns a localStorage key scoped to both taskset and task,
// preventing cross-taskset state bleed for shared tasks.
const lsKey = (suffix) => `${globalUniqueLinkCode}-${globalTaskId}${suffix}`;

// Global reference to the current problem element
let probEl;

const isStudentTask = /^\/[^/]+\/set\/[^/]+\/tasks\/(?:\d+|demo)\/?$/.test(window.location.pathname);

// Global variable to store task ID for local storage operations
let globalTaskId;

// Global variable to store unique_link_code for API calls
let globalUniqueLinkCode;

// Global variable to store username from URL
let globalUsername;

// Global teacher tests for custom tasks (if present)
let globalTeacherTests = '';

// Teacher-defined custom error message rules for this task.
let customErrorRules = [];

async function resolveNextTaskUrl() {
	if (!globalUniqueLinkCode || !globalTaskId) {
		return null;
	}

	const tasksResponse = await fetch(`/api/my_sets/${globalUniqueLinkCode}/tasks`, {
		credentials: 'include',
	});
	if (!tasksResponse.ok) {
		return null;
	}

	const allTasks = await tasksResponse.json();
	const tasks = Array.isArray(allTasks) ? allTasks.filter(t => !t.is_hidden) : [];
	if (tasks.length === 0) {
		return null;
	}

	const statusesResponse = await fetch(
		`/api/sets/${globalUniqueLinkCode}/tasks-status`,
		{ credentials: 'include' }
	);
	if (!statusesResponse.ok) {
		return null;
	}
	const bulkStatuses = await statusesResponse.json();

	const currentTaskId = Number(globalTaskId);
	const statuses = tasks.map((task, idx) => {
		const taskNumber = idx + 1;
		const statusObj = bulkStatuses[idx] || {
			has_started: false,
			student_completed: 0
		};

		return {
			taskId: task.id,
			taskNumber: taskNumber,
			isCompleted: Number(statusObj.student_completed || 0) > 0,
			hasStarted: Boolean(statusObj.has_started),
		};
	});

	const unfinished = statuses.filter(
		(item) => !item.isCompleted && item.taskId !== currentTaskId
	);
	if (unfinished.length === 0) {
		return null;
	}

	const preferred = unfinished.find((item) => item.hasStarted) || unfinished[0];
	if (preferred.hasStarted) {
		return `/${globalUsername}/set/${globalUniqueLinkCode}/tasks/${preferred.taskId}`;
	}

	return `/${globalUsername}/set/${globalUniqueLinkCode}/tasks/${preferred.taskId}/start`;
}



// Initializes the problem widget. Called when the page loads.
export async function initWidget() {
	// Extract the task ID from URL path (e.g., /username/set/starter-list/tasks/1)
	// or from URL parameters (e.g., ?id=1) for backwards compatibility
	let params = new URL(document.location).searchParams;
	globalTaskId = params.get('id');

	const pathParts = window.location.pathname.split('/').filter(p => p);
	// Path format: {username}/set/unique_link_code/tasks/task_id
	if (pathParts.length >= 5 && pathParts[3] === 'tasks') {
		if (!globalUsername) globalUsername = pathParts[0];
		if (!globalUniqueLinkCode) globalUniqueLinkCode = pathParts[2];
		if (!globalTaskId) globalTaskId = pathParts[4];
	}

	if (!globalTaskId) {
		document.getElementById('problem-wrapper').innerHTML =
			'<p>Error: No task ID provided</p>';
		return;
	}

	try {
		// Fetch task from API
		const taskApiUrl = globalUniqueLinkCode
			? `/api/sets/${globalUniqueLinkCode}/tasks/${globalTaskId}`
			: `/api/tasks/${globalTaskId}`;
		const response = await fetch(taskApiUrl);

		if (!response.ok) {
			if (response.status === 404) {
				window.location.replace('/not-found');
				return;
			}
			throw new Error(`Failed to fetch task: ${response.statusText}`);
		}

		const task = await response.json();
		customErrorRules = parseCustomErrorRules(
			task?.correct_solution?.custom_error_messages ?? task?.correct_solution?.customErrorMessages
		);

		// Parse task instructions JSON
		let parsedInstructions = {};
		try {
			parsedInstructions =
				typeof task.task_instructions === 'string'
					? JSON.parse(task.task_instructions)
					: task.task_instructions;
		} catch (e) {
			// Fallback if task_instructions is not valid JSON
			parsedInstructions = {
				function_name: '',
				task_instructions: task.task_instructions || '',
				examples: '',
			};
		}

		// Build HTML problem statement from structured parts
		let problemStatementHTML = '';
		if (parsedInstructions.function_name) {
			problemStatementHTML += `<strong>${escapeHtml(parsedInstructions.function_name)}</strong><br>`;
		}
		if (parsedInstructions.task_instructions) {
			problemStatementHTML += escapeHtml(parsedInstructions.task_instructions).replace(/\n/g, '<br>');
		}
		if (parsedInstructions.examples) {
			problemStatementHTML += `<br><br><strong>Examples:</strong><pre style="margin-top: 0.5rem; background: #f1f5f9; padding: 0.75rem; border-radius: 6px;"><code>${escapeHtml(parsedInstructions.examples)}</code></pre>`;
		}

		const codeBlocksData = task.code_blocks;
		const functionHeader = codeBlocksData.function_header;
		globalTeacherTests = task?.correct_solution?.teacher_tests || '';
		if (globalTeacherTests) {
			const username = localStorage.getItem('nickname') || getUsername();
			if (username) {
				globalTeacherTests = globalTeacherTests.replace(/{USERNAME}/g, username);
			}
		}

		const evalType = task.eval_type || task.correct_solution?.eval_type || 'unit_test';

		// Reconstruct code lines from blocks for display
		let codeLines = reconstructCodeLines(codeBlocksData.blocks);

		// Add debug print statements and blank lines ONLY for code-executing tasks (unit_test, stdout)
		if (evalType !== 'order_only') {
			codeLines =
				codeLines +
				"\nprint('DEBUG:', !BLANK)" +
				"\nprint('DEBUG:', !BLANK)" +
				'\n# !BLANK' +
				'\n# !BLANK';
		}

		// Create a new problem-element web component
		probEl = document.createElement('problem-element');

		// Set component attributes
		probEl.setAttribute('name', globalTaskId);
		probEl.setAttribute('taskInstructions', problemStatementHTML);
		probEl.setAttribute('description', task.description);
		probEl.setAttribute('codeLines', codeLines);
		probEl.setAttribute('codeHeader', functionHeader);
		probEl.setAttribute('runStatus', 'Loading Pyodide...');
		probEl.shuffleStarterBlocks = isStudentTask;
		
		const expectedOutput = task.expected_output !== undefined ? task.expected_output : (task.correct_solution?.expected_output || '');
		const correctOrder = task.correct_order || task.correct_solution?.correct_order || [];
		const requireIndentation = task.require_indentation !== undefined ? task.require_indentation : (task.correct_solution?.require_indentation !== undefined ? task.correct_solution.require_indentation : true);
		probEl.setAttribute('evalType', evalType);
		if (requireIndentation) {
			probEl.setAttribute('requireIndentation', 'true');
		}

		// Restore any unsent moves/edits from a previous session
		const savedMoves = JSON.parse(get(lsKey(LS_MOVES), '[]'));
		const savedEdits = JSON.parse(get(lsKey(LS_EDITS), '[]'));
		if (savedMoves.length > 0) probEl.recordedMoves = savedMoves;
		if (savedEdits.length > 0) probEl.recordedEdits = savedEdits;

		// Restore saved arrangement: prefer server-side saved arrangement
		// (task.submitted_order) when present (student's successful attempt),
		// otherwise fall back to local session cache.
		if (task && task.submitted_order) {
			probEl.savedArrangement = task.submitted_order;
		} else {
			const savedArrangementJson = get(lsKey(LS_REPR));
			if (savedArrangementJson) {
				try {
					probEl.savedArrangement = JSON.parse(savedArrangementJson);
				} catch (e) {
					// Ignore malformed or old-format data
				}
			}
		}

		// Listen for 'run' event fired when user clicks the Run button
		probEl.addEventListener('run', (e) => {
			handleSubmit(e.detail.code, e.detail.repr, e.detail.studentOrder, e.detail.moves, e.detail.edits, functionHeader, globalTeacherTests, evalType, expectedOutput, correctOrder);
		});

		// Save arrangement and move/edit history to localStorage on every change
		probEl.addEventListener('arrangement-changed', (e) => {
			if (e.detail.arrangement) {
				set(lsKey(LS_REPR), JSON.stringify(e.detail.arrangement));
			}
			set(lsKey(LS_MOVES), JSON.stringify(probEl.recordedMoves));
			set(lsKey(LS_EDITS), JSON.stringify(probEl.recordedEdits));
		});

		// Activate the run button
		probEl.setAttribute('enableRun', 'enableRun');
		probEl.setAttribute('runStatus', '');
		probEl.showNextTask = false;
		probEl.nextTaskUrl = '';

		// Add component to the DOM
		document.getElementById('problem-wrapper').appendChild(probEl);
	} catch (error) {
		document.getElementById(
			'problem-wrapper'
		).innerHTML = `<p>Error loading task: ${error.message}</p>`;
	}
}

// Reconstructs code lines from structured blocks
// blocks: array of block objects with code, indent, faded properties
function reconstructCodeLines(blocks) {
	let lines = [];

	for (const block of blocks) {
		// Add proper indentation
		const indent = '    '.repeat(block.indent);

		// Start from raw block code; sanitize any teacher-only artifacts
		// so student view preserves empty blanks.
		let raw = String(block.code || '');

		// Remove any filled-blank markers inserted by the editor (e.g. #blankVALUE#)
		raw = raw.replace(/#blank[^#]*#/g, '');

		// Remove any preplace markers that may have been used for previewing
		raw = raw.replace(/\s*#preplace\b/g, '');

		// If the block contains input HTML, replace inputs with a blank marker
		if (/<input\b/i.test(raw)) {
			const container = document.createElement('div');
			container.innerHTML = raw;
			container.querySelectorAll('input').forEach((input) => {
				const repl = document.createTextNode('!BLANK');
				input.replaceWith(repl);
			});
			raw = container.textContent || '';
		}

		// Compose final code with indentation
		let code = indent + raw;

		// Convert legacy ___ placeholders to !BLANK for Parsons widget
		code = code.replace(/___/g, '!BLANK');

		// Add #Ngiven marker if this block is pre-filled (given)
		if (block.given) {
			code += ` #${block.indent}given`;
		}

		lines.push(code);
	}

	return lines.join('\n');
}

// Handles submitted code by running tests and processing results
// submittedCode: the code written by the user
// reprCode: visual representation of user code (for storage)
// moves: array of move events recorded during the attempt
// edits: array of blank field edit events recorded during the attempt
// codeHeader: Python function template/header
async function handleSubmit(submittedCode, reprCode, studentOrder, moves, edits, codeHeader, teacherTests, evalType, expectedOutput, correctOrder) {
	if (evalType === 'order_only') {
		let success = true;
		
		if (!correctOrder || correctOrder.length === 0) {
			success = true; // no order defined
		} else if (studentOrder.length !== correctOrder.length) {
			success = false;
		} else {
			for (let i = 0; i < correctOrder.length; i++) {
				if (studentOrder[i] !== correctOrder[i]) {
					success = false;
					break;
				}
			}
		}

		let testResults = {
			status: success ? 'pass' : 'fail',
			header: success ? 'Order is correct!' : 'Order is incorrect.',
			details: success ? 'Great job! The blocks are in the correct order.' : 'Check the order of your blocks and try again.',
		};

		probEl.setAttribute('runStatus', '');
		probEl.setAttribute('resultsStatus', testResults.status);
		probEl.setAttribute('resultsHeader', testResults.header);
		probEl.setAttribute('resultsDetails', testResults.details);
		probEl.setAttribute('resultsMessageSource', 'system');
		probEl.setAttribute('resultsTeacherHint', '');
		probEl.showNextTask = false;
		probEl.nextTaskUrl = '';
		probEl.allTasksCompleted = false;
		probEl.backToSetUrl = '';

		if (testResults.status === 'pass') {
			try {
				const nextTaskUrl = await resolveNextTaskUrl();
				if (nextTaskUrl) {
					probEl.nextTaskUrl = nextTaskUrl;
					probEl.showNextTask = true;
				} else {
					probEl.allTasksCompleted = true;
					probEl.backToSetUrl = `/${globalUsername}/set/${globalUniqueLinkCode}/tasks`;
				}
			} catch (error) {
				console.warn('Failed to resolve next task URL:', error);
			}
		}

		set(lsKey(LS_MOVES), '[]');
		set(lsKey(LS_EDITS), '[]');

		try {
			const resultData = {
				task_id: parseInt(globalTaskId),
				success: testResults.status === 'pass',
				submitted_code: submittedCode,
				test_output: testResults.details || '',
				repr_code: reprCode,
				arrangement: probEl.getCurrentArrangement(),
				moves: moves || [],
				edits: edits || []
			};

			const response = await fetch(`/api/sets/${globalUniqueLinkCode}/tasks/${globalTaskId}/submit-result`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(resultData)
			});

			if (response.ok) {
				await response.json();
				localStorage.removeItem(`task_${globalTaskId}_start_time`);
			}
		} catch (error) {
			console.warn('Error saving test results to backend:', error);
		}
		return;
	}

	// Prepare code and inject test code
	let testResults = prepareCode(submittedCode, codeHeader, teacherTests, evalType);

	// If preparation succeeded, execute the code
	if (testResults.code) {
		try {
			const code = testResults.code;

			// Execute code in a separate worker process (Pyodide)
			const {results, error} = await new FiniteWorker(code);

			// Process results or errors
			if (typeof results === 'string') {
				testResults = processTestResults(results, customErrorRules, evalType, expectedOutput, teacherTests);
			} else {
				testResults = processTestError(error, testResults.startLine, customErrorRules);
			}
		} catch (e) {
			// Log error to console
			console.warn(
				`Error in pyodideWorker at ${e.filename}, Line: ${e.lineno}, ${e.message}`
			);
			testResults = {
				status: 'fail',
				header: 'Unexpected error occurred',
				details: e.message || 'An unknown error occurred while running tests.',
				messageSource: 'system',
			};
		}
	}

	if (!testResults || !testResults.status) {
		testResults = {
			status: 'fail',
			header: 'Unexpected error occurred',
			details: 'No test result was produced.',
			messageSource: 'system',
		};
	}

	// Update UI with test results
	probEl.setAttribute('runStatus', ''); // Clear loading status
	probEl.setAttribute('resultsStatus', testResults.status);
	probEl.setAttribute('resultsHeader', testResults.header);
	probEl.setAttribute('resultsDetails', testResults.details);
	probEl.setAttribute('resultsMessageSource', testResults.messageSource || 'system');
	probEl.setAttribute('resultsTeacherHint', testResults.teacherHint || '');
	probEl.showNextTask = false;
	probEl.nextTaskUrl = '';
	probEl.allTasksCompleted = false;
	probEl.backToSetUrl = '';

	if (testResults.status === 'pass') {
		try {
			const nextTaskUrl = await resolveNextTaskUrl();
			if (nextTaskUrl) {
				probEl.nextTaskUrl = nextTaskUrl;
				probEl.showNextTask = true;
			} else {
				// No more tasks to do
				probEl.allTasksCompleted = true;
				probEl.backToSetUrl = `/${globalUsername}/set/${globalUniqueLinkCode}/tasks`;
			}
		} catch (error) {
			console.warn('Failed to resolve next task URL:', error);
		}
	}

	// Clear the pending moves/edits buffer (arrangement was already saved on last move)
	set(lsKey(LS_MOVES), '[]');
	set(lsKey(LS_EDITS), '[]');

	try {
				const resultData = {
			task_id: parseInt(globalTaskId),
			success: testResults.status === 'pass',
			submitted_code: submittedCode,
			test_output: testResults.details || '',
			repr_code: reprCode,
					arrangement: probEl.getCurrentArrangement(),
					moves: moves || [], // Include recorded moves with the submission
				edits: edits || [] // Include recorded blank edits with the submission
		};

		const response = await fetch(`/api/sets/${globalUniqueLinkCode}/tasks/${globalTaskId}/submit-result`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(resultData)
		});

		if (response.ok) {
			await response.json();
			// Clean up the start time from localStorage after successful submission
			localStorage.removeItem(`task_${globalTaskId}_start_time`);
		} else {
			console.warn('Failed to save test results:', response.statusText);
		}
	} catch (error) {
		console.warn('Error saving test results to backend:', error);
	}
}