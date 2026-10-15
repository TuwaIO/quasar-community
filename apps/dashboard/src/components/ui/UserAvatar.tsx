interface UserAvatarProps {
  /** The email of the account; the avatar shows its first letter. */
  email?: string;
  className?: string; // e.g. "h-10 w-10 text-sm"
}

/**
 * The avatar of an account: the first letter of its email. It loads no image, so no other host learns who is signed in.
 */
export function UserAvatar({ email, className = 'h-10 w-10 text-sm' }: UserAvatarProps) {
  const initial = email?.trim()[0]?.toUpperCase() || 'U';

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 rounded-full border border-[var(--tuwa-text-accent)]/20 bg-[var(--tuwa-text-accent)]/10 text-[var(--tuwa-text-accent)] font-black shadow-inner overflow-hidden ${className}`}
    >
      <span className="select-none">{initial}</span>
    </div>
  );
}
