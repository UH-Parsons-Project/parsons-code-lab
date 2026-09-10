function findNextUnindentedLine(lines, start) {
	/*
    Finds the next piece of unindented code in the file. Ignores empty lines and lines
    that start with a space or tab. Returns len(lines) if no unindented line found.
    */
	let lineNum = start;
	while (lineNum < lines.length) {
		const line = lines[lineNum];
		if (!(line == '' || line[0] == ' ' || line[0] == '\t' || line[0] == '\n')) {
			break;
		}
		lineNum++;
	}
	return lineNum;
}

function countDocstringLines(lines) {
	let startLine = -1;
	let inDocstring = false;
	lines.forEach((line, i) => {
		if (line.trim().includes('"""')) {
			if (inDocstring) {
				startLine = i + 1;
				return;
			}
			inDocstring = true;
		}
	});
	return startLine;
}

function escapePythonSingleQuotedString(value) {
	return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function extractTeacherTestBlocks(outputStr) {
	const lines = outputStr.split('\n').map((line) => line.trimEnd());
	const testBlocks = [];
	let currentBlock = [];

	const isTeacherMarker = (line) =>
		line.startsWith('✅ Passed test') || line.startsWith('❌ Failed test');
	const isTracebackBoundary = (line) =>
		line.startsWith('Traceback (most recent call last):') ||
		line === 'ALL_TEACHER_TESTS_PASSED' ||
		line.startsWith('File "');

	const flushBlock = () => {
		if (currentBlock.length) {
			testBlocks.push(currentBlock.join('\n').trim());
			currentBlock = [];
		}
	};

	for (const line of lines) {
		if (isTeacherMarker(line)) {
			flushBlock();
			currentBlock = [line];
			continue;
		}

		if (!currentBlock.length) {
			continue;
		}

		if (isTracebackBoundary(line)) {
			flushBlock();
			continue;
		}

		if (/^[A-Za-z_][A-Za-z0-9_]*(Error|Exception)(:|$)/.test(line)) {
			flushBlock();
			continue;
		}

		currentBlock.push(line);
	}

	flushBlock();
	return testBlocks.filter(Boolean);
}

function extractError(error, numDocstringLines) {
	if (!error) {
		return 'No error report found.';
	}

	const errorLines = error.split('\n');
	let errorIndex = -1;
	let fileIndex = -1;
	let lineNum = null;

	for (let i = errorLines.length - 1; i >= 0; i--) {
		const trimmed = errorLines[i].trim();
		if (/^[A-Za-z_][A-Za-z0-9_]*(Error|Exception)(:|$)/.test(trimmed)) {
			errorIndex = i;
			break;
		}
	}

	if (errorIndex === -1) {
		return error;
	}

	for (let i = errorIndex - 1; i >= 0; i--) {
		const match = errorLines[i].match(/File "[^"]+", line (\d+)/);
		if (match) {
			fileIndex = i;
			lineNum = parseInt(match[1], 10);
			if (!Number.isNaN(lineNum) && typeof numDocstringLines === 'number') {
				lineNum -= Math.max(numDocstringLines - 1, 0);
			}
			break;
		}
	}

	const snippetStart = fileIndex >= 0 ? fileIndex : Math.max(0, errorIndex - 3);
	const snippet = errorLines.slice(snippetStart, errorIndex + 1).join('\n').trim();

	if (lineNum !== null && !Number.isNaN(lineNum)) {
		return `Error at line ${lineNum}:\n${snippet}`;
	}

	return snippet || error;
}

function cleanupDoctestResults(resultsStr) {
	let keptLines = [];
	let inKeepRange = false;
	let stripNextLineIndent = false;
	resultsStr.split('\n').forEach((line) => {
		if (line.startsWith('File "__main__"')) {
			inKeepRange = true;
			return;
		} else if (
			line.startsWith('Trying:') ||
			line.startsWith('1 items had no tests:')
		) {
			inKeepRange = false;
			stripNextLineIndent = false;
		}
		if (inKeepRange) {
			if (stripNextLineIndent) {
				line = line.trimStart();
				stripNextLineIndent = false;
			}
			line = line.replace('Failed example:', '\n❌ Failed test\nTest input:');
			if (line.includes('❌ Failed test')) {
				stripNextLineIndent = true;
			}
			keptLines.push(line);
		}
	});
	return keptLines.join('\n');
}

function extractPassedExamples(resultsStr) {
	const lines = resultsStr.split('\n');
	const passedExamples = [];

	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].startsWith('Trying:')) {
			continue;
		}

		const tryingLines = [];
		const expectedLines = [];
		let j = i + 1;

		while (j < lines.length) {
			const current = lines[j];
			if (
				current.startsWith('Expecting:') ||
				current.trim() === 'ok' ||
				current.startsWith('Trying:') ||
				current.startsWith('***')
			) {
				break;
			}

			if (current.trim()) {
				tryingLines.push(current.trim());
			}
			j++;
		}

		if (j < lines.length && lines[j].startsWith('Expecting:')) {
			j++;
			while (
				j < lines.length &&
				!lines[j].trim().startsWith('ok') &&
				!lines[j].startsWith('Trying:') &&
				!lines[j].startsWith('***') &&
				!lines[j].startsWith('File "__main__"')
			) {
				if (lines[j].trim()) {
					expectedLines.push(lines[j].trim());
				}
				j++;
			}
		}

		if (j < lines.length && lines[j].trim() === 'ok' && tryingLines.length > 0) {
			const expectedText = expectedLines.length
				? expectedLines.join('\n    ')
				: '<no output>';

			passedExamples.push(
				`Test input:\n    ${tryingLines.join(' ')}\nExpected:\n    ${expectedText}\nGot:\n    ${expectedText}`
			);
		}

		i = j;
	}

	return passedExamples;
}

function normalizeCustomErrorRules(rawRules) {
	if (!rawRules) {
		return [];
	}

	let parsed = rawRules;
	if (typeof rawRules === 'string') {
		try {
			parsed = JSON.parse(rawRules);
		} catch (e) {
			console.warn('Failed to parse custom error rules JSON:', e);
			return [];
		}
	}

	if (!Array.isArray(parsed)) {
		return [];
	}

	return parsed.filter((rule) => {
		if (!rule || typeof rule !== 'object') {
			return false;
		}
		const pattern = typeof rule.pattern === 'string' ? rule.pattern.trim() : '';
		const message = typeof rule.message === 'string' ? rule.message.trim() : '';
		return Boolean(pattern && message);
	});
}

function applyCustomErrorMessageRules(testResults, rawRules) {
	if (!testResults || testResults.status !== 'fail') {
		return testResults;
	}

	const rules = normalizeCustomErrorRules(rawRules);
	if (rules.length === 0) {
		return testResults;
	}

	const header = typeof testResults.header === 'string' ? testResults.header : '';
	const details = typeof testResults.details === 'string' ? testResults.details : '';
	const haystack = `${header}\n${details}`;
	const haystackLower = haystack.toLowerCase();

	for (const rule of rules) {
		const matchType = (typeof rule.match_type === 'string' ? rule.match_type : 'contains').toLowerCase();
		const pattern = typeof rule.pattern === 'string' ? rule.pattern.trim() : '';
		const message = typeof rule.message === 'string' ? rule.message.trim() : '';

		if (!pattern || !message) {
			continue;
		}

		let isMatch = false;
		if (matchType === 'regex') {
			try {
				const regex = new RegExp(pattern, 'i');
				isMatch = regex.test(haystack);
			} catch (e) {
				console.warn('Invalid custom error regex pattern:', pattern, e);
				continue;
			}
		} else {
			isMatch = haystackLower.includes(pattern.toLowerCase());
		}

		if (isMatch) {
			const customHeader =
				typeof rule.header === 'string' && rule.header.trim()
					? rule.header.trim()
					: testResults.header;

			return {
				...testResults,
				header: customHeader,
				teacherHint: message,
				messageSource: 'teacher',
			};
		}
	}

	return testResults;
}

export function prepareCode(submittedCode, codeHeader, teacherTests = '', evalType = 'unit_test') {
	submittedCode += '\n';

	if (evalType === 'stdout') {
		const normalizedTeacherTests = (teacherTests || '').trim();
		let code = submittedCode;
		if (normalizedTeacherTests) {
			code += '\n' + normalizedTeacherTests + '\n';
		}
		return {
			status: 'success',
			header: 'Running code...',
			code: code,
			startLine: 1,
		};
	}

	let lines = (codeHeader || '').split('\n');
	let startLine = countDocstringLines(lines);
	const normalizedTeacherTests = (teacherTests || '').trim();
	const codeLines = submittedCode.split('\n');
	if (!(codeLines[0].includes('def') || codeLines[0].includes('class'))) {
		return {
			status: 'fail',
			header: 'Error running tests',
			details: 'First code line must be `def` or `class` declaration',
		};
	}

	if (startLine === -1) {
		startLine = 1;
		lines = [codeLines[0]];
	}

	// Remove function def or class declaration statement, its relied on elsewhere
	codeLines.shift();

	let line = findNextUnindentedLine(codeLines, 0);
	if (line != codeLines.length) {
		return {
			status: 'fail',
			header: 'Error running tests',
			details:
				'All lines in a function or class definition should be indented at least once. It looks like you have a line that has no indentation.',
		};
	}
	const linesToPreserve = lines.slice(0, startLine);
	const endOfReplaceLines = findNextUnindentedLine(lines, startLine);
	const extraLinesToPreserve = lines.slice(endOfReplaceLines);
	let finalCode = [];
	linesToPreserve.forEach((line) => {
		finalCode.push(line);
	});
	codeLines.forEach((line) => {
		finalCode.push(line);
	});
	extraLinesToPreserve.forEach((line) => {
		finalCode.push(line);
	});
	if (normalizedTeacherTests) {
		finalCode.push('');
		finalCode.push('import ast');
		finalCode.push('__teacher_failures = []');
		finalCode.push('def __format_teacher_value(value):');
		finalCode.push('    try:');
		finalCode.push('        return repr(value)');
		finalCode.push('    except Exception:');
		finalCode.push('        return "<unprintable value>"');
		finalCode.push('');
		finalCode.push('def __run_teacher_assert(assert_source):');
		finalCode.push('    try:');
		finalCode.push('        parsed = ast.parse(assert_source, mode="exec")');
		finalCode.push('    except Exception:');
		finalCode.push('        parsed = None');
		finalCode.push('');
		finalCode.push('    if parsed and parsed.body and isinstance(parsed.body[0], ast.Assert):');
		finalCode.push('        assert_node = parsed.body[0]');
		finalCode.push('        compare_node = assert_node.test');
		finalCode.push('        is_single_equality = (');
		finalCode.push('            isinstance(compare_node, ast.Compare) and');
		finalCode.push('            len(compare_node.ops) == 1 and');
		finalCode.push('            isinstance(compare_node.ops[0], ast.Eq) and');
		finalCode.push('            len(compare_node.comparators) == 1');
		finalCode.push('        )');
		finalCode.push('        if is_single_equality:');
		finalCode.push('            actual_expr = compare_node.left');
		finalCode.push('            expected_expr = compare_node.comparators[0]');
		finalCode.push('            actual_text = ast.unparse(actual_expr)');
		finalCode.push('            actual_value = eval(compile(ast.Expression(actual_expr), "<teacher-tests>", "eval"), globals(), globals())');
		finalCode.push('            expected_value = eval(compile(ast.Expression(expected_expr), "<teacher-tests>", "eval"), globals(), globals())');
		finalCode.push('            is_match = actual_value == expected_value');
		finalCode.push('            print("✅ Passed test" if is_match else "❌ Failed test")');
		finalCode.push('            print("Test input:")');
		finalCode.push('            print("    " + actual_text)');
		finalCode.push('            print("Expected:")');
		finalCode.push('            print("    " + __format_teacher_value(expected_value))');
		finalCode.push('            print("Got:")');
		finalCode.push('            print("    " + __format_teacher_value(actual_value))');
		finalCode.push('            if not is_match:');
		finalCode.push('                __teacher_failures.append(assert_source)');
		finalCode.push('            return');
		finalCode.push('');
		finalCode.push('    try:');
		finalCode.push('        exec(assert_source, globals(), globals())');
		finalCode.push('        print("✅ Passed test")');
		finalCode.push('    except Exception:');
		finalCode.push('        print("❌ Failed test")');
		finalCode.push('        __teacher_failures.append(assert_source)');
		finalCode.push('');
		normalizedTeacherTests.split('\n').forEach((testLine) => {
			const trimmed = testLine.trim();
			const isTopLevelAssert = testLine === trimmed && trimmed.startsWith('assert ');
			const looksLikeMultiline = trimmed.endsWith('\\') || trimmed.endsWith('(');

			if (!isTopLevelAssert || looksLikeMultiline) {
				finalCode.push(testLine);
				return;
			}

			const escapedAssert = escapePythonSingleQuotedString(trimmed);
			finalCode.push(`__run_teacher_assert('${escapedAssert}')`);
		});
		finalCode.push('');
		finalCode.push('if __teacher_failures:');
		finalCode.push('    raise AssertionError("; ".join(__teacher_failures))');
		finalCode.push('print("ALL_TEACHER_TESTS_PASSED")');
	} else {
		finalCode.push('import doctest');
		finalCode.push('doctest.testmod(verbose=True)');
	}
	finalCode = finalCode.join('\n');

	return {
		status: 'success',
		header: 'Running tests...',
		code: finalCode,
		startLine: startLine,
	};
}

export function processTestResults(outputStr, customErrorRules = [], evalType = 'unit_test', expectedOutput = '', teacherTests = '') {
	if (evalType === 'stdout') {
		const actualOutput = outputStr.replace(/\r\n/g, '\n').trim();
		const expectedNorm = (expectedOutput || '').replace(/\r\n/g, '\n').trim();
		const testInput = (teacherTests || '').replace(/\r\n/g, '\n').trim();
		const testInputBlock = testInput ? `\n\nTest input:\n${testInput}` : '';
		if (actualOutput === expectedNorm) {
			return {
				status: 'pass',
				header: `Output matched expected output!`,
				details: `✅ Passed${testInputBlock}\n\nOutput:\n${actualOutput}`
			};
		} else {
			return {
				status: 'fail',
				header: `Output did not match expected output.`,
				details: `❌ Failed${testInputBlock}\n\nExpected:\n${expectedNorm}\n\nGot:\n${actualOutput}`
			};
		}
	}

	if (outputStr.includes('ALL_TEACHER_TESTS_PASSED')) {
		const teacherTestBlocks = extractTeacherTestBlocks(outputStr);
		const passedCount = teacherTestBlocks.filter((block) => block.startsWith('✅ Passed test')).length;

		return {
			status: 'pass',
			header: `${passedCount} of ${passedCount} tests passed`,
			details: teacherTestBlocks.length
				? teacherTestBlocks.join('\n\n')
				: 'All tests passed successfully.',
		};
	}

	const summaryRe = /(\d+)\spassed\sand\s(\d+)\sfailed./;
	const summaryMatches = outputStr.match(summaryRe);
	if (summaryMatches) {
		const successCount = parseInt(summaryMatches[1], 10);
		const failCount = parseInt(summaryMatches[2], 10);
		const totalCount = successCount + failCount;
		const passedExamples = extractPassedExamples(outputStr);
		const failedDetails = cleanupDoctestResults(outputStr);
		const passedDetails = passedExamples.length
			? passedExamples.map((example) => `✅ Passed test\n${example}`).join('\n\n')
			: '';
		const summaryLine = `Summary: ${successCount} passed, ${failCount} failed, ${totalCount} total.`;
		const doctestResults = [summaryLine, passedDetails, failedDetails]
			.filter(Boolean)
			.join('\n\n');
		return applyCustomErrorMessageRules({
			status: successCount == totalCount ? 'pass' : 'fail',
			header: `${successCount} of ${totalCount} tests passed`,
			details: doctestResults,
			messageSource: 'system',
		}, customErrorRules);
	}

	return applyCustomErrorMessageRules({
		status: 'fail',
		header: 'Unable to parse test results',
		details: outputStr || 'No test output received.',
		messageSource: 'system',
	}, customErrorRules);
}

export function processTestError(error, startLine, customErrorRules = []) {
	const message = error?.message || '';

	if (message.includes('Traceback')) {
		const teacherTestBlocks = extractTeacherTestBlocks(message);
		const passedCount = (message.match(/✅ Passed test/g) || []).length;
		const failedCount = (message.match(/❌ Failed test/g) || []).length;
		const lastErrorLine = message
			.split('\n')
			.map((line) => line.trim())
			.reverse()
			.find((line) => /^[A-Za-z_][A-Za-z0-9_]*(Error|Exception)(:|$)/.test(line));
		const errorTypeMatch = message.match(
			/^\s*([A-Za-z_][A-Za-z0-9_]*(?:Error|Exception))(?::|$)/m
		);
		const errorType = errorTypeMatch ? errorTypeMatch[1] : 'Runtime error';
		let errorDetails = extractError(message, startLine);
		let header = errorType;

		// Teacher test assertions run in injected module-level code, so mapped line numbers are misleading.
		if (errorType === 'AssertionError') {
			if (passedCount + failedCount > 0) {
				header = `${passedCount} of ${passedCount + failedCount} tests passed`;
			} else {
				header = 'Wrong answer';
			}

			if (failedCount > 0) {
				errorDetails = lastErrorLine || 'AssertionError';
			}
		}
		const details = [
			passedCount || failedCount
				? `Summary: ${passedCount} passed, ${failedCount} failed.`
				: '',
			teacherTestBlocks.length ? teacherTestBlocks.join('\n\n') : '',
			errorType === 'AssertionError' && teacherTestBlocks.length === 0
				? 'Your code is valid Python, but it does not satisfy all test assertions.'
				: '',
			teacherTestBlocks.length === 0 || errorType !== 'AssertionError'
				? errorDetails
				: '',
		]
			.filter(Boolean)
			.join('\n\n');

		return applyCustomErrorMessageRules({
			status: 'fail',
			header: header,
			details: details || message,
			messageSource: 'system',
		}, customErrorRules);
	} else if (message == 'Infinite loop') {
		return applyCustomErrorMessageRules({
			status: 'fail',
			header: 'Infinite loop',
			details:
				'Your code did not finish executing within 60 seconds. Please look to see if you accidentally coded an infinite loop.',
			messageSource: 'system',
		}, customErrorRules);
	}
	return applyCustomErrorMessageRules({
		status: 'fail',
		header: 'Unexpected error occurred',
		details: message || 'No error details were provided.',
		messageSource: 'system',
	}, customErrorRules);
}
