import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutFor } from './useLayoutMode.js'

test('viewport width picks the camera layout: phone overlay, tablet under, desktop side', () => {
  assert.equal(layoutFor(390), 'overlay')
  assert.equal(layoutFor(720), 'overlay')
  assert.equal(layoutFor(721), 'under')
  assert.equal(layoutFor(768), 'under')
  assert.equal(layoutFor(999), 'under')
  assert.equal(layoutFor(1000), 'side')
  assert.equal(layoutFor(1440), 'side')
})
