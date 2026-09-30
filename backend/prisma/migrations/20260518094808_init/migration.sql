-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL,
    "authMethod" TEXT NOT NULL,
    "encryptedPassword" TEXT,
    "sshKeyId" TEXT,
    "group" TEXT,
    "terminalTheme" TEXT NOT NULL DEFAULT 'dark',
    "fontSize" INTEGER NOT NULL DEFAULT 14,
    "autoReconnect" BOOLEAN NOT NULL DEFAULT true,
    "lastConnectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_sshKeyId_fkey" FOREIGN KEY ("sshKeyId") REFERENCES "SSHKey" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tunnel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "localPort" INTEGER NOT NULL,
    "remoteHost" TEXT,
    "remotePort" INTEGER,
    "autoStart" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    CONSTRAINT "Tunnel_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SSHKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "keyType" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "hasPassphrase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "profileId" TEXT,
    "profileName" TEXT,
    "host" TEXT,
    "detail" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "fileSizeBytes" INTEGER,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "lockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "masterPasswordHash" TEXT,
    "encryptionKeySalt" TEXT NOT NULL,
    "autoLockMinutes" INTEGER NOT NULL DEFAULT 15,
    "logRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "defaultFont" TEXT NOT NULL DEFAULT 'JetBrains Mono',
    "defaultFontSize" INTEGER NOT NULL DEFAULT 14,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
