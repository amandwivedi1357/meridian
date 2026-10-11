import { pages, type PageId } from "../../app/navigation.js";

export function NavigationRail({ view }: { view: PageId }) {
  return (
    <nav className="navigation-rail" aria-label="Primary">
      <span className="rail-brand brand-mark" aria-hidden="true">
        M
      </span>
      {pages.map(({ id, label, icon: Icon }) => (
        <a
          key={id}
          href={`#/${id}`}
          aria-label={label}
          aria-current={view === id ? "page" : undefined}
          className={view === id ? "active" : ""}
        >
          <Icon size={20} strokeWidth={1.7} />
          <span className="rail-tooltip">{label}</span>
        </a>
      ))}
    </nav>
  );
}
