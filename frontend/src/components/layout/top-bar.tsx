import { Link } from '@tanstack/react-router';
import { BrandMark } from '../brand-mark';

export function TopBar() {
  return (
    <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-surface/95 backdrop-blur-md border-b border-border flex items-center px-4">
      <Link to="/" className="flex items-center gap-2.5">
        <BrandMark className="h-8 w-8" />
        <div className="font-display text-sm font-bold tracking-tight text-fg-bright">
          Finance Tracker
        </div>
      </Link>
    </header>
  );
}
