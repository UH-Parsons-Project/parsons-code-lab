import { isObserverModeEnabled } from './observer-mode.js';

const ADJECTIVES = [
	'Apple',
	'Blue',
	'Coral',
	'Golden',
	'Green',
	'Orange',
	'Purple',
	'Silver',
];

const ANIMALS = [
	'Badger',
	'Fox',
	'Horse',
	'Koala',
	'Penguin',
	'Rabbit',
	'Turtle',
	'Walrus',
];

function hashString(value) {
	let hash = 2166136261;

	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}

function getStudentId(student) {
	if (student && typeof student === 'object') {
		return student.student_id ?? student.id;
	}

	return student;
}

export function getAnonymousStudentName(student, taskSetId) {
	const studentId = getStudentId(student);
	const key = `${taskSetId ?? 'unknown-set'}:${studentId ?? 'unknown-student'}`;
	const hash = hashString(key);
	const adjective = ADJECTIVES[hash % ADJECTIVES.length];
	const animal = ANIMALS[Math.floor(hash / ADJECTIVES.length) % ANIMALS.length];

	return `${adjective} ${animal}`;
}

export function getStudentDisplayName(student, taskSetId) {
	if (!isObserverModeEnabled()) {
		return student?.username ?? student?.name ?? String(student ?? '');
	}

	return getAnonymousStudentName(student, taskSetId);
}
