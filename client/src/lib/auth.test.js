import { test } from 'node:test'
import assert from 'node:assert/strict'

// sessionStorage does not exist in Node: the helpers must degrade to "no token" instead of throwing.
import { authHeaders, getToken, setToken, withToken } from './auth.js'

test('without storage the helpers degrade to no token and never throw', () => {
  assert.equal(getToken(), '')
  setToken('x') // swallowed
  assert.deepEqual(authHeaders({ A: '1' }), { A: '1' })
  assert.equal(withToken('/p/1'), '/p/1')
})

test('with a token: a bearer header and a ?token= for images', () => {
  const store = {}
  globalThis.sessionStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v }, removeItem: (k) => { delete store[k] } }
  try {
    setToken('s e/c')
    assert.deepEqual(authHeaders({ A: '1' }), { A: '1', Authorization: 'Bearer s e/c' })
    assert.equal(withToken('/p/1'), '/p/1?token=s%20e%2Fc')
    assert.equal(withToken('/p/1?x=2'), '/p/1?x=2&token=s%20e%2Fc')
    setToken('')
    assert.equal(getToken(), '')
  } finally {
    delete globalThis.sessionStorage
  }
})
