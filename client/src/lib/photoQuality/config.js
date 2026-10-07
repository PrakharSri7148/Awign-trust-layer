// Thresholds and block/flag policy. The numbers live in thresholds.json so the
// backend recheck (backend/photo_quality) reads exactly the same values.
// They are starting values, tuned so far on synthetic degradations of a few real
// photos; re-tune against real worker photos with `npm run calibrate`
// (see edge-validator/samples/README.md).
//
// POLICY.blockOnFail: a `fail` stops the submission. Otherwise a `fail` is only a
// flag the worker may override ("Submit anyway").
// TASKS: per-task requirements. face: 'off' | 'optional' | 'required'; camera:
// which camera the file input asks for. Unknown tasks get DEFAULT_TASK.
import raw from './thresholds.json' with { type: 'json' }

export const THRESHOLDS = raw.thresholds
export const POLICY = raw.policy
export const DEFAULT_TASK = raw.default_task
export const TASKS = raw.tasks

export const taskConfig = (taskId) => ({ ...DEFAULT_TASK, ...(TASKS[taskId] ?? {}) })
