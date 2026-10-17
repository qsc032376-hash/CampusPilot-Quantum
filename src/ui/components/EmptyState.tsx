import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  message: string;
  children?: ReactNode;
}

/** Quiet placeholder used wherever the dashboard has nothing to show yet. */
export function EmptyState({ title, message, children }: EmptyStateProps) {
  return (
    <div className="cp-empty">
      <p className="cp-empty__title">{title}</p>
      <p className="cp-empty__message">{message}</p>
      {children}
    </div>
  );
}
