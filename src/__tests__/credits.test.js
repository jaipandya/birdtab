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
    ['2022-03', 'Mar 2022'],
    ['2021', '2021'],
  ])('%s -> %s', (input, expected) => {
    expect(formatCreditDate(input)).toBe(expected);
  });

  test.each([
    '2005-07-00',
    '0000-00-00',
    '0202-07',
    '2007-13',
    '20211',
    '0202-07-01',
    '2005-02-30',
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

describe('partial credit dates', () => {
  test('a month- or year-only date from the release is shown when there is no full date', () => {
    const bird = adaptSpeciesToBirdInfo({
      speciesCode: 'blakit1',
      primaryComName: 'Black Kite',
      image: { capturedAt: null, capturedAtApprox: '2021' },
      audio: { recordedAt: null, recordedAtApprox: '2022-03' },
    });
    expect(formatCreditDate(bird.audioDate)).toBe('Mar 2022');
    expect(formatCreditDate(bird.imageDate)).toBe('2021');
  });

  test('a full date wins over the partial one', () => {
    const bird = adaptSpeciesToBirdInfo({
      speciesCode: 'x',
      primaryComName: 'X',
      image: {},
      audio: { recordedAt: '2022-03-05', recordedAtApprox: '2022-03' },
    });
    expect(bird.audioDate).toBe('2022-03-05');
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
