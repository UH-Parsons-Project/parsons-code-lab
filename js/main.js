// Import external libraries and modules
import yaml from 'js-yaml';  // YAML parsing for configuration files

// Import custom modules
import {get, set} from './user-storage.js';  // Local storage for user data persistence
import {
	prepareCode,           // Prepares code for testing
	processTestResults,    // Processes test results
	processTestError,      // Handles test errors
} from './doctest-grader.js';
import './problem-element.js';  // Problem UI web component
import {FiniteWorker} from './worker-manager.js';  // Worker process for Python code execution

// Local storage key for saving user code representation
const LS_REPR = '-repr';

// Global reference to the current problem element
let probEl;

// Initializes the problem widget. Called when the page loads.
export function initWidget() {
	// Extract the problem name from URL parameters (e.g., ?name=hello_world)
	let params = new URL(document.location).searchParams;
	let problemName = params.get('name');

	// Fetch the YAML configuration and Python code template in parallel
	const fetchConf = fetch(`parsons_probs/${problemName}.yaml`).then((res) =>
		res.text()
	);
	const fetchFunc = fetch(`parsons_probs/${problemName}.py`).then((res) =>
		res.text()
	);
	
	// Wait for both fetch requests to complete
	const allData = Promise.all([fetchConf, fetchFunc]);

	// Process the loaded files
	allData.then((res) => {
		const [config, func] = res;
		
		// Parse YAML configuration into JavaScript object
		const configYaml = yaml.load(config);
		const probDescription = configYaml['problem_description'];
		
		// Get code lines and add debug print statements plus blank lines
		let codeLines =
			configYaml['code_lines'] +
			"\nprint('DEBUG:', !BLANK)" +
			"\nprint('DEBUG:', !BLANK)" +
			'\n# !BLANK' +
			'\n# !BLANK';
		
		// Check if user has previously saved code in local storage
		const localRepr = get(problemName + LS_REPR);
		if (localRepr) {
			// If saved code exists, use it instead of the default
			codeLines = localRepr;
		}
		
		// Create a new problem-element web component
		probEl = document.createElement('problem-element');
		
		// Set component attributes
		probEl.setAttribute('name', problemName);
		probEl.setAttribute('description', probDescription);
		probEl.setAttribute('codeLines', codeLines);
		probEl.setAttribute('codeHeader', func);  // Python function template
		probEl.setAttribute('runStatus', 'Loading Pyodide...');
		
		// Listen for 'run' event fired when user clicks the Run button
		probEl.addEventListener('run', (e) => {
			handleSubmit(e.detail.code, e.detail.repr, func);
		});
		
		// Activate the run button
		probEl.setAttribute('enableRun', 'enableRun');
		probEl.setAttribute('runStatus', '');
		
		// Add component to the DOM
		document.getElementById('problem-wrapper').appendChild(probEl);
	});
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
	probEl.setAttribute('runStatus', '');  // Clear loading status
	probEl.setAttribute('resultsStatus', testResults.status);  // Pass/Fail
	probEl.setAttribute('resultsHeader', testResults.header);  // Result title
	probEl.setAttribute('resultsDetails', testResults.details);  // Result details

	// Save user code locally for next time
	set(probEl.getAttribute('name') + LS_REPR, reprCode);
}
