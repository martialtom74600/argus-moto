import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-6 sm:h-[4.25rem] sm:px-8">
        <Link
          href="/"
          className="text-[1.0625rem] font-semibold tracking-tight text-slate-900 hover:text-primary"
        >
          Re-Ride
        </Link>
        <Link
          href="/estimer"
          prefetch={false}
          className={cn(
            buttonVariants({ size: "sm" }),
            "h-10 min-h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold sm:min-h-10",
            "bg-primary text-primary-foreground shadow-sm hover:bg-blue-700"
          )}
        >
          Estimer
        </Link>
      </div>
    </header>
  );
}
