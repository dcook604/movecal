import { describe, expect, it } from 'vitest';
import { escapeHtml, safeEqual, sha256Hex } from '../src/utils/security.js';
import { bookingDetailsHtml } from '../src/services/emailService.js';

describe('security helpers', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('compares secrets safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', undefined)).toBe(false);
  });
  it('hashes tokens deterministically', () => {
    expect(sha256Hex('a')).toBe(sha256Hex('a'));
    expect(sha256Hex('a')).toHaveLength(64);
  });
  it('escapes resident-supplied fields in booking emails', () => {
    const html = bookingDetailsHtml({
      id: '1', residentName: '<img src=x onerror=alert(1)>', residentEmail: 'a@b.ca', residentPhone: '1',
      unit: '<b>1</b>', moveType: 'MOVE_IN', startDatetime: new Date(), endDatetime: new Date(),
      elevatorRequired: false, loadingBayRequired: false, notes: '<a href="http://evil">click</a>'
    }, true);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a href="http://evil"');
    expect(html).toContain('&lt;img');
  });
});
