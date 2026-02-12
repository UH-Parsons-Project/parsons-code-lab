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
	created_by_teacher_id INTEGER NOT NULL REFERENCES teachers(id),
	title VARCHAR(255) NOT NULL,
	description TEXT NOT NULL,
	task_type VARCHAR(50) NOT NULL,
	code_blocks JSONB NOT NULL,
	correct_solution JSONB NOT NULL,
	is_public BOOLEAN DEFAULT TRUE,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_parsons_created_by ON parsons(created_by_teacher_id);
CREATE INDEX idx_parsons_task_type ON parsons(task_type);
CREATE INDEX idx_parsons_is_public ON parsons(is_public);

CREATE TABLE task_lists (
	id SERIAL PRIMARY KEY,
	teacher_id INTEGER NOT NULL REFERENCES teachers(id),
	title VARCHAR(255) NOT NULL,
	unique_link_code VARCHAR(50) NOT NULL UNIQUE,
	created_at TIMESTAMP,
	expires_at TIMESTAMP
);

CREATE INDEX idx_task_lists_teacher_id ON task_lists(teacher_id);

CREATE TABLE task_list_items (
	id SERIAL PRIMARY KEY,
	task_list_id INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
	task_id INTEGER NOT NULL REFERENCES parsons(id) ON DELETE CASCADE,
	order_position INTEGER NOT NULL
);

CREATE INDEX idx_task_list_items_task_list ON task_list_items(task_list_id);
CREATE INDEX idx_task_list_items_task ON task_list_items(task_id);

CREATE TABLE student_sessions (
	id SERIAL PRIMARY KEY,
	session_id UUID NOT NULL UNIQUE,
	task_list_id INTEGER NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
	username VARCHAR(20) NOT NULL,
	started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_student_sessions_task_list ON student_sessions(task_list_id);
CREATE INDEX idx_student_sessions_session_id ON student_sessions(session_id);

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

CREATE INDEX idx_task_attempts_student_session ON task_attempts(student_session_id);
CREATE INDEX idx_task_attempts_task ON task_attempts(task_id);

CREATE TABLE move_events (
	id SERIAL PRIMARY KEY,
	attempt_id INTEGER NOT NULL REFERENCES task_attempts(id) ON DELETE CASCADE,
	event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_move_events_attempt ON move_events(attempt_id);
