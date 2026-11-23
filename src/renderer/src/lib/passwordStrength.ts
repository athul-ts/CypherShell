/** BL-26: minimum length of a new master password (the backend enforces the same rule). */
export const MIN_MASTER_PASSWORD_LENGTH = 10

export type StrengthLevel = 'too-short' | 'weak' | 'fair' | 'strong'

export interface PasswordStrength {
  level: StrengthLevel
  label: string
  hint: string
}

/** How many of lower case, upper case, digits and symbols the password uses. */
function characterClasses(password: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password))
    .length
}

/**
 * A rough strength rating for the strength hint (BL-26), from length and
 * character variety. Long passphrases rate strong even in one case.
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    return {
      level: 'too-short',
      label: 'Too short',
      hint: `Use at least ${MIN_MASTER_PASSWORD_LENGTH} characters.`
    }
  }
  const classes = characterClasses(password)
  if (password.length >= 20 || (password.length >= 16 && classes >= 3)) {
    return { level: 'strong', label: 'Strong', hint: 'A good master password.' }
  }
  if ((password.length >= 12 && classes >= 2) || classes >= 3) {
    return {
      level: 'fair',
      label: 'Fair',
      hint: 'Longer is stronger — a passphrase of several words works well.'
    }
  }
  return {
    level: 'weak',
    label: 'Weak',
    hint: 'Make it longer, or mix letters, numbers and symbols.'
  }
}
