# Database tables used in this project

This document gives a quick overview of the main database tables

## teachers
Stores teacher accounts used for authentication and ownership of created content.

- One row per teacher user.
- Contains login data (`username`, `password_hash`, `email`) and account status (`is_active`).
- Referenced by `parsons.created_by_teacher_id` and `task_lists.teacher_id`.

## parsons
Stores Parsons tasks/exercises.

- One row per task.
- Includes task metadata (`title`, `description`, `task_instructions`, `task_type`).
- Stores task structure and solution data in JSON (`code_blocks`, `correct_solution`).
- Linked to the teacher who created it (`created_by_teacher_id`).

## task_lists
Stores teacher-created collections of tasks that can be shared with students.

- One row per task list.
- Contains list title and shareable code (`unique_link_code`).
- Belongs to a teacher (`teacher_id`).
- Optional expiry time (`expires_at`).

## task_list_items
Join table between task lists and tasks.

- One row links one `task_list` to one `parsons` task.
- Enables many tasks in one list and reuse of a task in multiple lists.

## student_sessions
Tracks student entry/session context when solving shared task lists.

- One row per student session (`session_id` UUID).
- Optionally linked to a task list (`task_list_id`).
- Stores student nickname (`username`) and activity timestamps.

## task_attempts
Stores each student attempt for a specific task.

- One row per attempt.
- Linked to student session (`student_session_id`) and task (`task_id`).
- Tracks progress/result (`task_started_at`, `completed_at`, `success`).
- Stores submitted answer data in JSON (`submitted_order`, `submitted_inputs`).

## move_events
Stores interaction events during an attempt.

- One row per recorded move/event.
- Linked to a task attempt (`attempt_id`).
- Used for lightweight event-level analytics/timing (`event_time`).

