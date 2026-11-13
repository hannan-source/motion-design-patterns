// Workflows: triggers, conditions, steps, placeholders, caps, photo flows and the AI read route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_ENTITIES } from '../shared/flows.js';

test('the workflows pack brings its lists', () => {
  assert.ok(Array.isArray(FLOW_ENTITIES));
});
