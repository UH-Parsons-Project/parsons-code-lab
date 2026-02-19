// Import custom modules
import {get, set} from './user-storage.js'; // Local storage for user data persistence
import {
	prepareCode, // Prepares code for testing
	processTestResults, // Processes test results
	processTestError, // Handles test errors
} from './doctest-grader.js';
import './problem-element.js'; // Problem UI web component
import {FiniteWorker} from './worker-manager.js'; // Worker process for Python code execution

// Local storage key for saving user code representation
const LS_REPR = '-repr';

// Global reference to the current problem element
let probEl;

// Global variable to store task ID for local storage operations
let globalTaskId;

// Initializes the problem widget. Called when the page loads.
export async function initWidget() {
	// Extract the task ID from URL parameters (e.g., ?id=1)
	let params = new URL(document.location).searchParams;
	globalTaskId = params.get('id');

	if (!globalTaskId) {
		document.getElementById('problem-wrapper').innerHTML =
			'<p>Error: No task ID provided</p>';
		return;
	}

	try {
		// Fetch task from API
		const response = await fetch(`/api/tasks/${globalTaskId}`);

		if (!response.ok) {
			throw new Error(`Failed to fetch task: ${response.statusText}`);
		}

		const task = await response.json();

		// Parse description JSON
		let parsedDescription = {};
		try {
			parsedDescription =
				typeof task.description === 'string'
					? JSON.parse(task.description)
					: task.description;
		} catch (e) {
			// Fallback if description is not valid JSON
			parsedDescription = {
				function_name: '',
				description: task.description || '',
				examples: '',
			};
		}

		// Build HTML problem statement from structured parts
		let problemStatementHTML = '';
		if (parsedDescription.function_name) {
			problemStatementHTML += `<strong>${parsedDescription.function_name}</strong>`;
		}
		if (parsedDescription.description) {
			problemStatementHTML += ` ${parsedDescription.description}`;
		}
		if (parsedDescription.examples) {
			problemStatementHTML += `<br><pre><code>${parsedDescription.examples}</code></pre>`;
		}

		const codeBlocksData = task.code_blocks;
		const functionHeader = codeBlocksData.function_header;

		// Reconstruct code lines from blocks for display
		let codeLines = reconstructCodeLines(codeBlocksData.blocks);

		// Add debug print statements and blank lines
		codeLines =
			codeLines +
			"\nprint('DEBUG:', !BLANK)" +
			"\nprint('DEBUG:', !BLANK)" +
			'\n# !BLANK' +
			'\n# !BLANK';

		// Check if user has previously saved code in local storage
		const localRepr = get(globalTaskId + LS_REPR);
		if (localRepr) {
			// If saved code exists, use it instead of the default
			codeLines = localRepr;
		}

		// Create a new problem-element web component
		probEl = document.createElement('problem-element');

		// Set component attributes
		probEl.setAttribute('name', globalTaskId);
		probEl.setAttribute('description', problemStatementHTML);
		probEl.setAttribute('codeLines', codeLines);
		probEl.setAttribute('codeHeader', functionHeader);
		probEl.setAttribute('runStatus', 'Loading Pyodide...');

		// Listen for 'run' event fired when user clicks the Run button
		probEl.addEventListener('run', (e) => {
			handleSubmit(e.detail.code, e.detail.repr, functionHeader);
		});

		// Activate the run button
		probEl.setAttribute('enableRun', 'enableRun');
		probEl.setAttribute('runStatus', '');

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
		let code = indent + block.code;

		// Convert ___ to !BLANK for Parsons widget to recognize editable fields
		code = code.replace(/___/g, '!BLANK');

		// Add #Ngiven marker if this block is pre-filled (given)
		if (block.given) {
			code += ' #0given';
		}

		lines.push(code);
	}

	return lines.join('\n');
}

// Handles submitted code by running tests and processing results
// submittedCode: the code written by the user
// reprCode: visual representation of user code (for storage)
// codeHeader: Python function template/header
async function handleSubmit(submittedCode, reprCode, codeHeader) {
	// Prepare code and inject test code
	let testResults = prepareCode(submittedCode, codeHeader);

	// If preparation succeeded, execute the code
	if (testResults.code) {
		try {
			// Add sys.stdout.getvalue() to capture output
			const code = testResults.code + '\nsys.stdout.getvalue()';

			// Execute code in a separate worker process (Pyodide)
			const {results, error} = await new FiniteWorker(code);

			// Process results or errors
			if (results) {
				testResults = processTestResults(results);
			} else {
				testResults = processTestError(error, testResults.startLine);
			}
		} catch (e) {
			// Log error to console
			console.warn(
				`Error in pyodideWorker at ${e.filename}, Line: ${e.lineno}, ${e.message}`
			);
		}
	}

	// Update UI with test results
	probEl.setAttribute('runStatus', ''); // Clear loading status
	probEl.setAttribute('resultsStatus', testResults.status); // Pass/Fail
	probEl.setAttribute('resultsHeader', testResults.header); // Result title
	probEl.setAttribute('resultsDetails', testResults.details); // Result details

	// Save user code locally for next time
	set(probEl.getAttribute('name') + LS_REPR, reprCode);
}
