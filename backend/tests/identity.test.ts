import { describe, expect, it } from 'vitest';
import { classifyLink, classifyQuery, normalizeEmail, normalizePhone, normalizeUnit, IdentityRow } from '../src/utils/identity.js';

const none = { emails: new Set<string>(), phones: new Set<string>() };
const row = (o: Partial<IdentityRow>): IdentityRow => ({
  id: 'x', unitNorm: '101', residentName: 'Jane Doe', residentEmailNorm: null, residentPhoneNorm: null, ...o,
});

describe('normalizers', () => {
  it('normalizes phone formats to the same digits', () => {
    for (const p of ['+1 (416) 555-1234', '416.555.1234', '1-416-555-1234', '416 555 1234']) expect(normalizePhone(p)).toBe('4165551234');
  });
  it('rejects too-short phones and non-emails', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeEmail('  Bob@Example.COM ')).toBe('bob@example.com');
  });
  it('normalizes unit variants', () => {
    expect(['PH 3', 'PH-3', 'ph3'].map(normalizeUnit)).toEqual(['PH3', 'PH3', 'PH3']);
  });
});

describe('classifyQuery', () => {
  it.each([
    ['a@b.com', 'email'], ['416-555-1234', 'phone'], ['(416) 555 1234', 'phone'],
    ['1204', 'unit'], ['PH-3', 'unit'], ['2-1204', 'unit'], ['Bob Smith', 'name'], ['smith', 'name'],
  ])('%s -> %s', (q, kind) => expect(classifyQuery(q)).toBe(kind));
});

describe('classifyLink', () => {
  it('links same email in different units as strong', () => {
    const l = classifyLink(row({ residentEmailNorm: 'a@b.com' }), row({ unitNorm: '202', residentEmailNorm: 'a@b.com' }), none);
    expect(l).toEqual({ via: ['email'], strength: 'strong' });
  });
  it('never links within the same unit', () => {
    expect(classifyLink(row({ residentPhoneNorm: '4165551234' }), row({ residentPhoneNorm: '4165551234' }), none)).toBeNull();
  });
  it('treats full-name-only match as weak, single names as no match', () => {
    expect(classifyLink(row({}), row({ unitNorm: '202', residentName: 'jane  DOE' }), none)?.strength).toBe('weak');
    expect(classifyLink(row({ residentName: 'Jane' }), row({ unitNorm: '202', residentName: 'Jane' }), none)).toBeNull();
  });
  it('ignores shared contacts', () => {
    const ignored = { emails: new Set(['mover@x.com']), phones: new Set<string>() };
    const a = row({ residentName: 'A One', residentEmailNorm: 'mover@x.com' });
    const b = row({ unitNorm: '202', residentName: 'B Two', residentEmailNorm: 'mover@x.com' });
    expect(classifyLink(a, b, ignored)).toBeNull();
  });
});
