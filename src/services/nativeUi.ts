import { capabilities } from './platform';

export async function watchFileDrop(onDrop: (paths: string[]) => void) {
  if (!capabilities.nativeDragDrop) return () => {};
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  return getCurrentWebview().onDragDropEvent(event => {
    if (event.payload.type === 'drop') onDrop(event.payload.paths);
  });
}

export async function setNativeZoom(scale: number): Promise<boolean> {
  if (!capabilities.webviewZoom) return false;
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  await getCurrentWebview().setZoom(scale);
  return true;
}
