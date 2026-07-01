import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/content/main'

describe('smoke', () => {
  it('exposes version and has a DOM (jsdom)', () => {
    expect(VERSION).toBe('0.1.0')
    document.body.innerHTML = '<div id="x"></div>'
    expect(document.getElementById('x')).not.toBeNull()
  })
})
