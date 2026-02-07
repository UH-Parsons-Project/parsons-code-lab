CREATE TABLE teachers (
	id SERIAL PRIMARY KEY,
	username VARCHAR(100) NOT NULL,
	password_hash VARCHAR(255) NOT NULL,
	email VARCHAR(100) UNIQUE NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE parsons (
	id SERIAL PRIMARY KEY,
	created_by_teacher_id INTEGER,
	title VARCHAR(255) NOT NULL,
	description TEXT,
	task_type VARCHAR(255),
	code_blocks TEXT,
	correct_answer TEXT,
	created_at TIMESTAMP
);

CREATE TABLE task_lists (
	id SERIAL PRIMARY KEY,
	teacher_id INTEGER NOT NULL REFERENCES teachers(id),
	title VARCHAR(255) NOT NULL,
	unique_link_code VARCHAR(50),
	created_at TIMESTAMP,
	expires_at TIMESTAMP
);

CREATE INDEX idx_task_lists_teacher_id ON task_lists(teacher_id);
CREATE TABLE task_list_items (
	id SERIAL PRIMARY KEY,
	task_list_id INTEGER,
	task_id INTEGER,
	order_position INTEGER
);

CREATE TABLE student_sessions (
	id SERIAL PRIMARY KEY,
	session_id UUID NOT NULL,
	task_list_id INTEGER,
	username VARCHAR(20),
	started_at TIMESTAMP,
	last_activity_at TIMESTAMP
);

CREATE TABLE task_attempts (
	id SERIAL PRIMARY KEY,
	student_session_id INTEGER,
	task_id INTEGER,
	task_started_at TIMESTAMP,
	completed_at TIMESTAMP,
	success BOOLEAN,
	submitted_order JSONB,
	submitted_inputs JSONB
);

CREATE TABLE move_events (
	id SERIAL PRIMARY KEY,
	attempt_id INTEGER,
	event_time TIMESTAMP
);