import { isObserverModeEnabled } from './observer-mode.js';

const ADJECTIVES = [
    'Apple', 'Amber', 'Azure', 'Blue', 'Brave', 'Bright', 'Calm',
    'Cloudy', 'Coral', 'Cosmic', 'Crimson', 'Crystal', 'Cunning',
    'Daring', 'Emerald', 'Fancy', 'Fierce', 'Flying', 'Forest',
    'Frozen', 'Gentle', 'Golden', 'Grand', 'Green', 'Happy',
    'Hidden', 'Icy', 'Iron', 'Jolly', 'Lucky', 'Magic', 'Mighty',
    'Misty', 'Moonlit', 'Mystic', 'Noble', 'Orange', 'Peaceful',
    'Pink', 'Playful', 'Polar', 'Proud', 'Purple', 'Quick',
    'Quiet', 'Radiant', 'Rapid', 'Red', 'Royal', 'Shiny',
    'Silver', 'Silent', 'Smart', 'Snowy', 'Solar', 'Sparkling',
    'Speedy', 'Stellar', 'Stormy', 'Strong', 'Sunny', 'Swift',
    'Thunder', 'Tiny', 'Valiant', 'Velvet', 'Vivid', 'Wild',
    'Wise', 'Yellow', 'Young', 'Zealous'
];

const ANIMALS = [
	'Antelope', 'Armadillo', 'Baboon', 'Bat', 'Boar', 'Bobcat',
	'Canary', 'Chameleon', 'Cobra', 'Crane', 'Donkey', 'Elk',
	'Flamingo', 'Gecko', 'Gorilla', 'Hamster', 'Heron', 'Iguana',
	'Jackal', 'Kingfisher', 'Lemur', 'Lizard', 'Marmot', 'Meerkat',
	'Narwhal', 'Opossum', 'Orca', 'Peacock', 'Pelican', 'Pigeon',
	'Platypus', 'Quail', 'Reindeer', 'Rhino', 'Salamander',
	'Scorpion', 'Seahorse', 'Tapir', 'Vulture', 'Warthog', 'Yak',
    'Badger', 'Bear', 'Beaver', 'Bison',
    'Buffalo', 'Camel', 'Cat', 'Cheetah', 'Cougar', 'Coyote',
	'Crow', 'Deer', 'Dolphin', 'Duck', 'Eagle',
    'Falcon', 'Ferret', 'Fox', 'Frog', 'Gazelle', 'Giraffe', 'Goose', 'Hawk', 'Hedgehog', 'Hippo',
    'Horse', 'Hyena', 'Jaguar', 'Kangaroo', 'Koala', 'Leopard', 'Lion', 'Lynx', 'Mole', 'Moose',
    'Octopus', 'Otter', 'Owl', 'Panda', 'Panther', 'Parrot', 'Penguin', 'Porcupine', 'Puma', 'Rabbit',
	'Raccoon', 'Raven', 'Seal', 'Shark', 'Skunk', 'Sloth', 'Sparrow', 'Squirrel', 'Swan', 'Tiger',
    'Toucan', 'Turtle','Walrus', 'Weasel', 'Whale', 'Wolf', 'Wombat', 'Woodpecker', 'Yak', 'Zebra'
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
