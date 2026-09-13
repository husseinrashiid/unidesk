import { useEffect } from "react";
import { setNativeZoom } from "../services/nativeUi";
import { desktop } from "../services/platform";
import { saveSetting } from "../db/repository";
import { useWorkspace } from "./useWorkspace";

export const interfaceScales = [100, 110, 125, 150, 175, 200];
// CSS screen dimensions already account for Windows display scaling.
export function resolveInterfaceScale(
  value: string | undefined,
  screenWidth: number,
) {
  if (value && interfaceScales.includes(Number(value))) return Number(value);
  return screenWidth >= 2400 ? 150 : screenWidth >= 1900 ? 125 : 100;
}

export function useInterfaceScale() {
  const { preferences, loading, refresh, report } = useWorkspace();
  useEffect(() => {
    if (loading) return;
    const scale = resolveInterfaceScale(
      preferences.interface_scale,
      window.screen.width,
    );
    const fallback = () => {
      document.documentElement.style.zoom = String(scale / 100);
      document.documentElement.style.setProperty('--viewport-width', `${window.innerWidth / (scale / 100)}px`);
      document.documentElement.style.setProperty(
        "--viewport-height",
        `${(window.visualViewport?.height ?? window.innerHeight) / (scale / 100)}px`,
      );
    };
    let disposed = false;
    if (desktop) {
      void setNativeZoom(scale / 100)
        .catch(() => {
          if (!disposed) fallback();
        });
    } else fallback();
    const resize = () => {
      if (!desktop || document.documentElement.style.zoom) fallback();
    };
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    let saving = false;
    const keyboard = async (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        !["+", "=", "-", "0"].includes(event.key)
      )
        return;
      event.preventDefault();
      if (saving) return;
      const next =
        event.key === "0"
          ? "100"
          : String(
              event.key === "-"
                ? ([...interfaceScales].reverse().find((n) => n < scale) ?? 100)
                : (interfaceScales.find((n) => n > scale) ?? 200),
            );
      saving = true;
      try {
        await saveSetting("interface_scale", next);
        await refresh();
      } catch {
        report("Could not save display size. Try again in Settings.");
      } finally {
        saving = false;
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyboard);
    };
  }, [preferences.interface_scale, loading]);
}
