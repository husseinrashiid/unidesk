import {
  useEffect,
  useRef,
  useId,
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { X, ArrowUpRight, MoreHorizontal } from "lucide-react";
export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return <button className={`button ${variant} ${className}`} {...props} />;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <Button variant="ghost" aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  let assigned = false;
  const associate = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (node) => {
      if (!isValidElement<{ id?: string; children?: ReactNode }>(node))
        return node;
      if (
        !assigned &&
        typeof node.type === "string" &&
        ["input", "select", "textarea"].includes(node.type)
      ) {
        assigned = true;
        return cloneElement(node, { id });
      }
      return node.props.children
        ? cloneElement(node, { children: associate(node.props.children) })
        : node;
    });
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {associate(children)}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="header-actions">{children}</div>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <p>{title}</p>
      {description && <span>{description}</span>}
      {action}
    </div>
  );
}
export function Section({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`section ${className}`}>
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function CourseDot({ color = "#87909e" }: { color?: string }) {
  return <span className="course-dot" style={{ background: color }} />;
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowUpRight size={13} />
    </button>
  );
}
export function Menu({
  label = "More actions",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <details
      className="menu"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          e.currentTarget.open = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.open = false;
      }}
    >
      <summary aria-label={label}>
        <MoreHorizontal size={17} />
      </summary>
      <div
        className="menu-panel"
        onClick={(e) => {
          e.currentTarget.closest("details")?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}
