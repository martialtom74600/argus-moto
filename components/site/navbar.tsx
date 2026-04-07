import Link from "next/link";
import { uiBtnNav } from "@/lib/ui/site-ui";
import { cn } from "@/lib/utils";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6 sm:h-[4.25rem] sm:px-8">
        <Link
          href="/"
          className="text-[1.0625rem] font-semibold tracking-tight text-slate-900 transition-colors duration-200 hover:text-emerald-800"
        >
          Re-Ride
        </Link>
        <Link href="/estimer" prefetch={false} className={cn(uiBtnNav, "no-underline")}>
          Estimer
        </Link>
      </div>
    </header>
  );
}
