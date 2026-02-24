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
	session_id UUID NOT NULL,
	task_list_id INTEGER,
	username VARCHAR(20),
	started_at TIMESTAMP,
	last_activity_at TIMESTAMP
);