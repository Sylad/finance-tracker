import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/page-header';

// Écran 404 du routeur (L169) : remplace le « Not Found » anglais de TanStack, sans
// titre ni issue (Nielsen 9 — aider à se sortir d'une erreur ; WCAG 2.4.6). Le titre
// d'onglet « Page introuvable » vient de pageTitle (app-shell).
export function NotFound() {
  return (
    <>
      <PageHeader
        eyebrow="Erreur 404"
        title="Page introuvable"
        subtitle="Cette adresse ne correspond à aucune page de l’application : le lien est peut-être ancien ou mal recopié."
      />
      <Link to="/" className="btn-primary">
        <ArrowRight className="h-4 w-4" aria-hidden="true" /> Revenir au tableau de bord
      </Link>
    </>
  );
}
