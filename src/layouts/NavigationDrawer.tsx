import { useEffect, useRef, useState, type ReactNode } from "react";
const compactQuery =
  "(max-width: 900px), (max-width: 1200px) and (orientation: portrait)";
export function useCompactNavigation() {
  const [compact, setCompact] = useState(
    () => matchMedia(compactQuery).matches,
  );
  useEffect(() => {
    const media = matchMedia(compactQuery);
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}
export function NavigationDrawer({
  compact,
  open,
  onClose,
  children,
}: {
  compact: boolean;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!compact || !open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, [compact, open]);
  if (!compact) return <aside className="sidebar">{children}</aside>;
  return (
    <dialog
      ref={ref}
      className="navigation-drawer"
      aria-label="Navigation"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <aside className="sidebar">{children}</aside>
    </dialog>
  );
}
