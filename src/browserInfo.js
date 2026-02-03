export const IS_EDGE = process.env.BROWSER === 'edge';

export function getNewTabUrl() {
  if (IS_EDGE) {
    return 'https://ntp.msn.com/edge/ntp';
  }
  return 'chrome://new-tab-page';
}

export function isBrowserNewTabUrl(url) {
  if (!url) return false;

  if (IS_EDGE) {
    return (
      url === 'https://ntp.msn.com/edge/ntp' ||
      url === 'https://ntp.msn.com/edge/ntp/' ||
      url === 'edge://newtab/' ||
      url === 'edge://new-tab-page/' ||
      url === 'chrome://newtab/'
    );
  }

  return url === 'chrome://newtab/';
}
