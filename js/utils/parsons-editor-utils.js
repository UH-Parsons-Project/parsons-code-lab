export function buildReprFromBlocks(taskData) {
  const storedRepr = taskData.code_blocks?.parsons_repr;
  const modelAnswer = (taskData.model_answer || '').replace(/\r\n/g, '\n');
  const hasBlankPlaceholder = typeof storedRepr === 'string' && /!BLANK|___/.test(storedRepr);
  const hasBlankMarkers = typeof storedRepr === 'string' && /#blank/i.test(storedRepr);
  const hasModelAnswer = Boolean(modelAnswer.trim());
  if (typeof storedRepr === 'string' && storedRepr.trim() && (!hasBlankPlaceholder || hasBlankMarkers || !hasModelAnswer)) {
    return storedRepr.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  }

  const blocks = taskData.code_blocks?.blocks || [];
  const INDENT = '    ';
  const answerLines = modelAnswer.split('\n').map((line) => line.trimRight());
  let answerLineIndex = 0;

  return blocks.map((block) => {
    const codeWithBlanks = block.code.replace(/___/g, '!BLANK');
    const indentedCode = INDENT.repeat(block.indent) + block.code;
    let blankValues = '';

    const templateSegments = indentedCode.trim().split('___');
    const escapedSegments = templateSegments.map((segment) => segment.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
    const linePattern = new RegExp(`^${escapedSegments.join('(.*?)')}$`);
    let matchedAnswer = null;

    for (let index = answerLineIndex; index < answerLines.length; index += 1) {
      const match = answerLines[index].trim().match(linePattern);
      if (match) {
        matchedAnswer = match;
        answerLineIndex = index + 1;
        break;
      }
    }

    if (matchedAnswer && templateSegments.length > 1) {
      blankValues = matchedAnswer.slice(1)
        .map((value) => ` #blank${value}#`)
        .join('');
    }

    if (block.given) {
      return `${INDENT.repeat(block.indent)}${codeWithBlanks}${blankValues} #${block.indent}given #preplace`;
    }
    return `${INDENT.repeat(block.indent)}${codeWithBlanks}${blankValues}`;
  }).join('\n');
}

export function buildCustomRepr(parsonsWidget, normalizeSourceCode = (s) => s, getLineInputValues = null) {
  if (!parsonsWidget) {
    return '';
  }
  const allLines = Array.isArray(parsonsWidget.modified_lines) ? parsonsWidget.modified_lines : [];
  if (!allLines.length) {
    return '';
  }

  // Find solution and trash DOM elements if available
  let solutionElement = null;
  if (parsonsWidget.options?.sortableId) {
    solutionElement = typeof parsonsWidget.options.sortableId === 'string'
      ? document.getElementById(parsonsWidget.options.sortableId)
      : parsonsWidget.options.sortableId;
  }
  if (!solutionElement && typeof document !== 'undefined') {
    solutionElement = document.getElementById('solution-sortable');
  }

  let trashElement = null;
  if (parsonsWidget.options?.trashId) {
    trashElement = typeof parsonsWidget.options.trashId === 'string'
      ? document.getElementById(parsonsWidget.options.trashId)
      : parsonsWidget.options.trashId;
  }
  if (!trashElement && typeof document !== 'undefined') {
    trashElement = document.getElementById('source-sortable');
  }

  const solutionUl = solutionElement ? (solutionElement.tagName === 'UL' ? solutionElement : solutionElement.querySelector('ul')) : null;
  const trashUl = trashElement ? (trashElement.tagName === 'UL' ? trashElement : trashElement.querySelector('ul')) : null;

  const lineMap = new Map();
  allLines.forEach((l) => {
    if (l && l.id) {
      lineMap.set(l.id, l);
    }
  });

  const solutionLines = [];
  const distractorLines = [];
  const processedIds = new Set();

  if (solutionUl && solutionUl.children.length > 0) {
    Array.from(solutionUl.children).forEach((li) => {
      const line = lineMap.get(li.id);
      if (line) {
        solutionLines.push(line);
        processedIds.add(li.id);
      }
    });
  }

  if (trashUl && trashUl.children.length > 0) {
    Array.from(trashUl.children).forEach((li) => {
      const line = lineMap.get(li.id);
      if (line) {
        distractorLines.push(line);
        processedIds.add(li.id);
      }
    });
  }

  // Add any remaining lines that weren't found in either UL
  allLines.forEach((line) => {
    if (line && line.id && !processedIds.has(line.id)) {
      if (!solutionUl) {
        solutionLines.push(line);
      } else {
        distractorLines.push(line);
      }
      processedIds.add(line.id);
    }
  });

  const formattedSolution = solutionLines.map((line) => {
    const rawLineText = normalizeSourceCode(line.code || '');
    const lineText = typeof getLineInputValues === 'function'
      ? rawLineText.replace(/ ?#blank[^#]*#?/gi, '').trimEnd()
      : rawLineText.trimEnd();
    if (!lineText) {
      return '';
    }

    const indent = typeof line.indent === 'number' && line.indent >= 0 ? line.indent : 0;
    let reprLine = `${lineText} #${indent}given`;
    const blankValues = typeof getLineInputValues === 'function' ? getLineInputValues(line.id) : [];
    if (blankValues.length) {
      reprLine += blankValues
        .filter((value) => value !== '')
        .map((value) => ` #blank${value}#`)
        .join('');
    }
    if (line.studentGiven) {
      reprLine += ' #preplace';
    }
    return reprLine;
  }).filter(Boolean);

  const formattedDistractors = distractorLines.map((line) => {
    const rawLineText = normalizeSourceCode(line.code || '');
    const lineText = typeof getLineInputValues === 'function'
      ? rawLineText.replace(/ ?#blank[^#]*#?/gi, '').trimEnd()
      : rawLineText.trimEnd();
    if (!lineText) {
      return '';
    }
    return lineText;
  }).filter(Boolean);

  return [...formattedSolution, ...formattedDistractors].join('\n');
}

export function renderParsonsBoard(initialText, options) {
  const {
    sourceSortable,
    solutionSortable,
    ParsonsWidgetCtor,
    onSortableUpdate,
    injectDeleteButtons,
    injectGivenToggles,
    updateCounters
  } = options;

  if (!sourceSortable || !solutionSortable || !ParsonsWidgetCtor) {
    return null;
  }

  sourceSortable.innerHTML = '';
  solutionSortable.innerHTML = '';

  const parsonsWidget = new ParsonsWidgetCtor({
    sortableId: solutionSortable,
    trashId: sourceSortable,
    containment: sourceSortable.closest('.card-body'),
    trash_label: 'Drag from here',
    solution_label: 'Solution &mdash; drag blocks here, double click to pin',
    can_indent: options.can_indent !== undefined ? options.can_indent : true,
    onSortableUpdate: () => {
      if (onSortableUpdate) {
        onSortableUpdate();
      }
    },
  });

  parsonsWidget.id_prefix = options.idPrefix || parsonsWidget.id_prefix;
  parsonsWidget.init(initialText);

  const initialSolutionLines = options.useStudentGiven ? parsonsWidget.studentGiven : parsonsWidget.given;
  const solutionIds = initialSolutionLines.map((line) => line.id);
  const solutionSet = new Set(solutionIds);
  const sourceIds = parsonsWidget.modified_lines
    .filter((line) => !solutionSet.has(line.id))
    .map((line) => line.id);

  parsonsWidget.createHTMLFromLists(solutionIds, sourceIds);
  parsonsWidget.setLineNumbers();
  
  if (injectDeleteButtons) {
    injectDeleteButtons(sourceSortable);
    injectDeleteButtons(solutionSortable);
  }
  if (injectGivenToggles) {
    injectGivenToggles(solutionSortable);
  }
  if (updateCounters) {
    updateCounters();
  }
  
  return parsonsWidget;
}

export function parseCustomErrorRules(rawRules) {
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
