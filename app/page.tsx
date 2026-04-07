import Link from "next/link";
import { Camera, Scale, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const steps = [
  {
    icon: Camera,
    title: "Vous envoyez des photos nettes",
    description:
      "Trois angles suffisent pour un premier contrôle visuel clair.",
  },
  {
    icon: Scale,
    title: "Nous vous indiquons une fourchette réaliste",
    description:
      "Basée sur l’occasion récente, sans promesse irréaliste.",
  },
  {
    icon: ShieldCheck,
    title: "Nous gérons la revente jusqu’à l’encaissement",
    description:
      "Annonce, échanges avec les acheteurs et cadre de la transaction.",
  },
] as const;

export default function HomePage() {
  return (
    <div>
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-8 sm:py-20 md:py-24 lg:px-10 lg:py-28">
        <section className="grid items-center gap-16 lg:grid-cols-2 lg:gap-20 xl:gap-24">
          <div className="max-w-xl">
            <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl lg:text-[2.375rem] lg:leading-[1.12]">
              Revendez votre équipement d’occasion avec une équipe qui vérifie
              et explique.
            </h1>
            <p className="mt-6 text-pretty text-base leading-relaxed text-slate-600 sm:text-lg sm:leading-relaxed">
              Inspection, transparence sur l’état et les prix, engagements
              lisibles — sans surcharge.
            </p>
            <div className="mt-10">
              <Link
                href="/estimer"
                prefetch={false}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "inline-flex min-h-11 items-center justify-center rounded-lg px-8 text-base font-semibold shadow-sm",
                  "bg-primary text-primary-foreground hover:bg-blue-700"
                )}
              >
                Obtenir une estimation
              </Link>
            </div>

            <p className="mt-10 flex flex-wrap items-start gap-2.5 text-sm leading-relaxed text-slate-600">
              <ShieldCheck
                className="mt-0.5 size-4 shrink-0 opacity-70"
                strokeWidth={1.75}
                aria-hidden
              />
              <span>
                Paiement sécurisé · Matériel inspecté · Retours acceptés
              </span>
            </p>

            <p className="mt-6">
              <a
                href="#comment-ca-marche"
                className="text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
              >
                Comment ça marche
              </a>
            </p>
          </div>

          {/* Placeholder visuel large — à remplacer par photo détourée */}
          <div
            className="min-h-[16rem] w-full rounded-2xl bg-slate-200/70 sm:min-h-[20rem] lg:min-h-[26rem] xl:min-h-[28rem]"
            aria-hidden
          />
        </section>

        <section
          id="comment-ca-marche"
          className="mx-auto mt-24 max-w-5xl scroll-mt-24 sm:mt-28 md:mt-32"
        >
          <div className="text-center">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Comment ça marche
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-slate-600 sm:text-base">
              Trois étapes, le même protocole pour tous.
            </p>
          </div>

          <div className="mt-12 grid gap-8 sm:grid-cols-3 sm:gap-10 lg:gap-12">
            {steps.map((step) => {
              const Icon = step.icon;
              return (
                <Card key={step.title} className="h-full border-0 shadow-sm">
                  <CardHeader className="px-6 pb-2 pt-8 sm:px-8 sm:pt-10">
                    <Icon
                      className="size-7 text-slate-400"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <CardTitle className="mt-5 text-base font-semibold leading-snug text-slate-900 sm:text-lg">
                      {step.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 pb-8 pt-0 sm:px-8 sm:pb-10">
                    <CardDescription className="text-sm leading-relaxed text-slate-600">
                      {step.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <footer className="mx-auto mt-24 max-w-6xl border-t border-slate-200 pt-10 text-sm text-slate-600 sm:mt-28 sm:flex sm:items-center sm:justify-between">
          <p className="font-medium text-slate-700">
            © {new Date().getFullYear()} Re-Ride
          </p>
          <p className="mt-4 sm:mt-0">
            <a
              href="mailto:contact@re-ride.fr"
              className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-4 hover:text-primary"
            >
              contact@re-ride.fr
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
