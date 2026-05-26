import bcrypt from 'bcrypt';
import crypto from 'crypto';

export class CryptoService {
  private static activeKey: Buffer | null = null;

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  static generateSalt(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  static async deriveKey(password: string, saltHex: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(password, Buffer.from(saltHex, 'hex'), 200000, 32, 'sha512', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
  }

  static setActiveKey(key: Buffer) {
    this.activeKey = key;
  }

  static clearActiveKey() {
    this.activeKey = null;
  }

  static encrypt(text: string): string {
    if (!this.activeKey) throw new Error('Encryption key not loaded. App is locked.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.activeKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');
    return `${iv.toString('base64')}:${encrypted}:${authTag}`;
  }

  static decrypt(encryptedText: string): string {
    if (!this.activeKey) throw new Error('Encryption key not loaded. App is locked.');
    const parts = encryptedText.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted text format');
    const [ivStr, encrypted, authTagStr] = parts;
    const iv = Buffer.from(ivStr, 'base64');
    const authTag = Buffer.from(authTagStr, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.activeKey, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
