CREATE TABLE teachers (
	id SERIAL PRIMARY KEY,
	username VARCHAR(100) UNIQUE NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	email VARCHAR(100) UNIQUE NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE parsons (
	id SERIAL PRIMARY KEY,
	created_by_teacher_id INTEGER,
	title VARCHAR(255) NOT NULL,
	task_instructions TEXT,
	description TEXT,
	task_type VARCHAR(255),
	code_blocks TEXT,
	correct_answer TEXT,
	created_at TIMESTAMP
);

CREATE TABLE task_lists (
	id SERIAL PRIMARY KEY,
	teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
	title VARCHAR(255) NOT NULL,
	unique_link_code VARCHAR(50) NOT NULL UNIQUE,
	created_at TIMESTAMP,
	expires_at TIMESTAMP
);

CREATE TABLE task_list_items (
	id SERIAL PRIMARY KEY,
	task_list_id INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
	task_id INTEGER NOT NULL REFERENCES parsons(id) ON DELETE CASCADE
);

CREATE TABLE student_sessions (
	id SERIAL PRIMARY KEY,
	session_id UUID NOT NULL UNIQUE,
	task_list_id INTEGER REFERENCES task_lists(id) ON DELETE SET NULL,
	username VARCHAR(20),
	started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE task_attempts (
	id SERIAL PRIMARY KEY,
	student_session_id INTEGER NOT NULL REFERENCES student_sessions(id) ON DELETE CASCADE,
	task_id INTEGER NOT NULL REFERENCES parsons(id) ON DELETE CASCADE,
	task_started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	completed_at TIMESTAMP,
	success BOOLEAN,
	submitted_order JSONB,
	submitted_inputs JSONB
);

CREATE TABLE move_events (
	id SERIAL PRIMARY KEY,
	attempt_id INTEGER NOT NULL REFERENCES task_attempts(id) ON DELETE CASCADE,
	event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);