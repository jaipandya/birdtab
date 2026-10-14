/**
 * Credit names and dates as the new tab shows them. Release data has carried
 * Commons placeholders and free-text dates that rendered as "Invalid Date".
 */

import { cleanCreditName, formatCreditDate } from '../utils/credits.js';
import { adaptSpeciesToBirdInfo } from '../mediaClient.js';

describe('formatCreditDate', () => {
  test.each([
    ['2007-05-23', 'May 23, 2007'],
    ['2007-05-23 12:33:14', 'May 23, 2007'],
    ['2021-10-01T10:42:59Z', 'Oct 1, 2021'],
    ['2023-06-25T09:22:44+02:00', 'Jun 25, 2023'],
  ])('%s -> %s', (input, expected) => {
    expect(formatCreditDate(input)).toBe(expected);
  });

  test.each([
    '2005-07-00',
    '0000-00-00',
    '0202-07-01',
    '2005-02-30',
    '2007-05',
    '2021',
    '23 May 2007 (original upload date)',
    'Unknown date',
    'None-None-None',
    'NA',
    '',
    null,
    undefined,
  ])('%p -> empty, never "Invalid Date"', (input) => {
    expect(formatCreditDate(input)).toBe('');
  });
});

describe('cleanCreditName', () => {
  test('unwraps the Commons "no machine-readable author" placeholder', () => {
    expect(cleanCreditName('No machine-readable author provided. Mdf assumed (based on copyright claims).')).toBe('Mdf');
    expect(
      cleanCreditName('No machine-readable author provided. Joelr31~commonswiki assumed (based on copyright claims).'),
    ).toBe('Joelr31');
  });

  test('leaves real names alone', () => {
    expect(cleanCreditName('Giles Laurent')).toBe('Giles Laurent');
    expect(cleanCreditName(null)).toBeNull();
    expect(cleanCreditName(undefined)).toBeUndefined();
  });

  test('applies to photo and audio credits from a manifest entry', () => {
    const placeholder = 'No machine-readable author provided. Mdf assumed (based on copyright claims).';
    const bird = adaptSpeciesToBirdInfo({
      speciesCode: 'comter',
      primaryComName: 'Common Tern',
      image: { creatorName: placeholder },
      audio: { creatorName: placeholder },
    });
    expect(bird.photographer).toBe('Mdf');
    expect(bird.recordist).toBe('Mdf');
  });
});
