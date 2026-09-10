export type DeviceOS = 'windows' | 'android' | 'browser' | 'other';
export function capabilitiesFor(os: DeviceOS) {
  return Object.freeze({
    native: os !== 'browser',
    chooseDirectory: os === 'windows',
    nativeFilePicker: os === 'windows' || os === 'android',
    revealFile: os === 'windows',
    recycleBin: os === 'windows',
    nativeDragDrop: os === 'windows',
    webviewZoom: os === 'windows',
    notifications: os === 'windows' || os === 'android',
    secureStorage: os === 'windows' || os === 'android',
    shareFile: os === 'android',
    discoverFiles: os === 'windows' || os === 'browser',
  });
}
