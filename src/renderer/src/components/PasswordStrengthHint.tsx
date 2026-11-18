import { passwordStrength, type StrengthLevel } from '../lib/passwordStrength'
import { cn } from '../lib/utils'

const SEGMENTS: Record<StrengthLevel, number> = { 'too-short': 0, weak: 1, fair: 2, strong: 3 }

const COLOURS: Record<StrengthLevel, string> = {
  'too-short': 'bg-red-500',
  weak: 'bg-red-500',
  fair: 'bg-amber-500',
  strong: 'bg-emerald-500'
}

const TEXT: Record<StrengthLevel, string> = {
  'too-short': 'text-red-400',
  weak: 'text-red-400',
  fair: 'text-amber-400',
  strong: 'text-emerald-400'
}

/** BL-26: live strength feedback for a new master password. Renders nothing while it is empty. */
export function PasswordStrengthHint({ password }: { password: string }): React.JSX.Element | null {
  if (!password) return null
  const strength = passwordStrength(password)
  const filled = SEGMENTS[strength.level]
  return (
    <div className="mt-2" aria-live="polite" data-testid="password-strength">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full',
              i < filled ? COLOURS[strength.level] : 'bg-slate-700'
            )}
          />
        ))}
      </div>
      <p className={cn('mt-1 text-xs', TEXT[strength.level])}>
        <span className="font-medium">{strength.label}</span> — {strength.hint}
      </p>
    </div>
  )
}
