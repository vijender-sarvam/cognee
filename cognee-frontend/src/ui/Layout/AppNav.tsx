"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LINKS = [
  {
    href: "/ingest",
    label: "Ingest",
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
      </svg>
    ),
  },
  {
    href: "/search",
    label: "Search",
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    href: "/graph",
    label: "Graph",
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="5" cy="12" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="19" cy="19" r="2" />
        <path strokeLinecap="round" d="M7 12h10M17 7l-10 5M17 17L7 12" />
      </svg>
    ),
  },
  {
    href: "/search/debug",
    label: "Debug",
    icon: (
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <header className="h-13 min-h-13 bg-white border-b border-gray-100 flex items-center px-5 gap-6 shrink-0">
      {/* Logo */}
      <Link href="/ingest" className="flex items-center gap-2.5 mr-4 group">
        <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-700 transition-colors">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-gray-800">KB</span>
      </Link>

      {/* Page tabs */}
      <nav className="flex items-center gap-1">
        {NAV_LINKS.map(({ href, label, icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              }`}
            >
              <span className={active ? "text-indigo-600" : "text-gray-400"}>{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Right side — back to classic dashboard */}
      <div className="ml-auto">
        <Link href="/dashboard" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
          Classic dashboard →
        </Link>
      </div>
    </header>
  );
}
