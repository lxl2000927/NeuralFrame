import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[][];
  disabled?: boolean;
}) {
  const items = options.some(([id]) => id === value)
    ? options
    : [[value, `${value}（当前配置）`], ...options];
  const selected = Math.max(
    0,
    items.findIndex(([id]) => id === value),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 280,
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const id = useId();
  const visible = open && !disabled;
  const choose = (index: number) => {
    const item = items[index];
    if (item && item[0] !== value) onChange(item[0]);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!visible || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const upward =
      below < Math.min(200, items.length * 36 + 10) && above > below;
    const maxHeight = Math.min(
      280,
      Math.max(40, upward ? above - 6 : below - 6),
    );
    const width = Math.min(Math.max(r.width, 180), innerWidth - 24);
    // Measure after setting width so wrapped version names anchor above correctly.
    if (popup.current) {
      popup.current.style.width = `${width}px`;
      popup.current.style.maxHeight = `${maxHeight}px`;
    }
    const height = Math.min(
      maxHeight,
      (popup.current?.scrollHeight || items.length * 36 + 8) + 2,
    );
    setPosition({
      left: Math.max(12, Math.min(r.left, innerWidth - width - 12)),
      top: upward ? r.top - height - 6 : r.bottom + 6,
      width,
      maxHeight,
    });
  }, [visible, items.length]);
  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const scrolled = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [visible]);
  useEffect(() => {
    if (visible)
      popup.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, visible]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  return (
    <>
      <button
        ref={trigger}
        className="select-trigger"
        role="combobox"
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={visible}
        aria-controls={visible ? id : undefined}
        aria-activedescendant={visible ? `${id}-${active}` : undefined}
        data-value={value}
        disabled={disabled}
        title={items[selected]?.[1]}
        onClick={() => {
          setActive(selected);
          setOpen(!open);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          const key = event.key;
          if (key === "Escape") {
            if (visible) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
            return;
          }
          if (key === "Tab") {
            setOpen(false);
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
            event.preventDefault();
            setActive(
              key === "Home"
                ? 0
                : key === "End"
                  ? items.length - 1
                  : !visible
                    ? selected
                    : (active + (key === "ArrowDown" ? 1 : -1) + items.length) %
                      items.length,
            );
            setOpen(true);
          } else if (key === "Enter" || key === " ") {
            event.preventDefault();
            if (visible) choose(active);
            else {
              setActive(selected);
              setOpen(true);
            }
          } else if (
            key.length === 1 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
          ) {
            const now = Date.now();
            search.current = {
              text:
                (now - search.current.at < 700 ? search.current.text : "") +
                key.toLowerCase(),
              at: now,
            };
            const index = items.findIndex(([, text]) =>
              text.toLowerCase().startsWith(search.current.text),
            );
            if (index >= 0) {
              event.preventDefault();
              setActive(index);
              setOpen(true);
            }
          }
        }}
      >
        <span>{items[selected]?.[1]}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {visible &&
        createPortal(
          <div
            ref={popup}
            className="select-popup"
            role="listbox"
            id={id}
            aria-label={label}
            style={position}
          >
            {items.map(([key, text], index) => (
              <div
                key={key}
                id={`${id}-${index}`}
                role="option"
                aria-selected={key === value}
                data-index={index}
                data-active={index === active}
                className="select-option"
                onPointerMove={() => setActive(index)}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{text}</span>
                {key === value && <Check size={15} aria-hidden="true" />}
              </div>
            ))}
          </div>,
          trigger.current?.closest("dialog") || document.body,
        )}
    </>
  );
}
