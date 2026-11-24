export function moveMenuFocus(panel: HTMLElement | null, key: string) {
  if (!panel) return false;
  const items = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:enabled"));
  if (!items.length) return false;
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  switch (key) {
    case "Home": next = 0; break;
    case "End": next = items.length - 1; break;
    case "ArrowDown": next = (index + 1) % items.length; break;
    case "ArrowUp": next = index <= 0 ? items.length - 1 : index - 1; break;
    default: return false;
  }
  items[next].focus();
  return true;
}
