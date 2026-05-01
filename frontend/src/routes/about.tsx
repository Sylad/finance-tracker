import { ExternalLink, Sparkles, Code2, Palette, Server } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { BrandMark } from '@/components/brand-mark';

const STACK = [
  { group: 'Frontend', icon: Palette, items: [
    'React 18 + TypeScript 5',
    'Vite 5 (dev server + build)',
    'Tailwind CSS 3 + tokens custom',
    'TanStack Router (code-based)',
    'TanStack Query (cache & mutations)',
    'Recharts (visualisations)',
    'Lucide (icônes)',
  ]},
  { group: 'Backend', icon: Server, items: [
    'NestJS 10 + TypeScript 5',
    'Stockage JSON local (pas de DB)',
    'Anthropic SDK (claude-sonnet-4-6)',
    'Multer (upload PDF)',
    'PDF parsing pipeline two-phase',
    'Server-Sent Events (live updates)',
  ]},
  { group: 'Infra', icon: Code2, items: [
    'Docker multi-stage (node:20-alpine → nginx:alpine)',
    'docker-compose Synology NAS',
    'PIN guard (Bearer token simple)',
    'Volumes persistants /volume2/docker',
  ]},
];

const INSPIRATIONS = [
  {
    name: 'refactoringui.com',
    by: 'Adam Wathan & Steve Schoger',
    why: 'Le bouquin de chevet pour les non-designers : grille, contraste, hiérarchie, espacement.',
    url: 'https://refactoringui.com/',
  },
  {
    name: 'lawsofux.com',
    by: 'Jon Yablonski',
    why: 'Les principes UX cités à chaque revue : Hick, Fitts, Miller, Postel, etc.',
    url: 'https://lawsofux.com/',
  },
  {
    name: 'Stripe Dashboard',
    by: 'Stripe',
    why: 'Référence absolue de la fintech UI : tabular nums, hiérarchie sobre, glassmorphism léger.',
    url: 'https://stripe.com',
  },
  {
    name: 'Mercury Banking',
    by: 'Mercury',
    why: 'Palette dark fintech, clarté des chiffres, animations discrètes.',
    url: 'https://mercury.com',
  },
  {
    name: 'shadcn/ui',
    by: 'shadcn',
    why: 'Pattern composants Radix + Tailwind à copier-coller, philosophie minimaliste.',
    url: 'https://ui.shadcn.com',
  },
];

export function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="À propos"
        title="Vibe coded with Claude Code"
        subtitle="Un projet perso pour suivre mes finances, construit en discutant avec un agent IA."
      />

      <section className="card p-6 mb-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex items-start gap-4 relative">
          <BrandMark className="h-14 w-14 shrink-0" />
          <div className="flex-1">
            <h2 className="font-display text-xl font-bold text-fg-bright mb-3">
              L'histoire courte
            </h2>
            <p className="text-fg leading-relaxed mb-3">
              Développeur Java/web côté serveur depuis 21 ans, mais novice sur React et le front
              moderne. J'avais envie d'une appli qui analyse mes relevés bancaires PDF, détecte les
              charges récurrentes, calcule un score de santé financière, et me dit honnêtement comment
              je me débrouille — sans envoyer mes données à un service en ligne tiers.
            </p>
            <p className="text-fg leading-relaxed mb-3">
              Toute l'appli (frontend React, backend NestJS, infra Docker) a été co-construite avec
              {' '}
              <a href="https://claude.com/claude-code" target="_blank" rel="noopener" className="text-accent-bright hover:text-accent inline-flex items-center gap-1 font-medium">
                Claude Code
                <ExternalLink className="h-3 w-3" />
              </a>
              . Mon rôle : tracer la vision, valider les choix, repérer ce qui cloche.
              Le rôle de Claude : poser le code, expliquer, itérer.
            </p>
            <p className="text-fg leading-relaxed">
              En amont,
              {' '}
              <a href="https://chat.openai.com/" target="_blank" rel="noopener" className="text-info hover:underline inline-flex items-center gap-1 font-medium">
                ChatGPT
                <ExternalLink className="h-3 w-3" />
              </a>
              {' '}a aidé à générer le logo et les premières maquettes UX qui ont guidé la construction.
              Une vraie collab à trois — humain + ChatGPT (visuels) + Claude Code (code) — l'occasion
              de sortir de ma zone Java pour explorer le front moderne.
            </p>
            <div className="mt-4 flex items-center gap-1.5 text-xs text-fg-muted">
              <Sparkles className="h-3 w-3 text-accent" />
              <span>L'analyse des PDFs côté backend utilise aussi Claude (Sonnet 4.6) en two-phase tool-use.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {STACK.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.group} className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Icon className="h-4 w-4 text-accent" />
                <h3 className="font-display font-semibold text-fg-bright">{s.group}</h3>
              </div>
              <ul className="space-y-2 text-sm text-fg-muted">
                {s.items.map((it) => (
                  <li key={it} className="flex items-start gap-2">
                    <span className="text-accent-bright/60 select-none mt-0.5">›</span>
                    <span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="card p-5 mb-6">
        <h3 className="font-display text-lg font-semibold text-fg-bright mb-1">Sources d'inspiration</h3>
        <p className="text-sm text-fg-muted mb-5">
          Pas une copie, mais des principes que j'ai essayé d'appliquer.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {INSPIRATIONS.map((i) => (
            <a
              key={i.name}
              href={i.url}
              target="_blank"
              rel="noopener"
              className="card-hover p-4 flex flex-col gap-1.5 group"
            >
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-fg-bright group-hover:text-accent-bright transition-colors">
                  {i.name}
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-fg-dim group-hover:text-accent-bright" />
              </div>
              <span className="text-[10px] uppercase tracking-wider text-fg-dim">par {i.by}</span>
              <p className="text-xs text-fg-muted leading-relaxed mt-1">{i.why}</p>
            </a>
          ))}
        </div>
      </section>

      <section className="card p-5 text-center">
        <div className="text-fg-muted text-sm leading-relaxed max-w-2xl mx-auto">
          Si tu veux faire pareil : prends un sujet qui t'énerve, ouvre Claude Code, décris le problème
          en langage naturel, et itère. Tu seras surpris de ce qu'on peut construire en quelques sessions.
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-fg-dim mt-4">
          Made with curiosity · Built on a Synology NAS · v2.0
        </div>
      </section>
    </>
  );
}
