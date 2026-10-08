import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PERMISSIONS, patchActivity, patchManifest } from './apk.mjs'

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="x"></application>
    <!-- Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`

test('the manifest gets every missing permission once, and a second run changes nothing', () => {
  const a = patchManifest(MANIFEST)
  assert.deepEqual(a.added, PERMISSIONS.filter((p) => p !== 'android.permission.INTERNET'))
  for (const p of PERMISSIONS) assert.equal(a.xml.split(`"${p}"`).length - 1, 1, p)
  assert.ok(a.xml.trim().endsWith('</manifest>'))
  const b = patchManifest(a.xml)
  assert.deepEqual(b.added, [])
  assert.equal(b.xml, a.xml)
})

test('MainActivity gets the keep-screen-on flag once; custom activities are left alone with a note', () => {
  const src = 'package com.trustlayer.demo;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n'
  const a = patchActivity(src)
  assert.equal(a.changed, true)
  assert.match(a.src, /FLAG_KEEP_SCREEN_ON/)
  assert.match(a.src, /super\.onCreate\(savedInstanceState\)/)
  assert.equal(patchActivity(a.src).changed, false)
  const custom = patchActivity('public class MainActivity extends BridgeActivity { void x() {} }')
  assert.equal(custom.changed, false)
  assert.match(custom.reason, /by hand/)
})
